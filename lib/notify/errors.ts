import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotifyConfig } from "./config.ts";
import { dispatchNotification, type DispatchResult, type NotificationRequest } from "./dispatch.ts";
import { fitTelegramBody } from "./recap.ts";
import { isChildProcess } from "./finish.ts";

export interface CompactionFailedEvent {
  reason: string;
  errorMessage?: string;
  aborted: boolean;
  willRetry?: boolean;
}

export interface CompactionNotifierDeps {
  getConfig: () => NotifyConfig;
  title: string;
  getSessionName?: () => string | undefined;
  ctx?: Pick<ExtensionContext, "model" | "modelRegistry">;
  dispatch?: (request: NotificationRequest, config: NotifyConfig) => Promise<DispatchResult>;
  env?: NodeJS.ProcessEnv;
}

/** Notify about a non-aborted Pi context-compaction failure. */
export async function notifyCompactionFailed(
  event: CompactionFailedEvent,
  deps: CompactionNotifierDeps,
): Promise<void> {
  if (event.aborted || !event.errorMessage || isChildProcess(deps.env)) return;
  const config = deps.getConfig();
  if (config.error?.enabled === false) return;

  const sessionName = deps.getSessionName?.();
  const body = [
    `**❌ Compaction failed**${sessionName ? ` — ${sessionName}` : ""} (${event.reason})`,
    "```\n" + event.errorMessage.replaceAll("```", "``\u200b`") + "\n```",
  ].join("\n\n");
  const message = await fitTelegramBody({
    title: deps.title,
    prefix: "",
    text: body,
    ctx: deps.ctx,
    recap: config.recap,
  });
  await (deps.dispatch ?? dispatchNotification)({ title: deps.title, message, priority: "high" }, config);
}
