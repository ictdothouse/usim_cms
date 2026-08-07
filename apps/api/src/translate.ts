// Real auto-translate for posts (i18n Phase 5) — MyMemory's free, no-API-key
// translation API (https://mymemory.translated.net). ponytail: picked
// because it needs zero credentials/billing setup, matching this session's
// "just make it work" ask; swap for Google Cloud Translation (its `format:
// "html"` mode preserves markup, which this doesn't) if quality/formatting
// fidelity becomes a real complaint later.
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
// MyMemory's anonymous tier caps a single request around 500 chars — stay
// safely under that.
const MAX_CHUNK = 450;

function chunkText(text: string, max: number): string[] {
  const paragraphs = text.split(/\n+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && (current.length + 1 + p.length) > max) {
      chunks.push(current);
      current = p.slice(0, max);
    } else {
      current = current ? `${current}\n${p}` : p.slice(0, max);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  // MyMemory encodes errors as HTTP 200 with this set to a numeric-looking
  // string (e.g. "403") and the human-readable message crammed into
  // translatedText — never trust translatedText without checking this first.
  responseStatus?: number | string;
  // Every candidate translation MyMemory considered: crowd-sourced
  // translation-memory hits (various created-by values, often noisy —
  // especially for short/casual phrases) AND, usually, one fresh
  // algorithmic machine-translation result tagged created-by:"MT!". The
  // top-level responseData above is MyMemory's own "best" pick by their own
  // ranking, which can prefer an irrelevant TM hit over a decent MT one —
  // real bug hit translating "hai apa kabar" (a casual phrase), which came
  // back as an unrelated dictionary-title TM entry despite a perfectly fine
  // MT match being available in this same list.
  matches?: Array<{ translation: string; "created-by"?: string }>;
}

export async function translatePlainText(text: string, target: string, source = "auto"): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const chunks = chunkText(trimmed, MAX_CHUNK);
  const results: string[] = [];
  for (const chunk of chunks) {
    const url = `${MYMEMORY_URL}?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`translate provider returned ${res.status}`);
    const data = (await res.json()) as MyMemoryResponse;
    if (data.responseStatus && String(data.responseStatus) !== "200") throw new Error(`translate provider status ${data.responseStatus}`);
    // Prefer the real MT result over MyMemory's own top pick — see the
    // MyMemoryResponse comment above for why.
    const mt = data.matches?.find((m) => m["created-by"] === "MT!" && m.translation);
    results.push(mt?.translation ?? data.responseData?.translatedText ?? chunk);
  }
  return results.join("\n");
}

// Re-escapes plain text before it goes back into an HTML wrapper. Needed
// because translateHtmlBody below decodes entities (&amp;/&lt;/&gt;/&quot;)
// to plain text before sending to the translator — that decode has to
// happen for translation quality (MyMemory should see "Tom & Jerry", not
// "Tom &amp; Jerry"), but it means the round-tripped text is no longer
// HTML-safe once translated text comes back. postsBeforeChange sanitizes
// this endpoint's output again before it's ever saved (defense-in-depth),
// but this function's own output shouldn't rely on that — /api/translate
// is a general endpoint, not exclusively called through the save path.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Body is rich HTML; MyMemory only understands plain text, so this strips
// tags to paragraph-separated plain text, translates, and re-wraps as <p>.
// Known limitation: inline formatting/links/images inside the body do NOT
// survive — the editor re-adds anything needed after auto-translate runs,
// same "review and fix" expectation as every other stub in this feature.
export async function translateHtmlBody(html: string, target: string, source = "auto"): Promise<string> {
  const text = html
    .replace(/<(p|div|h[1-6]|li|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!text) return html;
  const translated = await translatePlainText(text, target, source);
  return translated
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
