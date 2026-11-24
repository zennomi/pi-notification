import { lexer, type Token, type Tokens } from "marked";

/** Escape text for Telegram's HTML parse mode. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    return ["http:", "https:", "tg:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

function inlineTokens(text: string): Token[] {
  return lexer(text).flatMap((token) => ("tokens" in token && token.tokens) || [token]);
}

function renderInlineTokens(tokens: Token[]): string {
  return tokens.map(renderInlineToken).join("");
}

function renderInline(text: string): string {
  return renderInlineTokens(inlineTokens(text));
}

function renderChildren(token: { tokens?: Token[]; text?: string }): string {
  return renderInlineTokens(token.tokens ?? inlineTokens(token.text ?? ""));
}

function renderLink(body: string, destination: unknown): string {
  const href = safeHref(destination);
  return href ? `<a href="${escapeHtml(href)}">${body}</a>` : body;
}

function renderInlineToken(token: Token): string {
  switch (token.type) {
    case "strong":
      return `<b>${renderChildren(token)}</b>`;
    case "em":
      return `<i>${renderChildren(token)}</i>`;
    case "del":
      return `<s>${renderChildren(token)}</s>`;
    case "codespan":
      return `<code>${escapeHtml(String(token.text ?? ""))}</code>`;
    case "link":
      return renderLink(renderChildren(token), token.href);
    case "image":
      return renderLink(renderInline(String(token.text ?? "")), token.href);
    case "br":
      return "\n";
    case "escape":
    case "text":
    case "html":
      return escapeHtml(String(token.text ?? ""));
    default:
      if ("tokens" in token && Array.isArray(token.tokens)) return renderInlineTokens(token.tokens);
      return escapeHtml(String(("text" in token ? token.text : undefined) ?? token.raw ?? ""));
  }
}

function renderList(token: Tokens.List | Tokens.Generic, depth: number): string {
  const indent = "  ".repeat(depth);
  const items: Tokens.ListItem[] = token.items ?? [];
  return items.map((item, index) => {
    const marker = token.ordered ? `${Number(token.start || 1) + index}. ` : "• ";
    const task = item.task ? `${item.checked ? "☑" : "☐"} ` : "";
    const parts: string[] = [];
    let first = true;
    for (const child of item.tokens ?? []) {
      if (child.type === "checkbox") continue;
      if (child.type === "list") {
        parts.push(renderList(child, depth + 1));
      } else if (child.type === "text" || child.type === "paragraph") {
        let content = renderChildren(child);
        if (item.task && first) content = content.replace(/^\[\s*[x ]\s*\]\s*/i, "");
        if (first) {
          parts.push(`${indent}${marker}${task}${content}`);
          first = false;
        } else if (content) {
          parts.push(`${indent}  ${content}`);
        }
      } else {
        const content = renderBlockToken(child, depth + 1).trimEnd();
        if (content) {
          if (first) {
            parts.push(`${indent}${marker}${task}${content}`);
            first = false;
          } else parts.push(content);
        }
      }
    }
    if (first) parts.push(`${indent}${marker}${task}`.trimEnd());
    return parts.join("\n");
  }).join("\n");
}

function renderTable(token: Tokens.Table | Tokens.Generic): string {
  const cells: Tokens.TableCell[][] = [token.header ?? [], ...(token.rows ?? [])];
  const rows = cells.map((row) => row.map((cell) => stripTags(renderChildren(cell))));
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length))) ?? [];
  return rows.map((row, index) => {
    const line = row.map((cell, column) => cell.padEnd(widths[column] ?? cell.length)).join(" | ");
    return index === 0 && rows.length > 1 ? `${line}\n${widths.map((width) => "-".repeat(width)).join("-+-")}` : line;
  }).join("\n");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function renderBlockToken(token: Token, depth = 0): string {
  switch (token.type) {
    case "space":
      return "";
    case "paragraph":
    case "text":
      return renderChildren(token);
    case "heading":
      return `<b>${renderChildren(token)}</b>`;
    case "blockquote":
      return `<blockquote>${renderBlocks(token.tokens ?? []).trim()}</blockquote>`;
    case "list":
      return renderList(token, depth);
    case "code": {
      const language = typeof token.lang === "string" && /^[\w+-]+$/.test(token.lang)
        ? ` class="language-${escapeHtml(token.lang)}"`
        : "";
      return `<pre><code${language}>${escapeHtml(String(token.text ?? ""))}</code></pre>`;
    }
    case "table":
      return `<pre>${escapeHtml(renderTable(token))}</pre>`;
    case "hr":
      return "———";
    case "html":
      return escapeHtml(String(token.text ?? token.raw ?? ""));
    default:
      if ("tokens" in token && token.tokens) return renderInlineTokens(token.tokens);
      return renderInline(("text" in token ? token.text : undefined) ?? token.raw ?? "");
  }
}

function renderBlocks(tokens: Token[]): string {
  return tokens
    .map((token) => renderBlockToken(token))
    .filter(Boolean)
    .join("\n\n");
}

/** Convert CommonMark-ish Markdown into Telegram's supported HTML subset. */
export function markdownToTelegramHtml(markdown: string): string {
  return renderBlocks(lexer(markdown));
}
