import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { isRecord } from "./payload.ts";

const CONFIG_FILENAME = "notify.json";

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

export const NOTIFY_PRIORITIES = ["low", "normal", "high"] as const;
export type NotifyPriority = typeof NOTIFY_PRIORITIES[number];

export type NotifyConfigPatch = {
  [K in keyof NotifyConfig]?: Partial<NotifyConfig[K]>;
};

export const DEFAULT_CONFIG: NotifyConfig = {
  telegram: { enabled: false },
  finish: { enabled: true },
  recap: { enabled: true, model: "" },
  error: { enabled: true },
  input: { enabled: true },
};

export function globalConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, CONFIG_FILENAME);
}

export function projectConfigPath(cwd = process.cwd()): string {
  return join(cwd, ".pi", CONFIG_FILENAME);
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

function mergeConfig(...parts: NotifyConfigPatch[]): NotifyConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  const sections = Object.keys(config) as (keyof NotifyConfig)[];
  for (const part of parts) {
    for (const key of sections) {
      const section = part[key];
      if (isRecord(section) && typeof section.enabled === "boolean") {
        config[key].enabled = section.enabled;
      }
    }
    if (isRecord(part.telegram)) {
      if (typeof part.telegram.botToken === "string") config.telegram.botToken = part.telegram.botToken;
      if (typeof part.telegram.chatId === "string") config.telegram.chatId = part.telegram.chatId;
    }
    if (isRecord(part.recap) && typeof part.recap.model === "string") config.recap.model = part.recap.model;
  }
  return config;
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
