import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeMarkdownV2,
  pollForChatId,
  sendTelegramMessage,
} from "../lib/notify/telegram.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("escapes Telegram MarkdownV2 punctuation", () => {
  assert.equal(escapeMarkdownV2("a_b *c* [d] (e) !"), "a\\_b \\*c\\* \\[d\\] \\(e\\) \\!");
});

test("sendTelegramMessage sends formatted JSON and quiet low-priority messages", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response("{}", { status: 200 });
  };

  await sendTelegramMessage("token", "123", "Build done", "A_b", "low");
  assert.equal(request.url, "https://api.telegram.org/bottoken/sendMessage");
  assert.deepEqual(JSON.parse(request.options.body), {
    chat_id: "123",
    text: "*Build done*\nA\\_b",
    parse_mode: "MarkdownV2",
    disable_notification: true,
  });
});

test("Telegram API errors include status/body but not the bot token", async () => {
  globalThis.fetch = async () => new Response("invalid token", { status: 401 });
  await assert.rejects(
    sendTelegramMessage("secret-token", "123", "Title", "Message"),
    (error) => error instanceof Error
      && error.message.includes("401")
      && error.message.includes("invalid token")
      && !error.message.includes("secret-token"),
  );
});

test("pollForChatId returns the last message chat id", async () => {
  let calledUrl = "";
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({
      ok: true,
      result: [
        { message: { chat: { id: 10 } } },
        { callback_query: { message: { chat: { id: 20 } } } },
      ],
    }), { status: 200 });
  };

  assert.equal(await pollForChatId("token"), "20");
  assert.match(calledUrl, /getUpdates/);
});
