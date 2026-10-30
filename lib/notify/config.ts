import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
}

export interface NotifyConfig {
  telegram: TelegramConfig;
  finish: { enabled: boolean };
  recap: { enabled: boolean; model: string };
  error: { enabled: boolean };
  input: { enabled: boolean };
}

export type NotifyPriority = "low" | "normal" | "high";

export interface NotifyConfigPatch {
  telegram?: Partial<TelegramConfig>;
  finish?: Partial<NotifyConfig["finish"]>;
  recap?: Partial<NotifyConfig["recap"]>;
  error?: Partial<NotifyConfig["error"]>;
  input?: Partial<NotifyConfig["input"]>;
}

export const DEFAULT_CONFIG: NotifyConfig = {
  telegram: { enabled: false },
  finish: { enabled: true },
  recap: { enabled: true, model: "" },
  error: { enabled: true },
  input: { enabled: true },
};

export function globalConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "notify.json");
}

export function projectConfigPath(cwd = process.cwd()): string {
  return join(cwd, ".pi", "notify.json");
}

function readPartial(path: string): NotifyConfigPatch {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed as NotifyConfigPatch : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(...parts: NotifyConfigPatch[]): NotifyConfig {
  const telegram: TelegramConfig = { ...DEFAULT_CONFIG.telegram };
  const finish = { ...DEFAULT_CONFIG.finish };
  const recap = { ...DEFAULT_CONFIG.recap };
  const error = { ...DEFAULT_CONFIG.error };
  const input = { ...DEFAULT_CONFIG.input };

  for (const part of parts) {
    if (isRecord(part.telegram)) {
      if (typeof part.telegram.enabled === "boolean") telegram.enabled = part.telegram.enabled;
      if (typeof part.telegram.botToken === "string") telegram.botToken = part.telegram.botToken;
      if (typeof part.telegram.chatId === "string") telegram.chatId = part.telegram.chatId;
    }
    if (isRecord(part.finish) && typeof part.finish.enabled === "boolean") {
      finish.enabled = part.finish.enabled;
    }
    if (isRecord(part.recap)) {
      if (typeof part.recap.enabled === "boolean") recap.enabled = part.recap.enabled;
      if (typeof part.recap.model === "string") recap.model = part.recap.model;
    }
    if (isRecord(part.error) && typeof part.error.enabled === "boolean") {
      error.enabled = part.error.enabled;
    }
    if (isRecord(part.input) && typeof part.input.enabled === "boolean") {
      input.enabled = part.input.enabled;
    }
  }

  return { telegram, finish, recap, error, input };
}

/** Load defaults, global config, project config, then environment overrides. */
export function loadConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  const config = mergeConfig(
    readPartial(globalConfigPath()),
    readPartial(projectConfigPath(cwd)),
  );

  if (env.TELEGRAM_BOT_TOKEN) config.telegram.botToken = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_CHAT_ID) config.telegram.chatId = env.TELEGRAM_CHAT_ID;
  if (env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_CHAT_ID) config.telegram.enabled = true;

  return config;
}

/** Save a partial update to the global config file only. */
export function saveGlobalConfig(
  patch: NotifyConfigPatch,
  agentDir = getAgentDir(),
): NotifyConfig {
  const current = mergeConfig(readPartial(globalConfigPath(agentDir)));
  const next = mergeConfig(current, patch);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(globalConfigPath(agentDir), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function isTelegramConfigured(config: NotifyConfig): boolean {
  return config.telegram.enabled === true
    && Boolean(config.telegram.botToken)
    && Boolean(config.telegram.chatId);
}
