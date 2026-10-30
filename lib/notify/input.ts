import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotifyConfig } from "./config.ts";
import { dispatchNotification, type DispatchResult, type NotificationRequest } from "./dispatch.ts";
import { fitTelegramBody } from "./recap.ts";

export const ASK_USER_PROMPT_CHANNEL = "rpiv:ask-user:prompt";
export const ASK_USER_BLOCKED_CHANNEL = "rpiv:ask-user:blocked";

interface AskUserOption {
  label?: unknown;
  description?: unknown;
}

interface AskUserQuestion {
  question?: unknown;
  header?: unknown;
  multiSelect?: unknown;
  options?: unknown;
}

interface AskUserPromptPayload {
  questions?: unknown;
  toolCallId?: unknown;
}

export interface InputNotifierDeps {
  getConfig: () => NotifyConfig;
  getSessionName?: () => string | undefined;
  getFolderName?: () => string;
  dispatch?: (request: NotificationRequest, config: NotifyConfig) => Promise<DispatchResult>;
}

export interface InputNotifier {
  onAgentStart(): void;
  onAgentSettled(): void;
  onAskUserPrompt(payload: unknown): void;
  onAskUserBlocked(payload: unknown): void;
  onUiPromptStart(payload: { kind?: string; title?: string }): void;
  dispose(): void;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatAskUserPrompt(payload: AskUserPromptPayload, sessionName?: string): string {
  const questions = Array.isArray(payload.questions) ? payload.questions as AskUserQuestion[] : [];
  const lines = [`**❓ Input needed**${sessionName ? ` — ${sessionName}` : ""}`];
  questions.forEach((question, questionIndex) => {
    const header = text(question.header) || `Question ${questionIndex + 1}`;
    const questionText = text(question.question);
    const suffix = question.multiSelect === true ? " (multi-select)" : "";
    lines.push("", `**${header}**: ${questionText}${suffix}`);
    const options = Array.isArray(question.options) ? question.options as AskUserOption[] : [];
    options.forEach((option, optionIndex) => {
      const label = text(option.label) || `Option ${optionIndex + 1}`;
      const description = text(option.description);
      lines.push(`${optionIndex + 1}. **${label}**${description ? ` — ${description}` : ""}`);
    });
  });
  return lines.join("\n");
}

/** Notify when a running agent is blocked on an extension UI prompt. */
export function createInputNotifier(
  ctx: ExtensionContext,
  deps: InputNotifierDeps,
): InputNotifier {
  let running = false;
  const activeAsk = new Set<string>();
  const dispatch = deps.dispatch ?? dispatchNotification;

  const title = (): string => deps.getFolderName?.() ?? basename(ctx.cwd || process.cwd());

  const send = (body: string): void => {
    const config = deps.getConfig();
    if (config.input?.enabled === false) return;
    void fitTelegramBody({
      title: title(),
      prefix: "",
      text: body,
      ctx,
      recap: config.recap,
    }).then((message) => dispatch({
      title: title(),
      message,
      priority: "normal",
    }, config)).catch(() => {
      // Input notifications must never interrupt a blocked agent run.
    });
  };

  return {
    onAgentStart() {
      running = true;
      activeAsk.clear();
    },
    onAgentSettled() {
      running = false;
    },
    onAskUserPrompt(payload) {
      const data = (payload ?? {}) as AskUserPromptPayload;
      const toolCallId = text(data.toolCallId) || "__rpiv-ask-user-anonymous__";
      activeAsk.add(toolCallId);
      send(formatAskUserPrompt(data, deps.getSessionName?.()));
    },
    onAskUserBlocked(payload) {
      const data = payload as { active?: unknown; toolCallId?: unknown };
      if (data.active === false) {
        activeAsk.delete(text(data.toolCallId) || "__rpiv-ask-user-anonymous__");
      }
    },
    onUiPromptStart(payload) {
      if (!running || activeAsk.size > 0) return;
      const kind = text(payload.kind) || "custom";
      const promptTitle = text(payload.title);
      const body = `**⏳ Waiting for input**${promptTitle ? ` — ${promptTitle}` : ""}\n\nPrompt type: \`${kind}\``;
      send(body);
    },
    dispose() {
      running = false;
      activeAsk.clear();
    },
  };
}
