import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  isTelegramConfigured,
  loadConfig,
  saveGlobalConfig,
  type NotifyPriority,
} from "../../lib/notify/config.ts";
import { dispatchNotification, SETUP_HINT } from "../../lib/notify/dispatch.ts";
import { createFinishNotifier, type FinishNotifier } from "../../lib/notify/finish.ts";
import { fitTelegramBody } from "../../lib/notify/recap.ts";
import { pollForChatId } from "../../lib/notify/telegram.ts";

const NotifyUserSchema = Type.Object({
  message: Type.String({ description: "Notification message body" }),
  title: Type.Optional(Type.String({
    description: "Optional heading shown on the first line of the message (Telegram title is the current folder name)",
  })),
  priority: Type.Optional(StringEnum(["low", "normal", "high"] as const, {
    description: "Priority level",
  })),
});

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

let sessionContext: ExtensionContext | undefined;
let finishNotifier: FinishNotifier | undefined;

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

async function waitForChatId(token: string, signal: AbortSignal | undefined): Promise<string | null> {
  const started = Date.now();
  while (!signal?.aborted && Date.now() - started <= POLL_TIMEOUT_MS) {
    const chatId = await pollForChatId(token, signal);
    if (chatId) return chatId;
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "notify_user",
    label: "Notify User",
    description:
      "Send a Telegram notification to the user. Use for critical errors, completion of long-running tasks, "
      + "or when the user explicitly asked to be notified.",
    parameters: NotifyUserSchema,
    async execute(_toolCallId, params) {
      const { message, title, priority } = params as {
        message: string;
        title?: string;
        priority?: NotifyPriority;
      };
      const config = loadConfig();
      if (!isTelegramConfigured(config)) {
        return textResult(SETUP_HINT, { configured: false });
      }

      const folderTitle = basename(sessionContext?.cwd ?? process.cwd());
      const bodyText = title ? `${title}\n${message}` : message;
      void fitTelegramBody({
        title: folderTitle,
        prefix: "",
        text: bodyText,
        ctx: sessionContext,
        recap: config.recap,
      }).then((body) => dispatchNotification({
        title: folderTitle,
        message: body,
        priority,
      }, config)).catch(() => {
        // Dispatch is deliberately non-blocking for the agent tool.
      });
      return textResult("Notification sending to telegram", {
        configured: true,
        platform: "telegram",
        priority,
      });
    },
  });

  pi.registerCommand("notify-telegram-setup", {
    description: "Configure Telegram notifications with a bot token and automatic chat-id detection",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      const token = (await ctx.ui.input("Telegram bot token (from @BotFather)"))?.trim();
      if (!token) {
        ctx.ui.notify("Telegram setup cancelled.", "warning");
        return;
      }

      ctx.ui.notify("Send any message to your Telegram bot; waiting for the chat ID…", "info");
      const chatId = await waitForChatId(token, ctx.signal);
      if (!chatId) {
        ctx.ui.notify(ctx.signal?.aborted ? "Telegram setup cancelled." : "Timed out waiting for a Telegram message.", "warning");
        return;
      }

      const config = saveGlobalConfig({
        telegram: { enabled: true, botToken: token, chatId },
      });
      const result = await dispatchNotification({
        title: "Pi — Telegram configured",
        message: "Telegram notifications are configured successfully.",
      }, config);
      ctx.ui.notify(result.sent ? "Telegram notifications configured and tested." : `Telegram configured, but test failed: ${result.error ?? result.reason}`, result.sent ? "info" : "warning");
    },
  });

  pi.registerCommand("notify-test", {
    description: "Send a test Telegram notification",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const result = await dispatchNotification({
        title: "Pi — Test Notification",
        message: `Test notification sent at ${new Date().toLocaleTimeString()}`,
      });
      if (result.sent) ctx.ui.notify("✓ Telegram: sent", "info");
      else ctx.ui.notify(result.reason ?? `✗ Telegram: ${result.error ?? "failed"}`, result.configured ? "error" : "warning");
    },
  });

  pi.registerCommand("notify-recap", {
    description: "Enable or disable recap messages after agent runs: on|off",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const value = args.trim().toLowerCase();
      if (value !== "on" && value !== "off") {
        ctx.ui.notify("Usage: /notify-recap <on|off>", "warning");
        return;
      }
      saveGlobalConfig({ recap: { enabled: value === "on" } });
      ctx.ui.notify(`Recap is now ${value}.`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionContext = ctx;
    finishNotifier?.dispose();
    finishNotifier = createFinishNotifier(ctx, {
      getConfig: loadConfig,
      getSessionName: () => pi.getSessionName?.(),
    });
  });

  pi.on("agent_start", async () => {
    finishNotifier?.onAgentStart();
  });

  pi.on("agent_settled", async (event) => {
    finishNotifier?.onAgentSettled(event);
  });

  pi.on("session_shutdown", async () => {
    finishNotifier?.dispose();
    finishNotifier = undefined;
    sessionContext = undefined;
  });
}
