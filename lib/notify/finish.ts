import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dispatchNotification } from "./dispatch.ts";
import { fencedError, heading } from "./message.ts";
import { folderTitle, isChildProcess, type SessionNotifierDeps } from "./session.ts";
import {
  extractLastAssistantText,
  extractLastAssistantTextFromSession,
  type AssistantMessageLike,
  findLastAssistantMessage,
  fitTelegramBody,
} from "./recap.ts";

export const FINISH_GRACE_MS = 1500;

function configuredGraceMs(): number {
  const value = Number(process.env.PI_NOTIFY_FINISH_GRACE_MS);
  return Number.isFinite(value) && value >= 0 ? value : FINISH_GRACE_MS;
}

export { isChildProcess };

function runEndedWithError(outcome: string | undefined, assistant: AssistantMessageLike | null): boolean {
  return outcome === "error" || assistant?.stopReason === "error";
}

export interface FinishNotifierDeps extends SessionNotifierDeps {
  graceMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface FinishNotifier {
  onAgentStart(): void;
  onBeforeSettle(payload: { outcome?: string }): void;
  onAgentSettled(payload?: unknown): void;
  skipCurrentRun(): void;
  dispose(): void;
}

/** Create the once-per-settled-run notification handler. */
export function createFinishNotifier(
  ctx: ExtensionContext,
  deps: FinishNotifierDeps,
): FinishNotifier {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome: string | undefined;
  let skipCompletion = false;
  const dispatch = deps.dispatch ?? dispatchNotification;
  const graceMs = deps.graceMs ?? configuredGraceMs();
  const child = isChildProcess(deps.env);

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const notify = async (payload: unknown): Promise<void> => {
    const config = deps.getConfig();
    if (child) return;

    const sessionName = deps.getSessionName?.();
    const title = folderTitle(ctx, deps);
    const assistant = findLastAssistantMessage(ctx);

    if (runEndedWithError(outcome, assistant)) {
      if (config.error?.enabled === false) return;
      const errorText = assistant?.errorMessage || "The agent run ended with an error.";
      const partialText = assistant ? extractLastAssistantTextFromSession(ctx) : null;
      const errorBody = [
        heading("❌ Error", sessionName),
        fencedError(errorText),
        partialText,
      ].filter((part): part is string => Boolean(part)).join("\n\n");
      const message = await fitTelegramBody({
        title,
        text: errorBody,
        ctx,
        recap: config.recap,
      });
      await dispatch({ title, message, priority: "high" }, config);
      return;
    }

    if (!config.finish.enabled || skipCompletion) return;
    let message = sessionName ? `${sessionName} - Agent is complete` : "Agent is complete";

    const text = extractLastAssistantText(payload) ?? extractLastAssistantTextFromSession(ctx);
    if (text) {
      message = await fitTelegramBody({
        title,
        prefix: sessionName ? `${sessionName}: ` : "",
        text,
        ctx,
        recap: config.recap,
      });
    }

    if (skipCompletion) return;
    await dispatch({ title, message, priority: "low" }, config);
  };

  return {
    onAgentStart() {
      cancel();
      outcome = undefined;
      skipCompletion = false;
    },
    skipCurrentRun() {
      skipCompletion = true;
    },
    onBeforeSettle(payload) {
      outcome = payload.outcome;
    },
    onAgentSettled(payload) {
      cancel();
      const config = deps.getConfig();
      const isError = runEndedWithError(outcome, findLastAssistantMessage(ctx));
      if ((!config.finish.enabled && !(isError && config.error?.enabled !== false)) || child) return;
      if (skipCompletion && !isError) return;
      timer = setTimeout(() => {
        timer = undefined;
        void notify(payload).catch(() => {
          // A completion notification must never break Pi's lifecycle.
        });
      }, graceMs);
      timer.unref?.();
    },
    dispose() {
      cancel();
    },
  };
}
