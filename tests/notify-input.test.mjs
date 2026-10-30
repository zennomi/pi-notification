import assert from "node:assert/strict";
import test from "node:test";
import { createInputNotifier } from "../lib/notify/input.ts";

const config = (overrides = {}) => ({
  telegram: { enabled: true, botToken: "token", chatId: "chat" },
  finish: { enabled: true },
  recap: { enabled: false, model: "" },
  error: { enabled: true },
  input: { enabled: true, ...overrides.input },
});

function context() {
  return {
    cwd: "/tmp/pi-notification",
    model: undefined,
    modelRegistry: {},
  };
}

function makeNotifier(sent, overrides = {}) {
  return createInputNotifier(context(), {
    getConfig: () => config(overrides),
    getSessionName: () => "Demo",
    getFolderName: () => "pi-notification",
    dispatch: async (request) => { sent.push(request); return { configured: true, sent: true }; },
  });
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

test("ask_user prompt sends questions and options immediately", async () => {
  const sent = [];
  const notifier = makeNotifier(sent);
  notifier.onAgentStart();
  notifier.onAskUserPrompt({
    toolCallId: "call-1",
    questions: [{
      header: "Choice",
      question: "Which one?",
      multiSelect: true,
      options: [
        { label: "A", description: "First" },
        { label: "B", description: "Second" },
      ],
    }],
  });
  await wait();
  assert.deepEqual(sent, [{
    title: "pi-notification",
    message: "**❓ Input needed** — Demo\n\n**Choice**: Which one? (multi-select)\n1. **A** — First\n2. **B** — Second",
    priority: "normal",
  }]);
});

test("ask_user custom UI is deduplicated and blocked false clears the active prompt", async () => {
  const sent = [];
  const notifier = makeNotifier(sent);
  notifier.onAgentStart();
  notifier.onAskUserPrompt({ toolCallId: "call-1", questions: [] });
  notifier.onUiPromptStart({ kind: "custom", title: "Questions" });
  await wait();
  assert.equal(sent.length, 1);

  notifier.onAskUserBlocked({ active: false, toolCallId: "call-1" });
  notifier.onUiPromptStart({ kind: "confirm", title: "Continue?" });
  await wait();
  assert.equal(sent.length, 2);
  assert.match(sent[1].message, /Waiting for input/);
  assert.match(sent[1].message, /Continue\?/);
});

test("generic prompts while idle and disabled input notifications are ignored", async () => {
  const idle = [];
  const idleNotifier = makeNotifier(idle);
  idleNotifier.onUiPromptStart({ kind: "input", title: "Token" });
  await wait();
  assert.equal(idle.length, 0);

  const disabled = [];
  const disabledNotifier = makeNotifier(disabled, { input: { enabled: false } });
  disabledNotifier.onAgentStart();
  disabledNotifier.onUiPromptStart({ kind: "select", title: "Pick" });
  await wait();
  assert.equal(disabled.length, 0);
});
