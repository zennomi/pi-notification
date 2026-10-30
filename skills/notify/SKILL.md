---
name: notify
description: >
  Send an urgent Telegram notification through Pi's notify_user tool when the user
  needs to know about a critical result or a long-running task completion. pi-notification
  also alerts on final errors and prompts waiting for user input.
allowed-tools:
  - notify_user
---

# Notify User

Use `notify_user` to send a message to the user's configured Telegram chat.

## When to use

- Critical errors that need the user's attention
- Completion of a long-running task
- Security concerns or suspicious activity
- Results the user explicitly asked you to send

## When not to use

- Routine progress updates
- Every turn completion
- Non-urgent information

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `message` | string | required | Notification body |
| `title` | string? | none | Optional heading shown on the first line of the body; the Telegram title is the current folder name |
| `priority` | string? | `normal` | `low`, `normal`, or `high`; low disables Telegram sound |

## Examples

```text
notify_user({
  title: "Build Failed",
  message: "TypeScript compilation failed with 12 errors. Check src/auth.ts.",
  priority: "high"
})
```

```text
notify_user({
  title: "Deployment Complete",
  message: "The deployment finished and all health checks passed."
})
```

The Telegram title is the current working folder name. Notification bodies support Markdown and are rendered as Telegram HTML. Finish notifications include the full last assistant response; a recap is generated only when the message exceeds Telegram's 4096-character limit. If a `notify_user` message is too long, the optional `title` remains the first body line while the body is recapped or truncated to fit. Error and input alerts can be toggled with `/notify-events error|input on|off`.

Configure the Telegram bot with `/notify-telegram-setup` before using the tool.
