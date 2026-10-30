/** Telegram Bot API transport used by the notification extension. */

import type { NotifyPriority } from "./config.ts";
import { escapeHtml, markdownToTelegramHtml } from "./markdown.ts";

export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export function telegramTextLength(title: string, body: string): number {
  return title.length + 1 + body.length;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  title: string,
  message: string,
  priority: NotifyPriority = "normal",
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const common = {
    chat_id: chatId,
    ...(priority === "low" ? { disable_notification: true } : {}),
    link_preview_options: { is_disabled: true },
  };
  const send = (text: string, parseMode?: "HTML") => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...common,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
  });

  const response = await send(`<b>${escapeHtml(title)}</b>\n${markdownToTelegramHtml(message)}`, "HTML");
  if (response.ok) return;

  const body = await response.text().catch(() => "<no body>");
  if (response.status === 400 && /can't parse entities/i.test(body)) {
    const fallback = await send(`${title}\n${message}`);
    if (fallback.ok) return;
    const fallbackBody = await fallback.text().catch(() => "<no body>");
    throw new Error(`Telegram API error ${fallback.status}: ${fallbackBody}`);
  }
  throw new Error(`Telegram API error ${response.status}: ${body}`);
}

export async function pollForChatId(
  botToken: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?allowed_updates=["message"]`;

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const data = await response.json() as {
      ok?: boolean;
      result?: Array<{
        message?: { chat?: { id?: number } };
        callback_query?: { message?: { chat?: { id?: number } } };
      }>;
    };

    if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) return null;
    const lastUpdate = data.result[data.result.length - 1];
    const chatId = lastUpdate.message?.chat?.id ?? lastUpdate.callback_query?.message?.chat?.id;
    return chatId === undefined ? null : String(chatId);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
