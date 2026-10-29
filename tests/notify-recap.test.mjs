import assert from "node:assert/strict";
import test from "node:test";
import {
  extractLastAssistantText,
  extractLastAssistantTextFromSession,
  fallbackSummary,
  fitTelegramBody,
  parseModelRef,
  summarizeLastMessage,
  truncateToLength,
} from "../lib/notify/recap.ts";

function context(streamResult, modelRef = "") {
  const model = { provider: "session", id: "model" };
  const calls = { stream: 0 };
  const ctx = {
    model,
    modelRegistry: {
      find: (provider, modelId) => provider === "openai" && modelId === "gpt" ? model : undefined,
      streamSimple: () => {
        calls.stream += 1;
        return { result: streamResult };
      },
    },
    modelRef,
  };
  return Object.assign(ctx, { calls });
}

test("parses provider/model references and rejects malformed references", () => {
  assert.deepEqual(parseModelRef("openai/gpt"), { provider: "openai", modelId: "gpt" });
  assert.equal(parseModelRef("gpt"), null);
  assert.equal(parseModelRef("/gpt"), null);
});

test("recap uses the selected model and extracts text", async () => {
  let result = null;
  const ctx = context(async () => ({ role: "assistant", content: " concise recap " }));
  ctx.modelRegistry.streamSimple = (model, request, options) => {
    result = { model, request, options };
    return { result: async () => ({ role: "assistant", content: " concise recap " }) };
  };
  assert.equal(await summarizeLastMessage("A long answer", ctx, "openai/gpt"), "concise recap");
  assert.equal(result.request.systemPrompt.includes("one concise sentence"), true);
  assert.equal(result.options.maxTokens, 100);
  assert.equal(result.options.reasoning, "minimal");
});

test("recap falls back for missing model, empty result, and errors", async () => {
  const text = "A useful answer";
  assert.equal(await summarizeLastMessage(text, context(async () => ({ role: "assistant", content: "" })), "openai/missing"), text);
  assert.equal(await summarizeLastMessage(text, context(async () => ({ role: "assistant", content: "" }))), "A useful answer");
  assert.equal(await summarizeLastMessage(text, context(async () => { throw new Error("failed"); })), text);
});

test("recap timeout returns the truncated fallback", async () => {
  const text = "x".repeat(150);
  const result = await summarizeLastMessage(
    text,
    context(() => new Promise(() => {})),
    "",
    5,
  );
  assert.equal(result, `${"x".repeat(100)}...`);
});

test("assistant extraction handles payloads, text blocks, and session entries", () => {
  assert.equal(extractLastAssistantText({ messages: [
    { role: "assistant", content: "first" },
    { role: "assistant", content: [{ type: "text", text: "second" }] },
  ] }), "second");
  assert.equal(extractLastAssistantText({ messages: [{ role: "user", content: "no" }] }), null);
  const ctx = { sessionManager: { getEntries: () => [
    { type: "message", message: { role: "user", content: "question" } },
    { type: "message", message: { role: "assistant", content: "answer" } },
  ] } };
  assert.equal(extractLastAssistantTextFromSession(ctx), "answer");
});

test("fallbackSummary trims and truncates to 100 characters", () => {
  assert.equal(fallbackSummary("  short  "), "short");
  assert.equal(fallbackSummary("a".repeat(101)), `${"a".repeat(100)}...`);
});

test("fitTelegramBody keeps short messages verbatim without a recap", async () => {
  let calls = 0;
  const ctx = context(async () => {
    calls += 1;
    return { role: "assistant", content: "unexpected recap" };
  });
  assert.equal(await fitTelegramBody({
    title: "folder",
    prefix: "Session: ",
    text: "short answer",
    ctx,
    recap: { enabled: true, model: "" },
  }), "Session: short answer");
  assert.equal(ctx.calls.stream, 0);
});

test("fitTelegramBody recaps over-limit messages", async () => {
  const ctx = context(async () => ({ role: "assistant", content: "recap" }));
  assert.equal(await fitTelegramBody({
    title: "folder",
    prefix: "Session: ",
    text: "x".repeat(30),
    ctx,
    recap: { enabled: true, model: "" },
    limit: 21,
  }), "Session: recap");
});

test("fitTelegramBody truncates when recap is disabled or fails", async () => {
  const disabled = await fitTelegramBody({
    title: "folder",
    prefix: "P: ",
    text: "x".repeat(30),
    recap: { enabled: false, model: "" },
    limit: 20,
  });
  assert.equal(disabled.length, 20 - "folder".length - 1);
  assert.match(disabled, /\.\.\.$/);

  const failed = await fitTelegramBody({
    title: "folder",
    prefix: "P: ",
    text: "x".repeat(30),
    ctx: context(async () => { throw new Error("failed"); }),
    recap: { enabled: true, model: "" },
    limit: 20,
  });
  assert.equal(failed.length, disabled.length);
  assert.match(failed, /\.\.\.$/);
});

test("fitTelegramBody truncates a recap that is still too long", async () => {
  const result = await fitTelegramBody({
    title: "folder",
    prefix: "P: ",
    text: "x".repeat(30),
    ctx: context(async () => ({ role: "assistant", content: "y".repeat(30) })),
    recap: { enabled: true, model: "" },
    limit: 20,
  });
  assert.equal(result.length, 20 - "folder".length - 1);
  assert.match(result, /\.\.\.$/);
});

test("truncateToLength appends an ellipsis without exceeding the limit", () => {
  assert.equal(truncateToLength("short", 10), "short");
  assert.equal(truncateToLength("abcdefgh", 5), "ab...");
  assert.equal(truncateToLength("abcdefgh", 2), "..");
});
