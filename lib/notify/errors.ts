import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dispatchNotification } from "./dispatch.ts";
import { fencedError, heading } from "./message.ts";
import { fitTelegramBody } from "./recap.ts";
import { isChildProcess, type NotifierDeps } from "./session.ts";

export interface CompactionFailedEvent {
  reason: string;
  errorMessage?: string;
  aborted: boolean;
  willRetry?: boolean;
}

export interface CompactionNotifierDeps extends NotifierDeps {
  title: string;
  ctx?: Pick<ExtensionContext, "model" | "modelRegistry">;
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
    `${heading("❌ Compaction failed", sessionName)} (${event.reason})`,
    fencedError(event.errorMessage),
  ].join("\n\n");
  const message = await fitTelegramBody({
    title: deps.title,
    text: body,
    ctx: deps.ctx,
    recap: config.recap,
  });
  await (deps.dispatch ?? dispatchNotification)({ title: deps.title, message, priority: "high" }, config);
}
