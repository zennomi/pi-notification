import assert from "node:assert/strict";
import test from "node:test";
import { notifyCompactionFailed } from "../lib/notify/errors.ts";
import { notificationConfig, recordNotifications } from "./fixtures/notifications.mjs";

function deps(sent, overrides = {}) {
  return {
    title: "pi-notification",
    getSessionName: () => "Demo",
    getConfig: () => notificationConfig(overrides),
    dispatch: recordNotifications(sent),
    env: {},
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
