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

test("sendTelegramMessage sends HTML and quiet low-priority messages", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response("{}", { status: 200 });
  };

  await sendTelegramMessage("token", "123", "Build <done>", "**A_b**", "low");
  assert.equal(request.url, "https://api.telegram.org/bottoken/sendMessage");
  assert.deepEqual(JSON.parse(request.options.body), {
    chat_id: "123",
    text: "<b>Build &lt;done&gt;</b>\n<b>A_b</b>",
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    disable_notification: true,
  });
});

test("sendTelegramMessage retries as plain text when Telegram rejects HTML entities", async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1
      ? new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }), { status: 400 })
      : new Response("{}", { status: 200 });
  };

  await sendTelegramMessage("token", "123", "Title", "**A**");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].text, "Title\n**A**");
  assert.equal(requests[1].parse_mode, undefined);
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
