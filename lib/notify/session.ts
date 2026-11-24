import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotifyConfig } from "./config.ts";
import type { DispatchResult, NotificationRequest } from "./dispatch.ts";

export interface NotifierDeps {
  getConfig: () => NotifyConfig;
  getSessionName?: () => string | undefined;
  dispatch?: (request: NotificationRequest, config: NotifyConfig) => Promise<DispatchResult>;
}

export interface SessionNotifierDeps extends NotifierDeps {
  getFolderName?: () => string;
}

export function folderTitle(ctx: Pick<ExtensionContext, "cwd">, deps?: Pick<SessionNotifierDeps, "getFolderName">): string {
  return deps?.getFolderName?.() ?? basename(ctx.cwd || process.cwd());
}

export function isChildProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNIPI_SUBAGENT_CHILD === "1"
    || env.UNIPI_FUSION_CHILD === "1"
    || env.PI_SUBAGENT_CHILD === "1"
    || env.PI_FUSION_CHILD === "1";
}
