import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import notifyExtension from "../extensions/notify/index.ts";
import { createFinishNotifier } from "../lib/notify/finish.ts";
import { createPlanReviewNotifier } from "../lib/notify/plan.ts";
import { notificationConfig as config, recordNotifications } from "./fixtures/notifications.mjs";

const context = () => ({
  cwd: "/tmp/pi-notification",
  model: undefined,
  modelRegistry: {},
  sessionManager: { getSessionId: () => "session-1", getEntries: () => [] },
});
const opened = (overrides = {}) => ({
  id: "pn-abcdef", action: "plan-review", url: "http://localhost:1234/review",
  openedAt: 100, piSessionId: "session-1", ...overrides,
});
const closed = (outcome = "approved", overrides = {}) => ({
  ...opened(), outcome, closedAt: 200, ...overrides,
});
const result = (overrides = {}) => ({
  type: "tool_result", toolName: "plannotator_submit_plan", toolCallId: "call-1",
  input: { filePath: "PLAN.md" }, isError: false, content: [],
  details: { approved: false, pending: true }, ...overrides,
});
const wait = () => new Promise((resolve) => setTimeout(resolve, 15));

function setup(t, overrides = {}) {
  const sent = [];
  let suppressed = 0;
  const notifier = createPlanReviewNotifier(context(), {
    getConfig: config,
    getSessionName: () => "Demo",
    env: {},
    onPlanNotified: () => { suppressed += 1; },
    dispatch: recordNotifications(sent),
    ...overrides,
  });
  t.after(() => notifier.dispose());
  notifier.onAgentStart();
  return { notifier, sent, suppressed: () => suppressed };
}

test("new submit sends one message with file, review URL and session", async (t) => {
  const { notifier, sent, suppressed } = setup(t);
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result());
  notifier.onToolResult(result());
  notifier.onSessionOpened(opened());
  await wait();
  assert.deepEqual(sent, [{
    title: "pi-notification",
    message: "**📝 Plan ready for review** — Demo\n\nFile: ` PLAN.md `\nReview: <http://localhost:1234/review> (id ` pn-abcdef `)",
    priority: "normal",
  }]);
  assert.equal(suppressed(), 1);
});

test("opened event arriving on a microtask after tool_result is handled", async (t) => {
  const { notifier, sent } = setup(t);
  notifier.onToolResult(result());
  queueMicrotask(() => notifier.onSessionOpened(opened()));
  await wait();
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /PLAN.md/);
});

test("revisions use the existing URL and version; approval uses the latest path", async (t) => {
  const { notifier, sent, suppressed } = setup(t);
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result());
  await wait();
  notifier.onAgentStart();
  const revision = result({
    toolCallId: "call-2", input: { filePath: "plans/revised.md" },
    details: { approved: false, pending: true, revised: true, version: 2 },
  });
  notifier.onToolResult(revision);
  notifier.onToolResult(revision);
  await wait();
  assert.equal(sent.length, 2);
  assert.match(sent[1].message, /plans\/revised.md.*\(v2\)/);
  assert.match(sent[1].message, /http:\/\/localhost:1234\/review/);
  notifier.onSessionClosed(closed());
  notifier.onSessionClosed(closed());
  await wait();
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2], {
    title: "pi-notification", message: "**✅ Plan approved** — Demo\n\nFile: ` plans/revised.md `", priority: "low",
  });
  assert.equal(suppressed(), 2, "approval must not suppress the implementation run");
});

test("unchanged, decision-in-flight, auto-approval and errors do not notify", async (t) => {
  for (const event of [
    result({ details: { approved: false, pending: true, unchanged: true } }),
    result({ details: { approved: false, pending: true, decisionInFlight: true } }),
    result({ details: { approved: true } }),
    result({ isError: true }),
    result({ details: null }),
    result({ input: {} }),
    result({ input: { filePath: "   " } }),
  ]) {
    const { notifier, sent, suppressed } = setup(t);
    notifier.onSessionOpened(opened());
    notifier.onToolResult(event);
    await wait();
    assert.equal(sent.length, 0);
    assert.equal(suppressed(), 0);
  }
});

