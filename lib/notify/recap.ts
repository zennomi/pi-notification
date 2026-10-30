import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import {
  TELEGRAM_MAX_MESSAGE_CHARS,
  telegramTextLength,
} from "./telegram.ts";

const SYSTEM_PROMPT = "Summarize this in one concise sentence for a push notification. Reply with ONLY the summary.";
const MAX_INPUT_CHARS = 2000;
const MAX_TOKENS = 100;
const TIMEOUT_MS = 10_000;
const FALLBACK_TRUNCATE_CHARS = 100;

export function fallbackSummary(messageText: string): string {
  const trimmed = messageText.trim();
  return trimmed.length <= FALLBACK_TRUNCATE_CHARS
    ? trimmed
    : `${trimmed.slice(0, FALLBACK_TRUNCATE_CHARS)}...`;
}

export function parseModelRef(modelRef: string): { provider: string; modelId: string } | null {
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) return null;
  return { provider: modelRef.slice(0, slash), modelId: modelRef.slice(slash + 1) };
}

export interface AssistantMessageLike {
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
}

export function extractAssistantContent(message: AssistantMessageLike): string | null {
  if (message.role !== "assistant") return null;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    const parts = message.content.flatMap((block) => {
      if (typeof block !== "object" || block === null) return [];
      const item = block as { type?: string; text?: string };
      return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
    });
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

/** Extract the last assistant text from a lifecycle payload or session entries. */
export function extractLastAssistantText(value: unknown): string | null {
  const payload = value as { messages?: Array<{ role?: string; content?: unknown }> } | null;
  if (Array.isArray(payload?.messages)) {
    for (let i = payload.messages.length - 1; i >= 0; i -= 1) {
      const text = extractAssistantContent(payload.messages[i]);
      if (text) return text;
    }
  }
  return null;
}

export function findLastAssistantMessage(
  ctx: Pick<ExtensionContext, "sessionManager">,
): AssistantMessageLike | null {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: string; message?: AssistantMessageLike };
    if (entry.type === "message" && entry.message?.role === "assistant") return entry.message;
  }
  return null;
}

export function extractLastAssistantTextFromSession(ctx: Pick<ExtensionContext, "sessionManager">): string | null {
  const message = findLastAssistantMessage(ctx);
  return message ? extractAssistantContent(message) : null;
}

function assistantText(result: AssistantMessage): string | null {
  return extractAssistantContent(result);
}

function resolveModel(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  modelRef: string,
): Model<any> | undefined {
  if (!modelRef) return ctx.model;
  const parsed = parseModelRef(modelRef);
  return parsed ? ctx.modelRegistry.find(parsed.provider, parsed.modelId) : undefined;
}

export async function tryRecap(
  messageText: string,
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  modelRef = "",
  timeoutMs = TIMEOUT_MS,
): Promise<string | null> {
  const model = resolveModel(ctx, modelRef);
  if (!model) return null;

  const input = messageText.length > MAX_INPUT_CHARS
    ? `${messageText.slice(0, MAX_INPUT_CHARS)}...`
    : messageText;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const context: Context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: input, timestamp: Date.now() }],
    };
    const stream = ctx.modelRegistry.streamSimple(model, context, {
      maxTokens: MAX_TOKENS,
      reasoning: "minimal",
      signal: controller.signal,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("recap timeout"));
      }, timeoutMs);
      timeout.unref?.();
    });
    const result = await Promise.race([stream.result(), timeoutPromise]);
    const summary = assistantText(result)?.trim();
    return summary || null;
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function truncateToLength(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max <= 3) return ".".repeat(max);
  return `${text.slice(0, max - 3)}...`;
}

export interface FitTelegramBodyOptions {
  title: string;
  prefix: string;
  text: string;
  ctx?: Pick<ExtensionContext, "model" | "modelRegistry">;
  recap: { enabled: boolean; model: string };
  limit?: number;
}

export async function fitTelegramBody({
  title,
  prefix,
  text,
  ctx,
  recap,
  limit = TELEGRAM_MAX_MESSAGE_CHARS,
}: FitTelegramBodyOptions): Promise<string> {
  let body = `${prefix}${text}`;
  if (telegramTextLength(title, body) <= limit) return body;

  if (recap.enabled && ctx) {
    const summary = await tryRecap(text, ctx, recap.model);
    if (summary) body = `${prefix}${summary}`;
  }

  return truncateToLength(body, Math.max(0, limit - title.length - 1));
}

/** Summarize text with Pi's configured model runtime, falling back safely. */
export async function summarizeLastMessage(
  messageText: string,
  ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
  modelRef = "",
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  return (await tryRecap(messageText, ctx, modelRef, timeoutMs)) ?? fallbackSummary(messageText);
}
