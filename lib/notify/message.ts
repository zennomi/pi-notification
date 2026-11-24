export function heading(label: string, detail?: string): string {
  return `**${label}**${detail ? ` — ${detail}` : ""}`;
}

export function fencedError(message: string): string {
  return "```\n" + message.replaceAll("```", "``\u200b`") + "\n```";
}
