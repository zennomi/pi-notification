import assert from "node:assert/strict";
import test from "node:test";
import { dispatchNotification, SETUP_HINT } from "../lib/notify/dispatch.ts";

const configured = {
  telegram: { enabled: true, botToken: "token", chatId: "chat" },
  finish: { enabled: true },
  recap: { enabled: true, model: "" },
};
const unconfigured = {
  telegram: { enabled: false },
  finish: { enabled: true },
  recap: { enabled: true, model: "" },
};
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("dispatch returns a setup hint without attempting Telegram when unconfigured", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  const result = await dispatchNotification({ title: "T", message: "M" }, unconfigured);
  assert.deepEqual(result, { configured: false, sent: false, reason: SETUP_HINT });
  assert.equal(called, false);
});

test("dispatch swallows Telegram errors and reports them", async () => {
  globalThis.fetch = async () => new Response("down", { status: 503 });
  const result = await dispatchNotification({ title: "T", message: "M" }, configured);
  assert.equal(result.configured, true);
  assert.equal(result.sent, false);
  assert.match(result.error, /503/);
});

test("dispatch reports successful delivery", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  assert.deepEqual(
    await dispatchNotification({ title: "T", message: "M", priority: "high" }, configured),
    { configured: true, sent: true },
  );
});
