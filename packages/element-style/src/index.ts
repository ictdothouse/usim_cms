// Sanitizer core shared by apps/admin's designer/style.ts and apps/frontend's
// SectionBlock.astro — previously hand-duplicated in both places (same regex,
// copy-pasted), a real drift risk for security-critical code. Each app keeps
// its own call-site convention for what happens on an unsafe/empty URL
// (admin's safeHref falls back to "#" for an anchor; frontend's safeUrl
// returns undefined so an <img>/bgImage can skip rendering instead of
// pointing at a broken URL) — only the actual validation logic is unified.

export function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

// Browsers discard ASCII control/space chars (0x00-0x20) from anywhere in a
// URL before parsing its scheme, not just the ends — a bare .trim() left
// "java\tscript:alert(1)" able to slip past the scheme regex below while
// still executing as javascript: once rendered. Stripping them from the
// whole string (not just trimming) closes that. Only http(s) or a schemeless
// (relative) URL passes; anything else (javascript:, data:, etc.) is
// rejected — returns null so each call site picks its own fallback.
export function sanitizeUrl(u: string): string | null {
  // eslint-disable-next-line no-control-regex -- control chars are the whole point, see above
  const v = u.replace(/[\x00-\x20]+/g, "");
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return /^https?:/i.test(v) ? v : null;
  return v;
}

// The Custom HTML element's allowlist. apps/frontend's sanitize-custom-html.ts
// hands these to sanitize-html at render time (the security boundary); the
// Designer's Inspector reads them through customHtmlRemovals below to tell
// the editor what the live site will drop. One list, so the two can't drift.
export const CUSTOM_HTML_ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "caption", "code", "dd", "del", "div", "dl", "dt", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "ol", "p", "pre", "s",
  "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
];
export const CUSTOM_HTML_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "name", "target", "rel", "title"],
  img: ["src", "alt", "title", "width", "height", "loading"],
  "*": ["class", "id", "title", "role", "aria-label", "aria-hidden"],
};
export const CUSTOM_HTML_ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

// sanitize-html's own href/src check with this element's options
// (allowProtocolRelative: false): control/space chars are dropped first, a
// relative URL passes, "//host" doesn't, a scheme must be on the list.
function customHtmlUrlOk(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- same evasion as sanitizeUrl above
  const v = value.replace(/[\x00-\x20]+/g, "");
  const scheme = /^([a-zA-Z][a-zA-Z0-9.+-]*):/.exec(v)?.[1];
  return scheme ? CUSTOM_HTML_ALLOWED_SCHEMES.includes(scheme.toLowerCase()) : !/^[/\\]{2}/.test(v);
}

// What the site's sanitizer will strip from `raw`, for the Inspector's hint:
// each disallowed tag as "<tag>", each disallowed attribute by name (an
// href/src with a refused scheme included), first-seen order, no repeats.
// ponytail: a regex tag scan, not an HTML parser — entity-encoded URLs
// ("jav&#97;script:") and tags split by odd markup slip past it. Fine for a
// hint; sanitize-custom-html.test.ts checks it against the real sanitizer.
export function customHtmlRemovals(raw: string): string[] {
  const out = new Set<string>();
  // Comments go, and script/style bodies are text, not markup (sanitize-html
  // drops both the same way) — so an `a<b` inside a script isn't a "tag".
  const html = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|textarea|option)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "<$1>");
  for (const [, rawTag, attrs] of html.matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const tag = rawTag.toLowerCase();
    if (!CUSTOM_HTML_ALLOWED_TAGS.includes(tag)) {
      out.add(`<${tag}>`);
      continue;
    }
    const allowed = [...(CUSTOM_HTML_ALLOWED_ATTRIBUTES[tag] ?? []), ...CUSTOM_HTML_ALLOWED_ATTRIBUTES["*"]];
    for (const [, rawName, dq, sq, bare] of attrs.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = rawName.toLowerCase();
      const value = dq ?? sq ?? bare ?? "";
      if (!allowed.includes(name) || ((name === "href" || name === "src") && !customHtmlUrlOk(value))) out.add(name);
    }
  }
  return [...out];
}
