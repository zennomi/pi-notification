/** Telegram Bot API transport used by the notification extension. */

import type { NotifyPriority } from "./config.ts";

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
  const text = `*${escapeMarkdownV2(title)}*\n${escapeMarkdownV2(message)}`;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      ...(priority === "low" ? { disable_notification: true } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "<no body>");
    throw new Error(`Telegram API error ${response.status}: ${body}`);
  }
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
