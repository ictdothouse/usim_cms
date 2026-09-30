import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, sanitizeUrl } from "./index.js";

test("escapeHtml escapes all 5 HTML-special chars", () => {
  assert.equal(escapeHtml(`<script>alert("x") & 'y'</script>`), "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;");
});

test("escapeHtml leaves plain text unchanged", () => {
  assert.equal(escapeHtml("hello world 123"), "hello world 123");
});

test("sanitizeUrl accepts http(s) and schemeless/relative URLs", () => {
  assert.equal(sanitizeUrl("https://example.com"), "https://example.com");
  assert.equal(sanitizeUrl("http://example.com"), "http://example.com");
  assert.equal(sanitizeUrl("/about"), "/about");
  assert.equal(sanitizeUrl("#anchor"), "#anchor");
});

test("sanitizeUrl rejects javascript:/data: schemes", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeUrl("data:text/html,<script>alert(1)</script>"), null);
});

test("sanitizeUrl strips control/space chars before the scheme check (evasion)", () => {
  assert.equal(sanitizeUrl("java\tscript:alert(1)"), null);
  assert.equal(sanitizeUrl("  https://example.com  "), "https://example.com");
});

test("sanitizeUrl returns null for an empty or whitespace-only string", () => {
  assert.equal(sanitizeUrl(""), null);
  assert.equal(sanitizeUrl("   "), null);
});
