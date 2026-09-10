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
  const v = u.replace(/[\x00-\x20]+/g, "");
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return /^https?:/i.test(v) ? v : null;
  return v;
}
