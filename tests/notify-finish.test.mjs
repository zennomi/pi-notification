import assert from "node:assert/strict";
import test from "node:test";
import { createFinishNotifier } from "../lib/notify/finish.ts";

const config = (overrides = {}) => ({
  telegram: { enabled: true, botToken: "token", chatId: "chat" },
  finish: { enabled: true, ...overrides.finish },
  recap: { enabled: false, model: "", ...overrides.recap },
  error: { enabled: true, ...overrides.error },
  input: { enabled: true },
});

function context(summary, lastAnswer = "last answer", messageExtras = {}) {
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

function notifierContext(summary, lastAnswer = "last answer", messageExtras = {}) {
  return context(summary, lastAnswer, messageExtras);
}

test("finish notification waits for grace and sends once with full lifecycle text", async () => {
  const sent = [];
  const ctx = notifierContext("ignored");
  const notifier = createFinishNotifier(ctx, {
    getConfig: () => config(),
    getSessionName: () => "Demo",
    getFolderName: () => "pi-notification",
    graceMs: 2,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
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
  const sent = [];
  const notifier = createFinishNotifier(notifierContext("ignored", "partial"), {
    getConfig: () => config({ finish: { enabled: false } }),
    getSessionName: () => "Demo",
    getFolderName: () => "pi-notification",
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
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
  const sent = [];
  const notifier = createFinishNotifier(notifierContext("ignored", "partial", {
    stopReason: "error",
    errorMessage: "Provider failed",
  }), {
    getConfig: () => config(),
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  notifier.onAgentSettled();
  await wait(15);
  assert.equal(sent[0].priority, "high");
  assert.match(sent[0].message, /Provider failed/);
  assert.doesNotMatch(sent[0].message, /Agent is complete/);
});

test("agent_start cancels a pending completion notification", async () => {
  const sent = [];
  const notifier = createFinishNotifier(notifierContext("ignored"), {
    getConfig: () => config(),
    graceMs: 10,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  notifier.onAgentSettled();
  notifier.onAgentStart();
  await wait(20);
  assert.equal(sent.length, 0);
});

test("finish recap summarizes only an over-limit assistant message", async () => {
  const sent = [];
  const ctx = notifierContext("one concise recap", "x".repeat(4100));
  const notifier = createFinishNotifier(ctx, {
    getConfig: () => config({ recap: { enabled: true } }),
    getSessionName: () => "Demo",
    getFolderName: () => "pi-notification",
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
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
  const sent = [];
  const ctx = notifierContext("ignored", "x".repeat(4100));
  const notifier = createFinishNotifier(ctx, {
    getConfig: () => config(),
    getSessionName: () => "Demo",
    getFolderName: () => "pi-notification",
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  notifier.onAgentSettled();
  await wait(15);
  assert.equal(sent[0].title, "pi-notification");
  assert.equal(sent[0].message.length, 4096 - "pi-notification".length - 1);
  assert.match(sent[0].message, /\.\.\.$/);
  assert.equal(ctx.calls.stream, 0);
});

test("finish notification uses lifecycle text when no assistant message exists", async () => {
  const sent = [];
  const notifier = createFinishNotifier(notifierContext("ignored", null), {
    getConfig: () => config({ recap: { enabled: true } }),
    getSessionName: () => "Demo",
    getFolderName: () => "pi-notification",
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  notifier.onAgentSettled();
  await wait(15);
  assert.deepEqual(sent[0], {
    title: "pi-notification",
    message: "Demo - Agent is complete",
    priority: "low",
  });
});

test("disabled finish and child processes do not notify", async () => {
  const sent = [];
  const disabled = createFinishNotifier(notifierContext("summary"), {
    getConfig: () => config({ finish: { enabled: false } }),
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  disabled.onAgentSettled();
  const child = createFinishNotifier(notifierContext("summary"), {
    getConfig: () => config(),
    graceMs: 1,
    env: { PI_SUBAGENT_CHILD: "1" },
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  child.onAgentSettled();
  await wait(15);
  assert.equal(sent.length, 0);
});
