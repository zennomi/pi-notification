export function notificationConfig({ finish, recap, error, input } = {}) {
  return {
    telegram: { enabled: true, botToken: "token", chatId: "chat" },
    finish: { enabled: true, ...finish },
    recap: { enabled: false, model: "", ...recap },
    error: { enabled: true, ...error },
    input: { enabled: true, ...input },
  };
}

export const recordNotifications = (sent) => async (request) => {
  sent.push(request);
  return { configured: true, sent: true };
};
