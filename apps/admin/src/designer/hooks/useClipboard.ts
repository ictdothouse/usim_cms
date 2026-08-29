import { useEffect, useState } from "react";
import type { ElType } from "../types";

export type ClipLevel = "section" | "row" | "column" | "element";

// "Paste style" strips these before merging onto a target, so copying a
// heading's style and pasting it onto a button can't leak the heading's
// actual text — only the type's own content field(s) need stripping;
// section/column props are already style-only.
const CONTENT_KEYS: Record<ElType, string[]> = {
  heading: ["text"],
  text: ["text"],
  image: ["src", "alt"],
  button: ["label", "href"],
  icon: ["name"],
  list: ["items"],
  html: ["html"],
  gallery: ["images"],
  embed: ["url"],
  spacer: [],
  divider: [],
  accordion: ["items"],
  infobox: ["name", "heading", "text"],
  tabs: ["items"],
  slider: ["slides"],
  menu: ["menuId"],
  cardgrid: ["cards"],
  ctabanner: ["heading", "description", "button1Label", "button2Label"],
  announcementbar: ["text", "linkLabel"],
  postlist: [],
  eventlist: [],
  testimonial: ["testimonials"],
  statscounter: ["stats"],
  peoplegrid: ["people"],
  socialicons: ["socials"],
  logocloud: ["logos"],
  timeline: ["timelineItems"],
  documentdownload: ["documents"],
  googlemap: ["embedUrl", "address"],
  announcementticker: ["tickerItems"],
};

const CLIP_KEYS: Record<ClipLevel, string> = {
  section: "designer:clip:section",
  row: "designer:clip:row",
  column: "designer:clip:column",
  element: "designer:clip:element",
};
const CLIPSTYLE_KEYS: Record<ClipLevel, string> = {
  section: "designer:clipstyle:section",
  row: "designer:clipstyle:row",
  column: "designer:clipstyle:column",
  element: "designer:clipstyle:element",
};

// localStorage-backed clipboard (survives reload/switching pages), namespaced
// per level so copying a section doesn't clobber a copied element.
function clipboardFns(bumpTick: () => void) {
  function clipCopy(level: ClipLevel, data: unknown) {
    localStorage.setItem(CLIP_KEYS[level], JSON.stringify(data));
    bumpTick();
  }
  function clipRead<T = unknown>(level: ClipLevel): T | null {
    const raw = localStorage.getItem(CLIP_KEYS[level]);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  function clipHas(level: ClipLevel) {
    return localStorage.getItem(CLIP_KEYS[level]) !== null;
  }
  function styleCopy(level: ClipLevel, props: Record<string, string>, elType?: ElType) {
    const clean = { ...props };
    (elType ? CONTENT_KEYS[elType] : []).forEach((k) => delete clean[k]);
    localStorage.setItem(CLIPSTYLE_KEYS[level], JSON.stringify(clean));
    bumpTick();
  }
  function styleRead(level: ClipLevel): Record<string, string> | null {
    const raw = localStorage.getItem(CLIPSTYLE_KEYS[level]);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  }
  function styleHas(level: ClipLevel) {
    return localStorage.getItem(CLIPSTYLE_KEYS[level]) !== null;
  }
  return { clipCopy, clipRead, clipHas, styleCopy, styleRead, styleHas };
}

export function __testOnly_clipboardFns() {
  return clipboardFns(() => {});
}

export function useClipboard() {
  const [clipTick, setClipTick] = useState(0); // bumped on every clipboard write, to re-render Paste button enabled-state
  const fns = clipboardFns(() => setClipTick((x) => x + 1));

  useEffect(() => {
    const onStorage = () => setClipTick((x) => x + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  void clipTick; // read so `fns` (rebuilt every render) is understood to depend on it
  return fns;
}
