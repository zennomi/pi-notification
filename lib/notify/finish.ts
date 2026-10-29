import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotifyConfig } from "./config.ts";
import { dispatchNotification, type DispatchResult, type NotificationRequest } from "./dispatch.ts";
import {
  extractLastAssistantText,
  extractLastAssistantTextFromSession,
  summarizeLastMessage,
} from "./recap.ts";

export const FINISH_GRACE_MS = 1500;

function configuredGraceMs(): number {
  const value = Number(process.env.PI_NOTIFY_FINISH_GRACE_MS);
  return Number.isFinite(value) && value >= 0 ? value : FINISH_GRACE_MS;
}

function isChildProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNIPI_SUBAGENT_CHILD === "1"
    || env.UNIPI_FUSION_CHILD === "1"
    || env.PI_SUBAGENT_CHILD === "1"
    || env.PI_FUSION_CHILD === "1";
}

export interface FinishNotifierDeps {
  getConfig: () => NotifyConfig;
  getSessionName?: () => string | undefined;
  dispatch?: (request: NotificationRequest, config: NotifyConfig) => Promise<DispatchResult>;
  graceMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface FinishNotifier {
  onAgentStart(): void;
  onAgentSettled(payload?: unknown): void;
  dispose(): void;
}

/** Create the once-per-settled-run notification handler. */
export function createFinishNotifier(
  ctx: ExtensionContext,
  deps: FinishNotifierDeps,
): FinishNotifier {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispatch = deps.dispatch ?? dispatchNotification;
  const graceMs = deps.graceMs ?? configuredGraceMs();
  const child = isChildProcess(deps.env);

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const notify = async (payload: unknown): Promise<void> => {
    const config = deps.getConfig();
    if (!config.finish.enabled || child) return;

    const sessionName = deps.getSessionName?.();
    const title = "Pi — Agent Complete";
    let message = sessionName ? `${sessionName} - Agent is complete` : "Agent is complete";

    if (config.recap.enabled) {
      const text = extractLastAssistantText(payload) ?? extractLastAssistantTextFromSession(ctx);
      if (text) {
        const recap = await summarizeLastMessage(text, ctx, config.recap.model);
        message = sessionName ? `${sessionName}: ${recap}` : recap;
      }
    }

    await dispatch({ title, message, priority: "low" }, config);
  };

  return {
    onAgentStart() {
      cancel();
    },
    onAgentSettled(payload) {
      cancel();
      if (!deps.getConfig().finish.enabled || child) return;
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
