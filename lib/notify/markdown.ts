import { lexer } from "marked";

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

function inlineTokens(text: string): any[] {
  const tokens = lexer(text);
  return tokens.flatMap((token: any) => token.tokens ?? [token]);
}

function renderInlineTokens(tokens: any[]): string {
  return tokens.map((token) => renderInlineToken(token)).join("");
}

function renderInline(text: string): string {
  return renderInlineTokens(inlineTokens(text));
}

function renderInlineToken(token: any): string {
  switch (token.type) {
    case "strong":
      return `<b>${renderInlineTokens(token.tokens ?? inlineTokens(token.text ?? ""))}</b>`;
    case "em":
      return `<i>${renderInlineTokens(token.tokens ?? inlineTokens(token.text ?? ""))}</i>`;
    case "del":
      return `<s>${renderInlineTokens(token.tokens ?? inlineTokens(token.text ?? ""))}</s>`;
    case "codespan":
      return `<code>${escapeHtml(String(token.text ?? ""))}</code>`;
    case "link": {
      const body = renderInlineTokens(token.tokens ?? inlineTokens(token.text ?? ""));
      const href = safeHref(token.href);
      return href ? `<a href="${escapeHtml(href)}">${body}</a>` : body;
    }
    case "image": {
      const body = renderInline(String(token.text ?? ""));
      const href = safeHref(token.href);
      return href ? `<a href="${escapeHtml(href)}">${body}</a>` : body;
    }
    case "br":
      return "\n";
    case "escape":
    case "text":
    case "html":
      return escapeHtml(String(token.text ?? ""));
    default:
      if (Array.isArray(token.tokens)) return renderInlineTokens(token.tokens);
      return escapeHtml(String(token.text ?? token.raw ?? ""));
  }
}

function renderList(token: any, depth: number): string {
  const indent = "  ".repeat(depth);
  const items = (token.items ?? []).map((item: any, index: number) => {
    const marker = token.ordered ? `${Number(token.start || 1) + index}. ` : "• ";
    const task = item.task ? `${item.checked ? "☑" : "☐"} ` : "";
    const parts: string[] = [];
    let first = true;
    for (const child of item.tokens ?? []) {
      if (child.type === "checkbox") continue;
      if (child.type === "list") {
        parts.push(renderList(child, depth + 1));
      } else if (child.type === "text" || child.type === "paragraph") {
        let content = child.tokens ? renderInlineTokens(child.tokens) : renderInline(child.text ?? "");
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
  });
  return items.join("\n");
}

function renderTable(token: any): string {
  const rows = [token.header ?? [], ...(token.rows ?? [])].map((row: any[]) =>
    row.map((cell) => stripTags(renderInlineTokens(cell.tokens ?? inlineTokens(cell.text ?? "")))));
  const widths = rows[0]?.map((_: unknown, column: number) =>
    Math.max(...rows.map((row: string[]) => (row[column] ?? "").length))) ?? [];
  return rows.map((row: string[], index: number) => {
    const line = row.map((cell, column) => cell.padEnd(widths[column] ?? cell.length)).join(" | ");
    return index === 0 && rows.length > 1 ? `${line}\n${widths.map((width) => "-".repeat(width)).join("-+-")}` : line;
  }).join("\n");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function renderBlockToken(token: any, depth = 0): string {
  switch (token.type) {
    case "space":
      return "";
    case "paragraph":
      return token.tokens ? renderInlineTokens(token.tokens) : renderInline(token.text ?? "");
    case "heading":
      return `<b>${token.tokens ? renderInlineTokens(token.tokens) : renderInline(token.text ?? "")}</b>`;
    case "text":
      return token.tokens ? renderInlineTokens(token.tokens) : renderInline(token.text ?? "");
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
      return token.tokens ? renderInlineTokens(token.tokens) : renderInline(token.text ?? token.raw ?? "");
  }
}

function renderBlocks(tokens: any[]): string {
  return tokens
    .map((token) => renderBlockToken(token))
    .filter(Boolean)
    .join("\n\n");
}

/** Convert CommonMark-ish Markdown into Telegram's supported HTML subset. */
export function markdownToTelegramHtml(markdown: string): string {
  return renderBlocks(lexer(markdown));
}
