import assert from "node:assert/strict";
import test from "node:test";
import { notifyCompactionFailed } from "../lib/notify/errors.ts";

const config = (overrides = {}) => ({
  telegram: { enabled: true, botToken: "token", chatId: "chat" },
  finish: { enabled: true },
  recap: { enabled: false, model: "" },
  error: { enabled: true, ...overrides.error },
  input: { enabled: true },
});

function deps(sent, overrides = {}) {
  return {
    title: "pi-notification",
    getSessionName: () => "Demo",
    getConfig: () => config(overrides),
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  };
}

test("compaction failures notify with high priority and error details", async () => {
  const sent = [];
  await notifyCompactionFailed({ reason: "threshold", aborted: false, errorMessage: "Compactor failed" }, deps(sent));
  assert.deepEqual(sent, [{
    title: "pi-notification",
    message: "**❌ Compaction failed** — Demo (threshold)\n\n```\nCompactor failed\n```",
    priority: "high",
  }]);
});

test("aborted, empty, disabled, and child compactions are ignored", async () => {
  for (const event of [
    { reason: "manual", aborted: true, errorMessage: "failed" },
    { reason: "manual", aborted: false },
  ]) {
    const sent = [];
    await notifyCompactionFailed(event, deps(sent));
    assert.equal(sent.length, 0);
  }
  const disabled = [];
  await notifyCompactionFailed(
    { reason: "manual", aborted: false, errorMessage: "failed" },
    deps(disabled, { error: { enabled: false } }),
  );
  assert.equal(disabled.length, 0);
  const child = [];
  await notifyCompactionFailed(
    { reason: "manual", aborted: false, errorMessage: "failed" },
    { ...deps(child), env: { PI_SUBAGENT_CHILD: "1" } },
  );
  assert.equal(child.length, 0);
});
