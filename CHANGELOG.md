# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- Render Markdown notification bodies as Telegram HTML, with a plain-text fallback for rejected entities.
- Notify on final agent errors and failed context compactions.
- Notify when a running agent is waiting for user input, including `rpiv-ask-user-question` prompts.
- Add `/notify-events <error|input> <on|off>` and matching configuration toggles.
- Use the current folder name as the Telegram title for finish and `notify_user` messages.
- Preserve full finish-message bodies and generate recaps only when Telegram's 4096-character limit is exceeded.

## [0.1.0] - Initial release

- Telegram notifications for Pi.
- `notify_user` agent tool.
- Automatic settled-run recaps with configurable Pi models.
