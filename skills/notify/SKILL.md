---
name: notify
description: >
  Send an urgent Telegram notification through Pi's notify_user tool when the user
  needs to know about a critical result or a long-running task completion.
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
| `title` | string? | `Pi Notification` | Notification title |
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

Configure the Telegram bot with `/notify-telegram-setup` before using the tool.
