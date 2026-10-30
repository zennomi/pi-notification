import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, markdownToTelegramHtml } from "../lib/notify/markdown.ts";

test("converts headings and inline formatting to Telegram HTML", () => {
  assert.equal(
    markdownToTelegramHtml("# Title\n\n**bold**, *italic*, ~~deleted~~, and `code`."),
    "<b>Title</b>\n\n<b>bold</b>, <i>italic</i>, <s>deleted</s>, and <code>code</code>.",
  );
});

test("renders unordered, ordered, nested, and task lists", () => {
  const html = markdownToTelegramHtml("- one\n  - nested\n1. two\n- [x] done");
  assert.match(html, /• one/);
  assert.match(html, /  • nested/);
  assert.match(html, /1\. two/);
  assert.match(html, /☑ done/);
});

test("renders fenced code and blockquotes", () => {
  assert.equal(
    markdownToTelegramHtml("> quoted\n\n```ts\nconst x = 1 < 2;\n```"),
    "<blockquote>quoted</blockquote>\n\n<pre><code class=\"language-ts\">const x = 1 &lt; 2;</code></pre>",
  );
});

test("renders safe links and drops unsafe link destinations", () => {
  assert.equal(
    markdownToTelegramHtml("[site](https://example.com) [bad](javascript:alert(1))"),
    '<a href="https://example.com">site</a> bad',
  );
});

test("escapes source text and HTML attributes", () => {
  assert.equal(escapeHtml('<tag a="b"> &'), "&lt;tag a=&quot;b&quot;&gt; &amp;");
  assert.equal(markdownToTelegramHtml("<script>alert('x')</script> &"), "&lt;script&gt;alert('x')&lt;/script&gt; &amp;");
});

test("renders tables as escaped preformatted text", () => {
  assert.equal(
    markdownToTelegramHtml("| A | B |\n| --- | --- |\n| 1 | 22 |"),
    "<pre>A | B \n--+---\n1 | 22</pre>",
  );
});
