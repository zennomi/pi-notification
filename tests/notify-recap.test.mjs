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

function context(streamResult) {
  const model = { provider: "session", id: "model" };
  const calls = { stream: 0 };
  const ctx = {
    model,
    modelRegistry: {
      find: (provider, modelId) => provider === "openai" && modelId === "gpt" ? { provider, id: modelId } : undefined,
      streamSimple: (selected, request) => {
        calls.stream += 1;
        return { result: () => streamResult(selected, request) };
      },
    },
  };
  return Object.assign(ctx, { calls });
}

test("parses provider/model references and rejects malformed references", () => {
  assert.deepEqual(parseModelRef("openai/gpt"), { provider: "openai", modelId: "gpt" });
  assert.equal(parseModelRef("gpt"), null);
  assert.equal(parseModelRef("/gpt"), null);
});

test("recap uses the selected model and extracts text", async () => {
  const ctx = context(async (selected, request) => ({
    role: "assistant",
    content: ` ${selected.provider}/${selected.id} summarized: ${request.messages.at(-1).content} `,
  }));
  assert.equal(await summarizeLastMessage("A long answer", ctx, "openai/gpt"), "openai/gpt summarized: A long answer");
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
  const ctx = context(async () => ({ role: "assistant", content: "unexpected recap" }));
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
    text: "Initial answer is too long to fit",
    recap: { enabled: false, model: "" },
    limit: 20,
  });
  assert.equal(disabled, "P: Initial...");

  const failed = await fitTelegramBody({
    title: "folder",
    prefix: "P: ",
    text: "Initial answer is too long to fit",
    ctx: context(async () => { throw new Error("failed"); }),
    recap: { enabled: true, model: "" },
    limit: 20,
  });
  assert.equal(failed, "P: Initial...");
});

test("fitTelegramBody truncates a recap that is still too long", async () => {
  const result = await fitTelegramBody({
    title: "folder",
    prefix: "P: ",
    text: "x".repeat(30),
    ctx: context(async () => ({ role: "assistant", content: "Summary is too long to fit" })),
    recap: { enabled: true, model: "" },
    limit: 20,
  });
  assert.equal(result, "P: Summary...");
});

test("truncateToLength appends an ellipsis without exceeding the limit", () => {
  assert.equal(truncateToLength("short", 10), "short");
  assert.equal(truncateToLength("abcdefgh", 5), "ab...");
  assert.equal(truncateToLength("abcdefgh", 2), "..");
});