test("approved:false without a fresh opening is not a successful new submit", async (t) => {
  const { notifier, sent } = setup(t);
  notifier.onToolResult(result({ details: { approved: false }, content: [{ type: "text", text: "Error: missing plan" }] }));
  await wait();
  assert.equal(sent.length, 0);
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result({ toolCallId: "call-2" }));
  await wait();
  notifier.onAgentStart();
  notifier.onToolResult(result({ toolCallId: "call-3", details: { approved: false } }));
  await wait();
  assert.equal(sent.length, 1, "an old review must not make a later failed submission look successful");
});

test("non-plan reviews, foreign sessions and malformed bus payloads are ignored", async (t) => {
  for (const payload of [
    null, undefined, [], "bad", {}, opened({ id: "" }), opened({ url: "bad" }),
    opened({ url: "javascript:alert(1)" }), opened({ action: "code-review" }),
    opened({ action: "annotate" }), opened({ piSessionId: "other-session" }),
  ]) {
    const { notifier, sent } = setup(t);
    assert.doesNotThrow(() => notifier.onSessionOpened(payload));
    assert.doesNotThrow(() => notifier.onSessionClosed(payload));
    notifier.onToolResult(result());
    await wait();
    assert.equal(sent.length, 0);
  }
});

test("unrelated tools and revisions with no known review do not notify", async (t) => {
  const { notifier, sent } = setup(t);
  notifier.onToolResult(result({ details: { approved: false, revised: true, version: 2 } }));
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result({ toolName: "plannotator", toolCallId: "call-2" }));
  await wait();
  assert.equal(sent.length, 0);
});

test("only matching approved closes notify, and other outcomes clear review state", async (t) => {
  for (const outcome of ["submitted", "closed"]) {
    const { notifier, sent } = setup(t);
    notifier.onSessionOpened(opened());
    notifier.onSessionClosed(closed("approved", { id: "pn-other" }));
    notifier.onSessionClosed(closed("approved", { piSessionId: "other-session" }));
    notifier.onSessionClosed(closed("approved", { action: "code-review" }));
    notifier.onSessionClosed(closed(outcome));
    notifier.onSessionClosed(closed());
    await wait();
    assert.equal(sent.length, 0);
  }
});

test("review can reopen after feedback and notify again", async (t) => {
  const { notifier, sent } = setup(t);
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result());
  await wait();
  notifier.onSessionClosed(closed("submitted"));
  notifier.onAgentStart();
  notifier.onSessionOpened(opened({ id: "pn-123456", url: "https://review.example/new" }));
  notifier.onToolResult(result({ toolCallId: "call-2" }));
  await wait();
  assert.equal(sent.length, 2);
  assert.match(sent[1].message, /https:\/\/review.example\/new/);
});

test("input toggle and child-process flags disable both messages and finish suppression", async (t) => {
  const overrides = [
    { getConfig: () => config({ input: { enabled: false } }) },
    ...["PI_SUBAGENT_CHILD", "PI_FUSION_CHILD", "UNIPI_SUBAGENT_CHILD", "UNIPI_FUSION_CHILD"]
      .map((flag) => ({ env: { [flag]: "1" } })),
  ];
  for (const deps of overrides) {
    const { notifier, sent, suppressed } = setup(t, deps);
    notifier.onSessionOpened(opened());
    notifier.onToolResult(result());
    await wait();
    notifier.onSessionClosed(closed());
    await wait();
    assert.equal(sent.length, 0);
    assert.equal(suppressed(), 0);
  }
});

test("input configuration is read again when approval arrives", async (t) => {
  const current = config();
  const { notifier, sent } = setup(t, { getConfig: () => current });
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result());
  await wait();
  current.input.enabled = false;
  notifier.onSessionClosed(closed());
  await wait();
  assert.equal(sent.length, 1);
});

test("dispose and a new agent run cancel pending suppression", async (t) => {
  for (const stop of ["dispose", "onAgentStart"]) {
    const { notifier, sent, suppressed } = setup(t);
    notifier.onSessionOpened(opened());
    notifier.onToolResult(result());
    notifier[stop]();
    await wait();
    assert.equal(sent.length, 0);
    assert.equal(suppressed(), 0);
  }
});

