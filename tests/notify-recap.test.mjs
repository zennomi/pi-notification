import assert from "node:assert/strict";
import test from "node:test";
import {
  extractLastAssistantText,
  extractLastAssistantTextFromSession,
  fallbackSummary,
  parseModelRef,
  summarizeLastMessage,
} from "../lib/notify/recap.ts";

function context(streamResult, modelRef = "") {
  const model = { provider: "session", id: "model" };
  return {
    model,
    modelRegistry: {
      find: (provider, modelId) => provider === "openai" && modelId === "gpt" ? model : undefined,
      streamSimple: () => ({ result: streamResult }),
    },
    modelRef,
  };
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
