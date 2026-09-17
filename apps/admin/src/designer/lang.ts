// i18n Phase 5 pure helpers — moved out of Designer.tsx (Layer 2,
// usePageAndLanguage) since designer/hooks/usePageAndLanguage.ts needs them
// and designer/ files can't import back from Designer.tsx.
import type { Block, ElType, SectionProps } from "./types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Which of an element type's own props are free-prose TEXT — these are
// ALWAYS per-language (no shared-by-default/opt-in toggle the way a style
// field gets one, see the Inspector's LangToggle): switching to a language
// tab always shows/edits that language's OWN value for these keys, falling
// back to the shared base value only until a translation is seeded.
// Section/Column have no text-bucket fields at all, so `elType` undefined
// (or any type with no TRANSLATABLE_TEXT_KEYS entry) is never a text key.
// Deliberately NOT auto-translated: accordion/tabs' `items`, slider's
// `slides` JSON, `html` — translating delimited/structured data risks
// corrupting it — a switch to an empty language slot just verbatim-copies
// those fields, same as before this feature, and an author can hand-
// translate them.
export const TRANSLATABLE_TEXT_KEYS: Partial<Record<ElType, string[]>> = {
  heading: ["text"],
  text: ["text"],
  button: ["label"],
  image: ["alt"],
  infobox: ["heading", "text"],
  ctabanner: ["heading", "description", "button1Label", "button2Label"],
  announcementbar: ["text", "linkLabel"],
};

export function isTextKey(elType: string | undefined, key: string): boolean {
  if (!elType) return false;
  return (TRANSLATABLE_TEXT_KEYS[elType as ElType] ?? []).includes(key);
}

// Position-addressed key for a Section/Column/Element node's own per-language
// override bag — `langOverrides[code][pathKey(...)]`. Sections have no id of
// their own (only rows/columns/elements do), so this is positional, not
// id-based: reordering sections/rows/columns/elements while a language
// override exists on one of them can misassign it to whatever now sits at
// that position — a known, visible-and-fixable (just re-toggle the override)
// ceiling, not a silent corruption; an id-based scheme would be the upgrade
// path if that ever becomes a real complaint.
export function pathKey(b: number, r?: number, c?: number, e?: number): string {
  return [b, r, c, e].filter((n) => n !== undefined).join(".");
}

// Overlays a language's own override bag onto a clone of the shared base
// tree — this is what the canvas/Inspector actually render/read while a
// non-base language pill is active. A flat key (e.g. "paddingTop") becomes
// that node's own value for this language, across every breakpoint (falls
// straight through the existing bpGetValue/sideValue resolution chain
// exactly like an ordinary base value would); a "tablet:"/"mobile:"-
// prefixed key instead merges into the node's OWN `bp` bag, so it rides the
// exact same per-breakpoint resolution (and, for Section/Column, the same
// real-published-site rendering) an ordinary bp override already gets —
// this is the "also stack by breakpoint" opt-in a language override can
// additionally turn on. Structure (which/how many sections/rows/columns/
// elements exist) is never touched here — only style/text VALUES change
// per language, per this whole feature's premise.
export function applyLangOverrides(base: Block[], bag: Record<string, Record<string, string>>): Block[] {
  const out = clone(base);
  out.forEach((block, b) => {
    if (block.type !== "section") return;
    const sp = block.props as unknown as SectionProps;
    const spBag = bag[pathKey(b)];
    if (spBag) {
      for (const [key, value] of Object.entries(spBag)) {
        if (key.startsWith("tablet:") || key.startsWith("mobile:")) sp.bp = { ...(sp.bp ?? {}), [key]: value };
        else (sp as unknown as Record<string, string>)[key] = value;
      }
    }
    (sp.rows ?? []).forEach((row, r) => {
      (row.columns ?? []).forEach((col, c) => {
        const colBag = bag[pathKey(b, r, c)];
        if (colBag) {
          for (const [key, value] of Object.entries(colBag)) {
            if (key.startsWith("tablet:") || key.startsWith("mobile:")) col.bp = { ...(col.bp ?? {}), [key]: value };
            else col.props = { ...(col.props ?? {}), [key]: value };
          }
        }
        (col.elements ?? []).forEach((el, e) => {
          const elBag = bag[pathKey(b, r, c, e)];
          if (elBag) {
            for (const [key, value] of Object.entries(elBag)) {
              if (key.startsWith("tablet:") || key.startsWith("mobile:")) el.bp = { ...(el.bp ?? {}), [key]: value };
              else el.props[key] = value;
            }
          }
        });
      });
    });
  });
  return out;
}

// One-time, transparent upgrade of the OLD per-language shape
// (`translations[code] = { layout: Block[] }` — a full, independently
// forkable clone of the entire tree) into the new sparse-override shape.
// The old shape is exactly what caused the reported bug: the first time a
// language was opened it forked the WHOLE tree (style included), and once
// forked, a later style edit on either side never propagated to the other —
// it read as "editing English changed the style specifically for English"
// even though the intent was always a shared style. Walks the old
// translated tree alongside the CURRENT base tree at the same positions and
// keeps ONLY each translatable text value — style is deliberately dropped
// (kept from the base instead, per the confirmed migration choice), and a
// structural mismatch (a block added/removed independently in one
// language's old fork) just stops the walk for that one path rather than
// attempting a full reconciliation. Never a hard DB migration — this runs
// each time an old-shape page loads, same "upgrade silently on read, save in
// the new shape on next write" convention every other schema evolution in
// this codebase already uses.
export function migrateOldTranslation(base: Block[], oldLayout: Block[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  base.forEach((block, b) => {
    if (block.type !== "section") return;
    const oldBlock = oldLayout[b];
    if (!oldBlock || oldBlock.type !== "section") return;
    const sp = block.props as unknown as SectionProps;
    const oldSp = oldBlock.props as unknown as SectionProps;
    (sp.rows ?? []).forEach((row, r) => {
      const oldRow = oldSp.rows?.[r];
      if (!oldRow) return;
      (row.columns ?? []).forEach((col, c) => {
        const oldCol = oldRow.columns?.[c];
        if (!oldCol) return;
        (col.elements ?? []).forEach((el, e) => {
          const oldEl = oldCol.elements?.[e];
          if (!oldEl || oldEl.type !== el.type) return;
          const keys = TRANSLATABLE_TEXT_KEYS[el.type as ElType];
          if (!keys) return;
          for (const key of keys) {
            const val = oldEl.props[key];
            if (typeof val === "string" && val.trim()) {
              (out[pathKey(b, r, c, e)] ??= {})[key] = val;
            }
          }
        });
      });
    });
  });
  return out;
}
