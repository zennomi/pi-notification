import { isTelegramConfigured, loadConfig, type NotifyConfig, type NotifyPriority } from "./config.ts";
import { sendTelegramMessage } from "./telegram.ts";

export interface NotificationRequest {
  title: string;
  message: string;
  priority?: NotifyPriority;
}

export interface DispatchResult {
  configured: boolean;
  sent: boolean;
  reason?: string;
  error?: string;
}

const SETUP_HINT = "Telegram is not configured. Run /notify-telegram-setup first.";

/** Send a notification without allowing transport errors to reach Pi hooks. */
export async function dispatchNotification(
  request: NotificationRequest,
  config: NotifyConfig = loadConfig(),
): Promise<DispatchResult> {
  if (!isTelegramConfigured(config)) {
    return { configured: false, sent: false, reason: SETUP_HINT };
  }

  try {
    await sendTelegramMessage(
      config.telegram.botToken!,
      config.telegram.chatId!,
      request.title,
      request.message,
      request.priority,
    );
    return { configured: true, sent: true };
  } catch (error) {
    return {
      configured: true,
      sent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export { SETUP_HINT };
