# pi-notification

Telegram notifications for [Pi](https://pi.dev): send urgent messages with `notify_user` and receive a concise recap when an agent run finishes.

[![CI](https://github.com/zennomi/pi-notification/actions/workflows/ci.yml/badge.svg)](https://github.com/zennomi/pi-notification/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-notification.svg)](https://www.npmjs.com/package/pi-notification)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- Telegram Bot API delivery with MarkdownV2 formatting.
- `notify_user` tool for critical errors, long-running task completion, and requested alerts.
- One Telegram message after a settled agent run, with the full assistant response when it fits Telegram's limit.
- Automatic recap only when a message exceeds Telegram's 4096-character limit.
- Automatic chat-ID detection during setup.

## Install

```bash
pi install npm:pi-notification
```

For local development:

```bash
pi -e .
```

## Configure Telegram

1. Open Telegram and message `@BotFather`.
2. Send `/newbot` and copy the bot token.
3. In Pi, run:

```text
/notify-telegram-setup
```

Paste the token, then send any message to the new bot. The extension polls Telegram for the chat ID and saves the configuration to `~/.pi/agent/notify.json`.

You can send a test message with:

```text
/notify-test
```

Environment variables override file values for temporary use:

```bash
TELEGRAM_BOT_TOKEN=123:token TELEGRAM_CHAT_ID=456 pi
```

A project-local `.pi/notify.json` can override global settings. Secrets saved by the setup command are always written globally.

## Telegram message format

Finish notifications and `notify_user` messages use the current working folder name as the Telegram title. Finish notification bodies contain the session name (when available) followed by the full last assistant message. For `notify_user`, an optional `title` is included as the first line of the body; the Telegram title remains the folder name.

Recaps are generated only when the title and body would exceed Telegram's 4096-character message limit. If recapping is disabled, fails, or is still too long, the body is truncated to fit the limit. `/notify-test` and the setup confirmation keep their explicit titles.

## Configuration

```json
{
  "telegram": {
    "enabled": true,
    "botToken": "123:token",
    "chatId": "456"
  },
  "finish": { "enabled": true },
  "recap": { "enabled": true, "model": "" }
}
```

An empty `recap.model` uses the current session model. Set it to `provider/model-id` to use another configured Pi model. Disable automatic recaps with:

```text
/notify-recap off
```

## `notify_user`

The tool accepts `message`, optional body heading `title`, and optional `priority` (`low`, `normal`, or `high`). The Telegram title is always the current folder name; a supplied `title` is placed on the first line of the body. Low-priority Telegram messages disable notification sound.

```text
notify_user({
  title: "Build Failed",
  message: "TypeScript compilation failed. Check the error output.",
  priority: "high"
})
```

Use it for actionable notifications, not routine status updates or every turn completion.

## Development

```bash
npm ci
npm run ci
```

## Credits

Telegram transport and notification behavior are a focused fork of [`Neuron-Mr-White/UniPi` notify](https://github.com/Neuron-Mr-White/UniPi/tree/main/packages/notify), used under its MIT license.