test("approval before the deferred submit cancels the stale ready message", async (t) => {
  const { notifier, sent, suppressed } = setup(t);
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result());
  notifier.onSessionClosed(closed());
  await wait();
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /Plan approved/);
  assert.match(sent[0].message, /PLAN.md/);
  assert.equal(suppressed(), 0);
});

test("transport failures are swallowed without holding the tool_result hook open", async (t) => {
  const { notifier, suppressed } = setup(t, { dispatch: async () => { throw new Error("offline"); } });
  notifier.onSessionOpened(opened());
  assert.equal(notifier.onToolResult(result()), undefined);
  await wait();
  assert.equal(suppressed(), 1);
  notifier.onSessionClosed(closed());
  await wait();
});

test("plan notification suppresses completion even with zero finish grace", async (t) => {
  const sent = [];
  const dispatch = recordNotifications(sent);
  const finish = createFinishNotifier(context(), { getConfig: config, env: {}, graceMs: 0, dispatch });
  t.after(() => finish.dispose());
  const { notifier } = setup(t, { dispatch, onPlanNotified: () => finish.skipCurrentRun() });
  finish.onAgentStart();
  notifier.onSessionOpened(opened());
  notifier.onToolResult(result());
  finish.onAgentSettled();
  await wait();
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /Plan ready for review/);
  notifier.onSessionClosed(closed());
  finish.onAgentStart();
  notifier.onAgentStart();
  finish.onAgentSettled();
  await wait();
  assert.equal(sent.length, 3);
  assert.match(sent[2].message, /Agent is complete/);
});

test("extension wires plan hooks, preserves tool results and cleans up subscriptions", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notify-plan-"));
  const previousCwd = process.cwd();
  const keys = ["PI_CODING_AGENT_DIR", "PI_NOTIFY_FINISH_GRACE_MS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
    "PI_SUBAGENT_CHILD", "PI_FUSION_CHILD", "UNIPI_SUBAGENT_CHILD", "UNIPI_FUSION_CHILD"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const handlers = new Map();
  const bus = new Map();
  const sent = [];
  t.after(async () => {
    await handlers.get("session_shutdown")?.();
    process.chdir(previousCwd);
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });
  for (const key of keys) delete process.env[key];
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_NOTIFY_FINISH_GRACE_MS = "0";
  process.chdir(dir);
  writeFileSync(join(dir, "notify.json"), JSON.stringify(config()));
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response("{}", { status: 200 });
  });
  notifyExtension({
    registerTool() {}, registerCommand() {}, getSessionName: () => "Demo",
    on: (name, handler) => { handlers.set(name, handler); },
    events: {
      on: (name, handler) => {
        if (!bus.has(name)) bus.set(name, new Set());
        bus.get(name).add(handler);
        return () => bus.get(name).delete(handler);
      },
    },
  });
  const emit = (name, payload) => { for (const handler of bus.get(name) ?? []) handler(payload); };
  await handlers.get("session_start")({}, context());
  await handlers.get("agent_start")();
  const openedChannel = "plannotator:session-opened";
  const closedChannel = "plannotator:session-closed";
  emit(openedChannel, opened());
  const event = result();
  const before = structuredClone(event);
  assert.equal(await handlers.get("tool_result")(event), undefined);
  assert.deepEqual(event, before);
  await handlers.get("agent_settled")({});
  await wait();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Plan ready for review/);
  emit(closedChannel, closed());
  await wait();
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Plan approved/);
  await handlers.get("session_start")({}, context());
  assert.equal(bus.get(openedChannel).size, 1);
  assert.equal(bus.get(closedChannel).size, 1);
  await handlers.get("session_shutdown")();
  assert.ok([...bus.values()].every((listeners) => listeners.size === 0));
  emit(openedChannel, opened());
  await handlers.get("tool_result")(result());
  await wait();
  assert.equal(sent.length, 2);
});
