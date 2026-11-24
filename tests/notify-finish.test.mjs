import assert from "node:assert/strict";
import test from "node:test";
import { createFinishNotifier } from "../lib/notify/finish.ts";
import { notificationConfig, recordNotifications } from "./fixtures/notifications.mjs";

function notifierContext(summary, lastAnswer = "last answer", messageExtras = {}) {
  const calls = { stream: 0 };
  const ctx = {
    cwd: "/tmp/pi-notification",
    model: { provider: "session", id: "model" },
    modelRegistry: {
      find: () => ({ provider: "openai", id: "gpt" }),
      streamSimple: () => {
        calls.stream += 1;
        return { result: async () => ({ role: "assistant", content: summary }) };
      },
    },
    sessionManager: {
      getEntries: () => lastAnswer === null
        ? []
        : [{ type: "message", message: { role: "assistant", content: lastAnswer, ...messageExtras } }],
    },
  };
  return Object.assign(ctx, { calls });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(ctx, { settings, ...deps } = {}) {
  const sent = [];
  const notifier = createFinishNotifier(ctx, {
    env: {},
    graceMs: 1,
    getConfig: () => notificationConfig(settings),
    dispatch: recordNotifications(sent),
    ...deps,
  });
  return { notifier, sent };
}

test("finish notification waits for grace and sends once with full lifecycle text", async () => {
  const ctx = notifierContext("ignored");
  const { notifier, sent } = setup(ctx, { getSessionName: () => "Demo", graceMs: 2 });
  notifier.onAgentSettled();
  assert.equal(sent.length, 0);
  await wait(15);
  assert.deepEqual(sent, [{
    title: "pi-notification",
    message: "Demo: last answer",
    priority: "low",
  }]);
  assert.equal(ctx.calls.stream, 0);
  notifier.dispose();
});

test("final agent errors replace completion with a high-priority error notification", async () => {
  const { notifier, sent } = setup(notifierContext("ignored", "partial"), {
    settings: { finish: { enabled: false } },
    getSessionName: () => "Demo",
  });
  notifier.onBeforeSettle({ outcome: "error" });
  notifier.onAgentSettled();
  await wait(15);
  assert.deepEqual(sent, [{
    title: "pi-notification",
    message: "**❌ Error** — Demo\n\n```\nThe agent run ended with an error.\n```\n\npartial",
    priority: "high",
  }]);
});

test("assistant stopReason and errorMessage are used for final errors", async () => {
  const { notifier, sent } = setup(notifierContext("ignored", "partial", {
    stopReason: "error",
    errorMessage: "Provider failed",
  }));
  notifier.onAgentSettled();
  await wait(15);
  assert.equal(sent[0].priority, "high");
  assert.match(sent[0].message, /Provider failed/);
  assert.doesNotMatch(sent[0].message, /Agent is complete/);
});

test("agent_start cancels a pending completion notification", async () => {
  const { notifier, sent } = setup(notifierContext("ignored"), { graceMs: 10 });
  notifier.onAgentSettled();
  notifier.onAgentStart();
  await wait(20);
  assert.equal(sent.length, 0);
});

test("finish recap summarizes only an over-limit assistant message", async () => {
  const ctx = notifierContext("one concise recap", "x".repeat(4100));
  const { notifier, sent } = setup(ctx, {
    settings: { recap: { enabled: true } },
    getSessionName: () => "Demo",
  });
  notifier.onAgentSettled();
  await wait(15);
  assert.deepEqual(sent[0], {
    title: "pi-notification",
    message: "Demo: one concise recap",
    priority: "low",
  });
  assert.equal(ctx.calls.stream, 1);
});

test("over-limit finish body is truncated when recap is disabled", async () => {
  const ctx = notifierContext("ignored", "x".repeat(4100));
  const { notifier, sent } = setup(ctx, { getSessionName: () => "Demo" });
  notifier.onAgentSettled();
  await wait(15);
  assert.equal(sent[0].title, "pi-notification");
  assert.equal(sent[0].message.length, 4096 - "pi-notification".length - 1);
  assert.match(sent[0].message, /\.\.\.$/);
  assert.equal(ctx.calls.stream, 0);
});

test("finish notification uses lifecycle text when no assistant message exists", async () => {
  const { notifier, sent } = setup(notifierContext("ignored", null), {
    settings: { recap: { enabled: true } },
    getSessionName: () => "Demo",
  });
  notifier.onAgentSettled();
  await wait(15);
  assert.deepEqual(sent[0], {
    title: "pi-notification",
    message: "Demo - Agent is complete",
    priority: "low",
  });
});

test("skipCurrentRun suppresses completion and resets on agent_start", async () => {
  const { notifier, sent } = setup(notifierContext("ignored", null), { graceMs: 0 });
  notifier.onAgentStart();
  notifier.skipCurrentRun();
  notifier.onAgentSettled();
  await wait(15);
  assert.equal(sent.length, 0);
  notifier.onAgentStart();
  notifier.onAgentSettled();
  await wait(15);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /Agent is complete/);
  notifier.dispose();
});

test("skipCurrentRun also suppresses an already scheduled completion", async () => {
  const { notifier, sent } = setup(notifierContext("ignored"), { graceMs: 0 });
  notifier.onAgentSettled();
  notifier.skipCurrentRun();
  await wait(15);
  assert.equal(sent.length, 0);
  notifier.dispose();
});

test("skipCurrentRun rechecks suppression after a slow recap", async () => {
  let resolveSummary;
  let recapStarted;
  const started = new Promise((resolve) => { recapStarted = resolve; });
  const ctx = notifierContext("ignored", "x".repeat(4100));
  ctx.modelRegistry.streamSimple = () => ({
    result: () => new Promise((resolve) => { resolveSummary = resolve; recapStarted(); }),
  });
  const { notifier, sent } = setup(ctx, { settings: { recap: { enabled: true } }, graceMs: 0 });
  notifier.onAgentSettled();
  await Promise.all([started, wait(15)]);
  notifier.skipCurrentRun();
  resolveSummary({ role: "assistant", content: "summary" });
  await wait(15);
  assert.equal(sent.length, 0);
  notifier.dispose();
});

test("skipCurrentRun never suppresses enabled errors from lifecycle or assistant", async () => {
  for (const source of ["outcome", "assistant"]) {
    const ctx = notifierContext("ignored", "partial", source === "assistant"
      ? { stopReason: "error", errorMessage: "Provider failed" } : {});
    const { notifier, sent } = setup(ctx, { settings: { finish: { enabled: false } }, graceMs: 0 });
    notifier.onAgentStart();
    notifier.skipCurrentRun();
    if (source === "outcome") notifier.onBeforeSettle({ outcome: "error" });
    notifier.onAgentSettled();
    await wait(15);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].priority, "high");
    assert.match(sent[0].message, /Error/);
    notifier.dispose();
  }
});

test("disabled finish and child processes do not notify", async () => {
  for (const options of [{ settings: { finish: { enabled: false } } }, { env: { PI_SUBAGENT_CHILD: "1" } }]) {
    const { notifier, sent } = setup(notifierContext("summary"), options);
    notifier.onAgentSettled();
    await wait(15);
    assert.equal(sent.length, 0);
  }
});
