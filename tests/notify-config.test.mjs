import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  globalConfigPath,
  isTelegramConfigured,
  loadConfig,
  projectConfigPath,
  saveGlobalConfig,
} from "../lib/notify/config.ts";

function tempDir(t) {
  const path = mkdtempSync(join(tmpdir(), "pi-notify-config-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function withAgentDir(agentDir, fn) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}

test("config defaults are disabled for Telegram and enabled for notifications", () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    telegram: { enabled: false },
    finish: { enabled: true },
    recap: { enabled: true, model: "" },
    error: { enabled: true },
    input: { enabled: true },
  });
  assert.equal(isTelegramConfigured(DEFAULT_CONFIG), false);
});

test("config merges global, project, and environment overrides", (t) => {
  const agentDir = tempDir(t);
  const cwd = tempDir(t);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(globalConfigPath(agentDir), JSON.stringify({
    telegram: { enabled: true, botToken: "global-token", chatId: "global-chat" },
    recap: { model: "global/model" },
  }));
  writeFileSync(projectConfigPath(cwd), JSON.stringify({
    telegram: { chatId: "project-chat" },
    finish: { enabled: false },
  }));

  const config = withAgentDir(agentDir, () => loadConfig(cwd, {
    TELEGRAM_BOT_TOKEN: "env-token",
    TELEGRAM_CHAT_ID: "env-chat",
  }));

  assert.deepEqual(config.telegram, { enabled: true, botToken: "env-token", chatId: "env-chat" });
  assert.equal(config.finish.enabled, false);
  assert.equal(config.recap.model, "global/model");
  assert.equal(config.error.enabled, true);
  assert.equal(config.input.enabled, true);
  assert.equal(isTelegramConfigured(config), true);
});

test("config patches can disable error and input notifications", (t) => {
  const agentDir = tempDir(t);
  const saved = saveGlobalConfig({ error: { enabled: false }, input: { enabled: false } }, agentDir);
  assert.equal(saved.error.enabled, false);
  assert.equal(saved.input.enabled, false);
});

test("saveGlobalConfig writes only the global file", (t) => {
  const agentDir = tempDir(t);
  const cwd = tempDir(t);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(projectConfigPath(cwd), JSON.stringify({ recap: { enabled: false } }));

  const previousCwd = process.cwd();
  try {
    process.chdir(cwd);
    const saved = saveGlobalConfig({ telegram: { enabled: true, botToken: "token", chatId: "chat" } }, agentDir);
    assert.equal(saved.telegram.botToken, "token");
  } finally {
    process.chdir(previousCwd);
  }
  assert.equal(JSON.parse(readFileSync(globalConfigPath(agentDir), "utf8")).telegram.botToken, "token");
  assert.deepEqual(JSON.parse(readFileSync(projectConfigPath(cwd), "utf8")), { recap: { enabled: false } });
});

test("invalid JSON is ignored and returns safe defaults", (t) => {
  const agentDir = tempDir(t);
  const cwd = tempDir(t);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(globalConfigPath(agentDir), "not-json");
  writeFileSync(projectConfigPath(cwd), "[]");

  const config = withAgentDir(agentDir, () => loadConfig(cwd, {}));
  assert.deepEqual(config, DEFAULT_CONFIG);
});
