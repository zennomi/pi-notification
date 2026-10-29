import assert from "node:assert/strict";
import test from "node:test";
import { createFinishNotifier } from "../lib/notify/finish.ts";

const config = (overrides = {}) => ({
  telegram: { enabled: true, botToken: "token", chatId: "chat" },
  finish: { enabled: true, ...overrides.finish },
  recap: { enabled: false, model: "", ...overrides.recap },
});

function context(summary) {
  return {
    model: { provider: "session", id: "model" },
    modelRegistry: {
      find: () => ({ provider: "openai", id: "gpt" }),
      streamSimple: () => ({ result: async () => ({ role: "assistant", content: summary }) }),
    },
    sessionManager: {
      getEntries: () => [{ type: "message", message: { role: "assistant", content: "last answer" } }],
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("finish notification waits for grace and sends once with lifecycle text", async () => {
  const sent = [];
  const notifier = createFinishNotifier(context("ignored"), {
    getConfig: () => config(),
    getSessionName: () => "Demo",
    graceMs: 2,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  notifier.onAgentSettled();
  assert.equal(sent.length, 0);
  await wait(15);
  assert.deepEqual(sent, [{ title: "Pi — Agent Complete", message: "Demo - Agent is complete", priority: "low" }]);
  notifier.dispose();
});

test("agent_start cancels a pending completion notification", async () => {
  const sent = [];
  const notifier = createFinishNotifier(context("ignored"), {
    getConfig: () => config(),
    graceMs: 10,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  notifier.onAgentSettled();
  notifier.onAgentStart();
  await wait(20);
  assert.equal(sent.length, 0);
});

test("finish recap summarizes the last assistant message", async () => {
  const sent = [];
  const notifier = createFinishNotifier(context("one concise recap"), {
    getConfig: () => config({ recap: { enabled: true } }),
    getSessionName: () => "Demo",
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  notifier.onAgentSettled();
  await wait(15);
  assert.equal(sent[0].message, "Demo: one concise recap");
});

test("disabled finish and child processes do not notify", async () => {
  const sent = [];
  const disabled = createFinishNotifier(context("summary"), {
    getConfig: () => config({ finish: { enabled: false } }),
    graceMs: 1,
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  disabled.onAgentSettled();
  const child = createFinishNotifier(context("summary"), {
    getConfig: () => config(),
    graceMs: 1,
    env: { PI_SUBAGENT_CHILD: "1" },
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
  child.onAgentSettled();
  await wait(15);
  assert.equal(sent.length, 0);
});
