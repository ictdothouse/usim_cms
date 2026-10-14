import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Download, RotateCcw, Sparkles, Trash2, Upload } from "lucide-react";
import * as api from "@/lib/api";
import { slugify, oklchToHex, contrastRatio, bestTextColor, GOOGLE_FONTS } from "@/lib/utils";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useT, inputCls, btnPrimary, card, FormError } from "./App";
import { parseDesignMd, serializeDesignMd, THEME_FIELDS, type ImportedDesignMd, type ThemeSettings } from "./theme-design-md";

// ---------- Theme (shared form for per-site and global) ----------
// A curated slice of daisyUI's own built-in themes (real oklch() triples
// copied from node_modules/daisyui/themes.css's [data-theme=X] rules, not
// guessed) — picking one fills the 4 pickers below, which stay fully
// editable afterwards, same as typing a color by hand.
const THEME_PRESETS: Array<{ name: string; primary: [number, number, number]; secondary: [number, number, number]; base: [number, number, number]; text: [number, number, number] }> = [
  { name: "light", primary: [0.45, 0.24, 277.023], secondary: [0.65, 0.241, 354.308], base: [1, 0, 0], text: [0.21, 0.006, 285.885] },
  { name: "dark", primary: [0.58, 0.233, 277.117], secondary: [0.65, 0.241, 354.308], base: [0.2533, 0.016, 252.42], text: [0.97807, 0.029, 256.847] },
  { name: "cupcake", primary: [0.85, 0.138, 181.071], secondary: [0.89, 0.061, 343.231], base: [0.97788, 0.004, 56.375], text: [0.23574, 0.066, 313.189] },
  { name: "corporate", primary: [0.58, 0.158, 241.966], secondary: [0.55, 0.046, 257.417], base: [1, 0, 0], text: [0.22389, 0.031, 278.072] },
  { name: "synthwave", primary: [0.71, 0.202, 349.761], secondary: [0.82, 0.111, 230.318], base: [0.15, 0.09, 281.288], text: [0.78, 0.115, 274.713] },
  { name: "forest", primary: [0.68628, 0.185, 148.958], secondary: [0.69776, 0.135, 168.327], base: [0.2084, 0.008, 17.911], text: [0.83768, 0.001, 17.911] },
  { name: "luxury", primary: [1, 0, 0], secondary: [0.27581, 0.064, 261.069], base: [0.14076, 0.004, 285.822], text: [0.75687, 0.123, 76.89] },
  { name: "dracula", primary: [0.75461, 0.183, 346.812], secondary: [0.74202, 0.148, 301.883], base: [0.28822, 0.022, 277.508], text: [0.97747, 0.007, 106.545] },
  { name: "winter", primary: [0.5686, 0.255, 257.57], secondary: [0.42551, 0.161, 282.339], base: [1, 0, 0], text: [0.41886, 0.053, 255.824] },
  { name: "business", primary: [0.41703, 0.099, 251.473], secondary: [0.64092, 0.027, 229.389], base: [0.24353, 0, 0], text: [0.8487, 0, 0] },
  { name: "coffee", primary: [0.71996, 0.123, 62.756], secondary: [0.34465, 0.029, 199.194], base: [0.24, 0.023, 329.708], text: [0.72354, 0.092, 79.129] },
  { name: "night", primary: [0.75351, 0.138, 232.661], secondary: [0.68011, 0.158, 276.934], base: [0.20768, 0.039, 265.754], text: [0.84153, 0.007, 265.754] },
];

function presetToColors(p: (typeof THEME_PRESETS)[number]) {
  return {
    primaryColor: oklchToHex(...p.primary),
    secondaryColor: oklchToHex(...p.secondary),
    backgroundColor: oklchToHex(...p.base),
    textColor: oklchToHex(...p.text),
  };
}

// Random palette on the same oklch model as the presets above, not a
// separate ad-hoc random-hex generator — a random hue for primary, an
// analogous hue for secondary, and light/dark base+text picked together so
// text stays readable against the background.
function randomTheme() {
  const hue = Math.random() * 360;
  const dark = Math.random() < 0.5;
  return {
    primaryColor: oklchToHex(0.6, 0.19, hue),
    secondaryColor: oklchToHex(0.62, 0.16, (hue + 130) % 360),
    backgroundColor: dark ? oklchToHex(0.22, 0.02, hue) : oklchToHex(0.98, 0.01, hue),
    textColor: dark ? oklchToHex(0.92, 0.02, hue) : oklchToHex(0.2, 0.02, hue),
  };
}

// Color contrast can be perfect and a font can still be hard to read —
// script/handwriting faces are illegible in any role, especially at small
// size or paragraph length; condensed/display faces (Bebas Neue, Anton,
// Righteous) are fine for a short heading but unreadable as extended body
// copy, so those are only flagged when used for the body font.
const SCRIPT_FONTS = new Set([
  "Pacifico",
  "Caveat",
  "Dancing Script",
  "Lobster",
  "Permanent Marker",
  "Shadows Into Light",
  "Amatic SC",
  "Indie Flower",
]);
const DISPLAY_ONLY_FONTS = new Set(["Bebas Neue", "Anton", "Righteous", "Abril Fatface"]);

function isLegibleFont(name: string, role: "body" | "heading"): boolean {
  if (!name) return true;
  if (SCRIPT_FONTS.has(name)) return false;
  return !(role === "body" && DISPLAY_ONLY_FONTS.has(name));
}

// Typeable/scrollable font picker shared by the heading/post-title/body
// fields below — each field owns its own open/filter state, so 3 of these
// can sit in one form without stepping on each other.
function FontField({
  label,
  value,
  onChange,
  placeholder,
  inherited,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inherited?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const matches = GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(value.toLowerCase()));
  return (
    <div className="relative">
      <label className="block text-xs font-medium text-body">
        {label}
        <input
          className={`${inputCls} mt-1`}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setHighlighted(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); return; }
            if (!open || matches.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((index) => Math.min(index + 1, matches.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((index) => Math.max(index - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); onChange(matches[highlighted] || matches[0]); setOpen(false); }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && matches.length > 0 ? `${listId}-${highlighted}` : undefined}
          placeholder={inherited || placeholder}
        />
      </label>
      {!value && inherited && <p className="mt-1 text-[11px] text-sub">{inherited}</p>}
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line/30 bg-white shadow-lg">
          {matches.map((f, index) => (
            <li key={f} id={`${listId}-${index}`} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                onMouseDown={() => {
                  onChange(f);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas ${index === highlighted ? "bg-canvas" : ""}`}
                style={{ fontFamily: f }}
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Curated heading/body pairings (not derived from the freeform GOOGLE_FONTS
// list above) so "Generate pairing" always lands on a combination that's
// actually designed to look intentional together, not two random fonts —
// every pair here is a well-documented typography pairing (the kind of combo
// fontpair.co-style galleries recommend), every font name is also in
// GOOGLE_FONTS so the picker/preview can actually render it.
const FONT_PAIRINGS: Array<{ heading: string; body: string }> = [
  { heading: "Poppins", body: "Inter" },
  { heading: "Playfair Display", body: "Source Sans Pro" },
  { heading: "Playfair Display", body: "Raleway" },
  { heading: "Space Grotesk", body: "Inter" },
  { heading: "Merriweather", body: "Open Sans" },
  { heading: "Merriweather", body: "Montserrat" },
  { heading: "Montserrat", body: "Nunito" },
  { heading: "Oswald", body: "Roboto" },
  { heading: "Oswald", body: "Lato" },
  { heading: "Libre Baskerville", body: "Lato" },
  { heading: "Archivo", body: "Work Sans" },
  { heading: "Bitter", body: "Karla" },
  { heading: "Bitter", body: "Raleway" },
  { heading: "Abril Fatface", body: "Mulish" },
  { heading: "Abril Fatface", body: "Poppins" },
  { heading: "DM Sans", body: "IBM Plex Sans" },
  { heading: "Rubik", body: "Noto Sans" },
  { heading: "Raleway", body: "Roboto" },
  { heading: "Lora", body: "Montserrat" },
  { heading: "Crimson Text", body: "Karla" },
  { heading: "Cormorant Garamond", body: "Montserrat" },
  { heading: "Josefin Sans", body: "Nunito" },
  { heading: "Zilla Slab", body: "Work Sans" },
  { heading: "Domine", body: "Mulish" },
  { heading: "Barlow", body: "Fira Sans" },
  { heading: "Manrope", body: "Inter" },
  { heading: "Outfit", body: "Inter" },
  { heading: "Plus Jakarta Sans", body: "Inter" },
  { heading: "Quicksand", body: "Nunito" },
  { heading: "Titillium Web", body: "Open Sans" },
];
function randomFontPairing() {
  return FONT_PAIRINGS[Math.floor(Math.random() * FONT_PAIRINGS.length)];
}

// WCAG contrast ratio maxes out its useful range at 7:1 (the AAA threshold
// for normal text) — scaling the percent to that instead of the ratio's true
// max (21:1, pure black on white) keeps "100%" meaning "as readable as it
// needs to be", not "the single most extreme pair possible".
function readabilityScore(ratio: number): { percent: number; tone: "good" | "ok" | "poor" } {
  const percent = Math.min(100, Math.round((ratio / 7) * 100));
  const tone = ratio >= 4.5 ? "good" : ratio >= 3 ? "ok" : "poor";
  return { percent, tone };
}

export function ThemeForm({
  title,
  desc,
  load,
  save,
  token,
  allowDeactivate,
  previewTenantHost,
}: {
  title: string;
  desc?: string;
  load: () => Promise<{ own: ThemeSettings; inherited: ThemeSettings }>;
  save: (settings: Record<string, string>) => Promise<unknown>;
  token: string;
  // Only the per-site override has a "default" above it to fall back to —
  // the global theme itself has nothing to deactivate into.
  allowDeactivate?: boolean;
  // Which site's real homepage "Test" opens with these not-yet-saved
  // settings applied. Omitted for the Global Theme form (no single site to
  // preview against) — Test there still fills the form/local preview panel.
  previewTenantHost?: string;
}) {
  const { t } = useT();
  const confirm = useConfirm();
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("");
  const [textColor, setTextColor] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [headingFont, setHeadingFont] = useState("");
  const [subHeadingFont, setSubHeadingFont] = useState("");
  const [postTitleFont, setPostTitleFont] = useState("");
  const [postTitleFontSize, setPostTitleFontSize] = useState("");
  const [postTitleLineHeight, setPostTitleLineHeight] = useState("");
  // Semantic palette + typography scale (design.md v2) — same open-bag/no-
  // migration convention as every other theme key; see App.tsx's THEME_TABS.
  const [tertiaryColor, setTertiaryColor] = useState("");
  const [successColor, setSuccessColor] = useState("");
  const [warningColor, setWarningColor] = useState("");
  const [errorColor, setErrorColor] = useState("");
  const [infoColor, setInfoColor] = useState("");
  const [captionFont, setCaptionFont] = useState("");
  const [headingFontSize, setHeadingFontSize] = useState("");
  const [headingLineHeight, setHeadingLineHeight] = useState("");
  const [subHeadingFontSize, setSubHeadingFontSize] = useState("");
  const [subHeadingLineHeight, setSubHeadingLineHeight] = useState("");
  const [bodyFontSize, setBodyFontSize] = useState("");
  const [bodyLineHeight, setBodyLineHeight] = useState("");
  const [captionFontSize, setCaptionFontSize] = useState("");
  const [captionLineHeight, setCaptionLineHeight] = useState("");
  const [activeTab, setActiveTab] = useState<"colors" | "typography" | "postdisplay" | "branding">("colors");
  const [showPostTags, setShowPostTags] = useState("");
  const [showPostCategory, setShowPostCategory] = useState("");
  const [showPostAuthor, setShowPostAuthor] = useState("");
  const [showPostDate, setShowPostDate] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [brandUploading, setBrandUploading] = useState<"logo" | "favicon" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<api.ThemePreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [inheritedTheme, setInheritedTheme] = useState<ThemeSettings>({});
  const [savedSettings, setSavedSettings] = useState<ThemeSettings>({});
  const [loading, setLoading] = useState(true);
  const [pendingImport, setPendingImport] = useState<(ImportedDesignMd & { fileName: string; candidate: ThemeSettings }) | null>(null);
  const [importAcknowledged, setImportAcknowledged] = useState(false);
  const [lastImportBackup, setLastImportBackup] = useState<api.ThemePreset | null>(null);
  const [applyingImport, setApplyingImport] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const formId = useId();

  // Per-site ThemeForm uploads into that tenant's own media library; the
  // Global Theme form (no previewTenantHost) has no tenant media library to
  // use, so it uploads into a fixed control-plane "_global" folder instead
  // (POST /api/portal/branding-upload) — this becomes every site's default
  // logo/favicon unless a site's own Branding overrides it.
  async function uploadBrandAsset(file: File, kind: "logo" | "favicon") {
    setBrandUploading(kind);
    try {
      const url = previewTenantHost ? await api.uploadMedia(previewTenantHost, token, file) : await api.uploadGlobalBranding(token, file);
      // previewTenantHost is only set for a per-site ThemeForm (see the
      // comment above this function) — the instance-wide Global Theme default
      // has no single tenant domain to bake in, so it's stored bare/relative
      // instead (no host at all): every tenant's own domain now proxies
      // /uploads/* to the api container (see proxy-sync.ts), so a relative
      // path resolves correctly against WHICHEVER tenant is rendering the
      // page — the one case where storing no host beats baking in any one.
      // The <img> preview a few lines below resolves it back to an absolute
      // URL for the admin's own on-screen display only (a different origin
      // than any tenant, so it needs one).
      const full = url.startsWith("http") ? url : previewTenantHost ? api.publicMediaBase(previewTenantHost) + url : url;
      if (kind === "logo") setLogoUrl(full);
      else setFaviconUrl(full);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBrandUploading(null);
    }
  }

  const currentColors = () => ({
    primaryColor,
    secondaryColor,
    backgroundColor,
    textColor,
    tertiaryColor,
    successColor,
    warningColor,
    errorColor,
    infoColor,
    fontFamily,
    headingFont,
    subHeadingFont,
    postTitleFont,
    captionFont,
    postTitleFontSize,
    postTitleLineHeight,
    headingFontSize,
    headingLineHeight,
    subHeadingFontSize,
    subHeadingLineHeight,
    bodyFontSize,
    bodyLineHeight,
    captionFontSize,
    captionLineHeight,
    showPostTags,
    showPostCategory,
    showPostAuthor,
    showPostDate,
    logoUrl,
    faviconUrl,
  });

  const mergeEffective = (own: ThemeSettings): ThemeSettings => ({
    ...inheritedTheme,
    ...Object.fromEntries(Object.entries(own).filter(([, value]) => value !== "")),
  });

  async function refreshPresets() {
    try {
      setPresets(await api.listThemePresets(token));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load().then(({ own: th, inherited }) => {
      if (!active) return;
      setInheritedTheme(inherited);
      setSavedSettings(th);
      setPrimaryColor(th.primaryColor ?? "");
      setSecondaryColor(th.secondaryColor ?? "");
      setBackgroundColor(th.backgroundColor ?? "");
      setTextColor(th.textColor ?? "");
      setFontFamily(th.fontFamily ?? "");
      setHeadingFont(th.headingFont ?? "");
      setSubHeadingFont(th.subHeadingFont ?? "");
      setPostTitleFont(th.postTitleFont ?? "");
      setPostTitleFontSize(th.postTitleFontSize ?? "");
      setPostTitleLineHeight(th.postTitleLineHeight ?? "");
      setTertiaryColor(th.tertiaryColor ?? "");
      setSuccessColor(th.successColor ?? "");
      setWarningColor(th.warningColor ?? "");
      setErrorColor(th.errorColor ?? "");
      setInfoColor(th.infoColor ?? "");
      setCaptionFont(th.captionFont ?? "");
      setHeadingFontSize(th.headingFontSize ?? "");
      setHeadingLineHeight(th.headingLineHeight ?? "");
      setSubHeadingFontSize(th.subHeadingFontSize ?? "");
      setSubHeadingLineHeight(th.subHeadingLineHeight ?? "");
      setBodyFontSize(th.bodyFontSize ?? "");
      setBodyLineHeight(th.bodyLineHeight ?? "");
      setCaptionFontSize(th.captionFontSize ?? "");
      setCaptionLineHeight(th.captionLineHeight ?? "");
      setShowPostTags(th.showPostTags ?? "");
      setShowPostCategory(th.showPostCategory ?? "");
      setShowPostAuthor(th.showPostAuthor ?? "");
      setShowPostDate(th.showPostDate ?? "");
      setLogoUrl(th.logoUrl ?? "");
      setFaviconUrl(th.faviconUrl ?? "");
      setLoading(false);
    }).catch((err: Error) => {
      if (active) { setError(err.message); setLoading(false); }
    });
    void refreshPresets();
    return () => { active = false; };
  }, []);

  // "Add to my favourites" — saves whatever's currently in the form
  // (unsaved edits included) as a new named preset, not what's on disk.
  async function saveToCollection() {
    const name = presetName.trim();
    if (!name) return;
    try {
      await api.createThemePreset(token, name, mergeEffective(currentColors()));
      setPresetName("");
      await refreshPresets();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deletePreset(id: string) {
    try {
      await api.deleteThemePreset(token, id);
      await refreshPresets();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function loadPreset(p: api.ThemePreset) {
    setPrimaryColor(p.settings.primaryColor ?? "");
    setSecondaryColor(p.settings.secondaryColor ?? "");
    setBackgroundColor(p.settings.backgroundColor ?? "");
    setTextColor(p.settings.textColor ?? "");
    setFontFamily(p.settings.fontFamily ?? "");
    setHeadingFont(p.settings.headingFont ?? "");
    setSubHeadingFont(p.settings.subHeadingFont ?? "");
    setPostTitleFont(p.settings.postTitleFont ?? "");
    setPostTitleFontSize(p.settings.postTitleFontSize ?? "");
    setPostTitleLineHeight(p.settings.postTitleLineHeight ?? "");
    setTertiaryColor(p.settings.tertiaryColor ?? "");
    setSuccessColor(p.settings.successColor ?? "");
    setWarningColor(p.settings.warningColor ?? "");
    setErrorColor(p.settings.errorColor ?? "");
    setInfoColor(p.settings.infoColor ?? "");
    setCaptionFont(p.settings.captionFont ?? "");
    setHeadingFontSize(p.settings.headingFontSize ?? "");
    setHeadingLineHeight(p.settings.headingLineHeight ?? "");
    setSubHeadingFontSize(p.settings.subHeadingFontSize ?? "");
    setSubHeadingLineHeight(p.settings.subHeadingLineHeight ?? "");
    setBodyFontSize(p.settings.bodyFontSize ?? "");
    setBodyLineHeight(p.settings.bodyLineHeight ?? "");
    setCaptionFontSize(p.settings.captionFontSize ?? "");
    setCaptionLineHeight(p.settings.captionLineHeight ?? "");
    setShowPostTags(p.settings.showPostTags ?? "");
    setShowPostCategory(p.settings.showPostCategory ?? "");
    setShowPostAuthor(p.settings.showPostAuthor ?? "");
    setShowPostDate(p.settings.showPostDate ?? "");
    setLogoUrl(p.settings.logoUrl ?? "");
    setFaviconUrl(p.settings.faviconUrl ?? "");
  }

  // Fills all 4 font roles from one curated pairing — heading, sub-heading,
  // and post-title share the display face (all "big text", same family at
  // different weights, matching how the source pairings are actually used
  // in the wild), body gets the paired reading face. Same pattern as
  // applyPalette below for colors.
  function applyFontPairing() {
    const pairing = randomFontPairing();
    setHeadingFont(pairing.heading);
    setSubHeadingFont(pairing.heading);
    setPostTitleFont(pairing.heading);
    setFontFamily(pairing.body);
  }

  // "Test only" — loads the preset into the form/local preview (same as
  // clicking a preset swatch) AND, when there's a real site to preview
  // against, opens its actual homepage with these not-yet-saved settings
  // applied (via a short-lived theme-preview token — see
  // getThemePreviewToken), so "Test" shows the real rendered page, not just
  // this panel's own preview box. Nothing is saved until Save is pressed.
  // Opens the tab before the await (not after) so the async token mint
  // can't trip the "window.open then redirect" popup-blocker failure mode.
  async function testPreset(p: api.ThemePreset) {
    loadPreset(p);
    if (!previewTenantHost) return;
    const win = window.open("", "_blank", "noreferrer");
    if (!win) {
      setError(t("designer-preview-blocked"));
      return;
    }
    try {
      const themeToken = await api.getThemePreviewToken(token, p.settings);
      win.location.href = api.previewUrl(previewTenantHost, "home", undefined, themeToken);
    } catch (err) {
      win.close();
      setError((err as Error).message);
    }
  }

  // Activate: load then immediately persist — same effect as loading a
  // preset by hand and clicking Save, bundled into one click.
  async function activatePreset(p: api.ThemePreset) {
    loadPreset(p);
    try {
      await save(p.settings);
      setSavedSettings(p.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Persist an empty tenant theme so every field inherits the global theme.
  // The API also ignores legacy empty-string overrides when merging.
  async function deactivate() {
    if (!(await confirm(t("theme-deactivate-confirm")))) return;
    const empty: ThemeSettings = {};
    try {
      await save(empty);
      loadPreset({ id: "", name: "", createdAt: "", settings: empty });
      setSavedSettings(empty);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Export the complete effective style. A site inheriting global tokens gets
  // those actual values in the portable file, while the CMS extension keeps
  // every supported setting round-trippable.
  function downloadDesignMd(settings = mergeEffective(currentColors()), name = presetName.trim() || title) {
    const content = serializeDesignMd(name, settings);
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(name)}.design.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // An outside file is only staged here. The form and persisted theme do not
  // change until the review panel's explicit Apply action completes.
  async function importDesignMd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      if (file.size > 256 * 1024) {
        setError(t("theme-import-too-large"));
        return;
      }
      const parsed = parseDesignMd(await file.text());
      if (!parsed) {
        setError(t("theme-import-no-matches"));
        return;
      }
      // Overlay only the last persisted state. Unsaved edits in the form must
      // never slip into an import that the reviewer did not see in the file.
      setPendingImport({ ...parsed, fileName: file.name, candidate: { ...savedSettings, ...parsed.settings } });
      setImportAcknowledged(false);
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setError(t("theme-import-invalid"));
    }
  }

  async function previewRealSite(settings: ThemeSettings) {
    if (!previewTenantHost) return;
    const win = window.open("", "_blank", "noreferrer");
    if (!win) {
      setError(t("designer-preview-blocked"));
      return;
    }
    try {
      const themeToken = await api.getThemePreviewToken(token, mergeEffective(settings));
      win.location.href = api.previewUrl(previewTenantHost, "home", undefined, themeToken);
    } catch (err) {
      win.close();
      setError((err as Error).message);
    }
  }

  async function applyImportedTheme() {
    if (!pendingImport || !importAcknowledged || applyingImport) return;
    setApplyingImport(true);
    setError(null);
    try {
      // A server-side personal snapshot survives a browser refresh, so the
      // imported theme can always be restored from My collection later.
      const backup = await api.createThemePreset(
        token,
        `${t("theme-before-import")} - ${new Date().toLocaleString()}`,
        savedSettings,
      );
      await save(pendingImport.candidate);
      loadPreset({ id: "", name: "", createdAt: "", settings: pendingImport.candidate });
      setSavedSettings(pendingImport.candidate);
      setLastImportBackup(backup);
      setPendingImport(null);
      setImportAcknowledged(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      void refreshPresets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplyingImport(false);
    }
  }

  async function restoreBeforeImport() {
    if (!lastImportBackup) return;
    try {
      await save(lastImportBackup.settings);
      loadPreset(lastImportBackup);
      setSavedSettings(lastImportBackup.settings);
      setLastImportBackup(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // One combined stylesheet request for every curated font so the dropdown
  // rows and the live preview panel below can render each one for real,
  // instead of just naming it — shared across both ThemeForm instances
  // (Global Theme + per-site Theme), so guard against injecting it twice.
  useEffect(() => {
    if (document.getElementById("admin-font-picker-preview")) return;
    const link = document.createElement("link");
    link.id = "admin-font-picker-preview";
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map((f) => `family=${encodeURIComponent(f)}`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pendingImport) return;
    const draft = currentColors();
    if (THEME_FIELDS.some((key) => key.endsWith("Color") && draft[key] && !/^#[0-9a-f]{6}$/i.test(draft[key]))) {
      setError(t("theme-invalid-color"));
      return;
    }
    const effective = mergeEffective(draft);
    if (contrastRatio(effective.textColor || "#111111", effective.backgroundColor || "#ffffff") < 4.5) {
      if (!(await confirm(t("theme-low-contrast-confirm")))) return;
    }
    try {
      await save(draft);
      setSavedSettings(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function applyPalette(colors: Record<string, string>) {
    setPrimaryColor(colors.primaryColor);
    setSecondaryColor(colors.secondaryColor);
    setBackgroundColor(colors.backgroundColor);
    setTextColor(colors.textColor);
  }

  // Heading/sub-heading/post-title are 3 independent fields but commonly
  // land on the same font (a pairing applies one display face to all of
  // them) — flag that instead of hiding it, so the user knows the fields
  // aren't broken/duplicated and can tell at a glance whether to leave them
  // shared or give this one its own face.
  const sameFontNote = (value: string, comparedTo: string) =>
    value && comparedTo && value === comparedTo ? (
      <p className="-mt-1 text-[11px] text-sub">{t("theme-font-same-note")}</p>
    ) : null;

  // Auto readability check — worst-case contrast across the things actually
  // rendered on the real site: body text vs background, and the primary
  // button's label vs its background (SectionBlock.astro's .ds-btn-primary).
  // The button check uses bestTextColor, not a hardcoded white, matching
  // what the real frontend now does too — otherwise a light primary color
  // (several daisyUI presets included) would falsely score "poor" here while
  // actually rendering fine with auto-picked black text on the live site.
  // secondaryColor isn't checked: it has no real rendered consumer yet
  // (BaseLayout.astro defines --color-secondary but nothing reads it), so
  // testing it here would just be flagging an admin-preview-only decoration.
  const draftTheme = currentColors();
  const effectiveTheme = mergeEffective(draftTheme);
  const previewTheme = pendingImport ? mergeEffective(pendingImport.candidate) : effectiveTheme;
  const previewValue = (key: string, fallback: string) =>
    /^#[0-9a-f]{6}$/i.test(previewTheme[key] || "") ? previewTheme[key] : fallback;
  const isDirty = THEME_FIELDS.some((key) => (draftTheme[key] || "") !== (savedSettings[key] || ""));
  const bodyContrast = contrastRatio(previewValue("textColor", "#111111"), previewValue("backgroundColor", "#ffffff"));
  const colorReadability = readabilityScore(
    Math.min(
      bodyContrast,
      contrastRatio(bestTextColor(previewValue("primaryColor", "#0f62fe")), previewValue("primaryColor", "#0f62fe")),
      // Secondary/accent is checked the same way as primary: as a filled
      // swatch with an auto-picked (black-or-white) label, matching how
      // daisyUI actually pairs every color with its own "-content" text —
      // not as raw secondaryColor used directly as text on the page
      // background, which isn't how any real color system uses an accent
      // hue and made several legitimately-fine presets score "poor" for a
      // combination nothing actually renders. Accent color still moves this
      // score (a genuinely low-contrast fill, e.g. white text picked for a
      // near-white accent, is still caught).
      contrastRatio(bestTextColor(previewValue("secondaryColor", "#666666")), previewValue("secondaryColor", "#666666")),
    ),
  );
  // Font legibility is checked separately from color contrast (a script body
  // font is unreadable even with perfect contrast) — if any field fails,
  // that caps the overall score/tone, since "readable" has to mean both.
  const illegibleFontFields = [
    !isLegibleFont(previewTheme.fontFamily || "", "body") && t("theme-font-body"),
    !isLegibleFont(previewTheme.headingFont || "", "heading") && t("theme-font-heading"),
    !isLegibleFont(previewTheme.subHeadingFont || "", "heading") && t("theme-font-subheading"),
    !isLegibleFont(previewTheme.postTitleFont || "", "heading") && t("theme-font-posttitle"),
  ].filter((v): v is string => Boolean(v));
  const readability =
    illegibleFontFields.length > 0
      ? { percent: Math.min(colorReadability.percent, 40), tone: "poor" as const }
      : colorReadability;
  const readabilityToneClass =
    readability.tone === "good" ? "text-ok" : readability.tone === "ok" ? "text-amber-600" : "text-red-600";

  // role: a fixed, non-editable description shown under the swatch (e.g.
  // "Main buttons & links") — the "palette + role label" shape the user
  // picked for design.md v2's richer color coverage.
  const colorField = (label: string, key: string, value: string, onChange: (v: string) => void, role?: string) => {
    const inherited = inheritedTheme[key] || "";
    const shown = /^#[0-9a-f]{6}$/i.test(value) ? value : inherited || "#FFFFFF";
    return (
      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/8 transition-shadow duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-slate-900/20">
        <div className="mb-2 flex items-start justify-between gap-2">
          <label htmlFor={`theme-${key}`} className="text-xs font-semibold text-ink">{label}</label>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-sub">{value ? t("theme-override") : inherited ? t("theme-inherited") : t("theme-unset")}</span>
            {allowDeactivate && value && <button type="button" onClick={() => onChange("")} className="text-[11px] font-semibold text-accent hover:underline">{t("theme-reset")}</button>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="color" aria-label={label} value={shown} onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-11 w-11 shrink-0 cursor-pointer rounded-xl border-0 bg-transparent p-0" />
          <input id={`theme-${key}`} value={value} placeholder={inherited || "#RRGGBB"} maxLength={7}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-ink outline-none ring-1 ring-slate-900/10 focus:ring-2 focus:ring-accent" />
        </div>
        {role && <p className="mt-2 text-[11px] leading-relaxed text-sub">{role}</p>}
        {value && !/^#[0-9a-f]{6}$/i.test(value) && <p className="mt-1 text-[11px] text-red-600">{t("theme-invalid-color")}</p>}
      </div>
    );
  };

  // Shared size+line-height pair — every typography-scale role (heading,
  // sub-heading, body, caption, and post-title below) is the same two
  // number fields, just a different key/range.
  const sizeLineHeightFields = (
    sizeLabel: string,
    sizeValue: string,
    setSize: (v: string) => void,
    lhLabel: string,
    lhValue: string,
    setLh: (v: string) => void,
    sizeMin = 8,
    sizeMax = 120,
  ) => (
    <div className="grid grid-cols-2 gap-2">
      <label className="block text-[11px] font-medium text-body">
        {sizeLabel}
        <input
          type="number"
          min={sizeMin}
          max={sizeMax}
          className={`${inputCls} mt-1`}
          value={sizeValue}
          onChange={(e) => setSize(e.target.value)}
          placeholder="16"
        />
      </label>
      <label className="block text-[11px] font-medium text-body">
        {lhLabel}
        <input
          type="number"
          min={1}
          max={2.5}
          step={0.1}
          className={`${inputCls} mt-1`}
          value={lhValue}
          onChange={(e) => setLh(e.target.value)}
          placeholder="1.4"
        />
      </label>
    </div>
  );

  return (
    <section className="mx-auto max-w-[1500px] space-y-6 pb-12">
      <header className="rounded-[1.75rem] bg-slate-950 px-6 py-7 text-white sm:px-8">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">{t("theme-studio")}</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
            {desc && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">{desc}</p>}
          </div>
          <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/15">
            {loading ? t("theme-loading") : pendingImport ? t("theme-preview-unsaved") : isDirty ? t("theme-unsaved") : t("theme-saved-status")}
          </span>
        </div>
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-slate-300">{previewTenantHost ? t("theme-scope-site") : t("theme-scope-global")}</p>
      </header>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <form id={formId} onSubmit={submit} className={`${card} min-w-0 space-y-5 rounded-[1.75rem] p-4 sm:p-6`}>
          <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-900/5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-ink">{t("theme-presets")}</p>
              <p className="text-xs text-sub">{t("theme-presets-hint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {THEME_PRESETS.map((p) => {
                const colors = presetToColors(p);
                const active =
                  primaryColor === colors.primaryColor &&
                  secondaryColor === colors.secondaryColor &&
                  backgroundColor === colors.backgroundColor &&
                  textColor === colors.textColor;
                return (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    aria-label={`${t("theme-presets")}: ${p.name}`}
                    aria-pressed={active}
                    onClick={() => applyPalette(colors)}
                    className={`flex min-h-14 flex-col justify-between gap-2 rounded-xl bg-white p-2 text-left text-xs font-semibold capitalize text-ink ring-1 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 ${
                      active ? "ring-2 ring-accent" : "ring-slate-900/10"
                    }`}
                  >
                    <span className="h-4 w-full rounded-md" style={{ background: `linear-gradient(90deg, ${colors.primaryColor} 45%, ${colors.secondaryColor} 45% 70%, ${colors.backgroundColor} 70%)` }} />
                    <span>{p.name}</span>
                  </button>
                );
              })}
              <button
                type="button"
                title={t("theme-generate")}
                aria-label={t("theme-generate")}
                onClick={() => applyPalette(randomTheme())}
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-2 text-xs font-semibold text-sub transition-colors hover:border-accent hover:text-accent"
              >
                <Sparkles className="h-4 w-4" /> {t("theme-generate")}
              </button>
            </div>
          </div>
          <div role="tablist" aria-label={t("theme-studio")} className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1 xl:sticky xl:top-24 xl:z-10 xl:shadow-sm">
            {(["colors", "typography", "postdisplay", "branding"] as const).map((tabId) => (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={activeTab === tabId}
                onClick={() => setActiveTab(tabId)}
                className={`min-w-max flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                  activeTab === tabId ? "bg-white text-ink shadow-sm" : "text-sub hover:text-ink"
                }`}
              >
                {t(`theme-tab-${tabId}`)}
              </button>
            ))}
          </div>

          {activeTab === "colors" && (
            <div className="space-y-3 rounded-2xl bg-slate-50 p-3 sm:p-4">
              <div><p className="text-sm font-bold text-ink">{t("theme-colors")}</p><p className="mt-1 text-xs text-sub">{t("theme-colors-hint")}</p></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {colorField(t("theme-primary"), "primaryColor", primaryColor, setPrimaryColor, t("theme-role-primary"))}
                {colorField(t("theme-secondary"), "secondaryColor", secondaryColor, setSecondaryColor, t("theme-role-secondary"))}
                {colorField(t("theme-tertiary"), "tertiaryColor", tertiaryColor, setTertiaryColor, t("theme-role-tertiary"))}
                {colorField(t("theme-background"), "backgroundColor", backgroundColor, setBackgroundColor, t("theme-role-background"))}
                {colorField(t("theme-text"), "textColor", textColor, setTextColor, t("theme-role-text"))}
                {colorField(t("theme-success"), "successColor", successColor, setSuccessColor, t("theme-role-success"))}
                {colorField(t("theme-warning"), "warningColor", warningColor, setWarningColor, t("theme-role-warning"))}
                {colorField(t("theme-error"), "errorColor", errorColor, setErrorColor, t("theme-role-error"))}
                {colorField(t("theme-info"), "infoColor", infoColor, setInfoColor, t("theme-role-info"))}
              </div>
            </div>
          )}

          {activeTab === "typography" && (
            <div className="space-y-3 rounded-xl border border-line/20 bg-canvas/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-body">{t("theme-fonts")}</p>
                <button
                  type="button"
                  onClick={applyFontPairing}
                  className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                >
                  <Sparkles className="h-3 w-3" /> {t("theme-font-pairing")}
                </button>
              </div>
              <FontField label={t("theme-font-heading")} value={headingFont} onChange={setHeadingFont} inherited={inheritedTheme.headingFont} placeholder="Poppins" />
              {sizeLineHeightFields(
                t("theme-heading-size"), headingFontSize, setHeadingFontSize,
                t("theme-heading-line-height"), headingLineHeight, setHeadingLineHeight,
              )}
              <FontField label={t("theme-font-subheading")} value={subHeadingFont} onChange={setSubHeadingFont} inherited={inheritedTheme.subHeadingFont} placeholder="Poppins" />
              {sameFontNote(subHeadingFont, headingFont)}
              {sizeLineHeightFields(
                t("theme-subheading-size"), subHeadingFontSize, setSubHeadingFontSize,
                t("theme-subheading-line-height"), subHeadingLineHeight, setSubHeadingLineHeight,
              )}
              <FontField label={t("theme-font-posttitle")} value={postTitleFont} onChange={setPostTitleFont} inherited={inheritedTheme.postTitleFont} placeholder="Poppins" />
              {sameFontNote(postTitleFont, headingFont)}
              {sizeLineHeightFields(
                t("theme-post-title-size"), postTitleFontSize, setPostTitleFontSize,
                t("theme-post-title-line-height"), postTitleLineHeight, setPostTitleLineHeight,
                12, 96,
              )}
              <FontField label={t("theme-font-body")} value={fontFamily} onChange={setFontFamily} inherited={inheritedTheme.fontFamily} placeholder="Plus Jakarta Sans" />
              {sizeLineHeightFields(
                t("theme-body-size"), bodyFontSize, setBodyFontSize,
                t("theme-body-line-height"), bodyLineHeight, setBodyLineHeight,
              )}
              <FontField label={t("theme-font-caption")} value={captionFont} onChange={setCaptionFont} inherited={inheritedTheme.captionFont} placeholder="Plus Jakarta Sans" />
              {sizeLineHeightFields(
                t("theme-caption-size"), captionFontSize, setCaptionFontSize,
                t("theme-caption-line-height"), captionLineHeight, setCaptionLineHeight,
              )}
            </div>
          )}

          {activeTab === "postdisplay" && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-line/20 bg-canvas/40 p-3">
              <label className="flex items-center gap-2 text-xs font-medium text-body">
                <input type="checkbox" checked={showPostTags !== "false"} onChange={(e) => setShowPostTags(e.target.checked ? "" : "false")} />
                {t("theme-show-tags")}
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-body">
                <input type="checkbox" checked={showPostCategory !== "false"} onChange={(e) => setShowPostCategory(e.target.checked ? "" : "false")} />
                {t("theme-show-category")}
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-body">
                <input type="checkbox" checked={showPostAuthor !== "false"} onChange={(e) => setShowPostAuthor(e.target.checked ? "" : "false")} />
                {t("theme-show-author")}
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-body">
                <input type="checkbox" checked={showPostDate !== "false"} onChange={(e) => setShowPostDate(e.target.checked ? "" : "false")} />
                {t("theme-show-date")}
              </label>
            </div>
          )}

          {activeTab === "branding" && (
            <div className="space-y-3 rounded-xl border border-line/20 bg-canvas/40 p-3">
              <p className="text-xs font-semibold text-body">{t("theme-branding")}</p>
              {!previewTenantHost && <p className="text-[11px] text-muted-foreground">{t("theme-branding-global-hint")}</p>}
              {(
                [
                  ["logo", t("theme-logo"), logoUrl, setLogoUrl, "h-10"],
                  ["favicon", t("theme-favicon"), faviconUrl, setFaviconUrl, "h-8 w-8"],
                ] as const
              ).map(([kind, label, value, setValue, previewCls]) => (
                <label key={kind} className="block text-xs font-medium text-body">
                  {label}
                  <div className="mt-1 flex items-center gap-2">
                    <input className={inputCls} value={value} placeholder="https://" onChange={(e) => setValue(e.target.value)} />
                    <label className="inline-block shrink-0 cursor-pointer whitespace-nowrap rounded-full bg-canvas px-3 py-1.5 text-[11px] font-semibold text-ink hover:bg-[#e8e8ed]">
                      {brandUploading === kind ? t("designer-uploading") : t("designer-upload")}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadBrandAsset(f, kind);
                        }}
                      />
                    </label>
                  </div>
                  {value && <img src={value.startsWith("http") ? value : api.API_URL + value} alt="" className={`mt-2 rounded object-contain ${previewCls}`} />}
                </label>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={loading || Boolean(pendingImport) || !isDirty} className={`${btnPrimary} w-full py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50`}>
              {t("theme-save")}
            </button>
            {saved && <span className="shrink-0 text-xs font-semibold text-ok">{t("theme-saved")}</span>}
          </div>
          {pendingImport && <p className="text-xs text-amber-700">{t("theme-import-save-disabled")}</p>}
          <FormError>{error}</FormError>
        </form>

        {/* Live preview — reflects the form's current (unsaved) state, not
            what's actually saved, so tweaking a color/font shows its effect
            immediately without a round trip to Save. The readability check
            sits in its own box below (not inside the preview) and always
            uses fixed neutral styling, not the theme's own colors — it has
            to stay legible even when the theme it's judging isn't. */}
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-2">
        <div ref={previewRef} className="scroll-mt-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">{pendingImport ? t("theme-import-preview") : t("theme-preview-label")}</h3>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${pendingImport || isDirty ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
                {pendingImport || isDirty ? t("theme-preview-unsaved") : t("theme-saved-status")}
              </span>
              <button type="submit" form={formId} disabled={loading || Boolean(pendingImport) || !isDirty} className="hidden rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 xl:inline-flex">
                {t("theme-save")}
              </button>
            </div>
          </div>
          <div
            className="space-y-4 rounded-[1.5rem] p-5 ring-1 ring-slate-900/10 sm:p-6"
            style={{
              background: previewValue("backgroundColor", "#ffffff"),
              color: previewValue("textColor", "#111111"),
              fontFamily: previewTheme.fontFamily || undefined,
            }}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.18em]">{t("theme-preview-label")}</p>
            <p className="text-2xl font-bold tracking-tight" style={{ fontFamily: previewTheme.headingFont || undefined, fontSize: previewTheme.headingFontSize ? `${previewTheme.headingFontSize}px` : undefined, lineHeight: previewTheme.headingLineHeight || undefined }}>
              {t("theme-preview-heading")}
            </p>
            <p className="text-base font-semibold" style={{ fontFamily: previewTheme.subHeadingFont || undefined, fontSize: previewTheme.subHeadingFontSize ? `${previewTheme.subHeadingFontSize}px` : undefined, lineHeight: previewTheme.subHeadingLineHeight || undefined }}>
              {t("theme-preview-subheading")}
            </p>
            <p
              className="text-sm font-semibold"
              style={{
                fontFamily: previewTheme.postTitleFont || undefined,
                fontSize: previewTheme.postTitleFontSize ? `${previewTheme.postTitleFontSize}px` : undefined,
                lineHeight: previewTheme.postTitleLineHeight || undefined,
              }}
            >
              {t("theme-preview-posttitle")}
            </p>
            <p className="text-sm leading-relaxed" style={{ fontSize: previewTheme.bodyFontSize ? `${previewTheme.bodyFontSize}px` : undefined, lineHeight: previewTheme.bodyLineHeight || undefined }}>
              {t("theme-preview-body")}
            </p>
            <p className="text-xs opacity-75" style={{ fontFamily: previewTheme.captionFont || undefined, fontSize: previewTheme.captionFontSize ? `${previewTheme.captionFontSize}px` : undefined, lineHeight: previewTheme.captionLineHeight || undefined }}>
              {t("theme-preview-caption")}
            </p>
            <div className="flex flex-wrap gap-2">
              <span
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{ background: previewValue("primaryColor", "#0f62fe"), color: bestTextColor(previewValue("primaryColor", "#0f62fe")) }}
              >
                {t("theme-preview-primary")}
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{ background: previewValue("secondaryColor", "#666666"), color: bestTextColor(previewValue("secondaryColor", "#666666")) }}
              >
                {t("theme-preview-secondary")}
              </span>
            </div>
          </div>
          {previewTenantHost && <button type="button" onClick={() => void previewRealSite(pendingImport?.candidate ?? draftTheme)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5"><ArrowUpRight className="h-4 w-4" />{t("theme-preview-live")}</button>}
          <div className={`${card} space-y-2 rounded-2xl p-4`}>
            <p className={`text-xs font-semibold ${readabilityToneClass}`}>
              {t("theme-readability")}: {readability.percent}% — {t(`theme-readability-${readability.tone}`)}
            </p>
            <p className="text-xs text-sub">{t("theme-contrast-ratio")}: {bodyContrast.toFixed(2)}:1</p>
            {bodyContrast < 4.5 && !pendingImport && <button type="button" onClick={() => setTextColor(bestTextColor(previewValue("backgroundColor", "#ffffff")))} className="text-xs font-semibold text-accent hover:underline">{t("theme-fix-contrast")}</button>}
            {illegibleFontFields.length > 0 && (
              <p className="text-[11px] text-sub">
                {t("theme-readability-font-note")} {illegibleFontFields.join(", ")}
              </p>
            )}
          </div>

          {/* Visual-only mockup of common components in the current
              colors/fonts — never changes real site styling, just an
              at-a-glance preview of the palette+typography in context. */}
          <div className={`${card} space-y-3 rounded-2xl p-4`}>
            <p className="text-sm font-bold text-ink">{t("theme-component-preview")}</p>
            <p className="text-xs text-sub">{t("theme-component-preview-note")}</p>
            <div
              className="space-y-3 rounded-xl p-4 ring-1 ring-slate-900/10"
              style={{ background: previewValue("backgroundColor", "#ffffff"), color: previewValue("textColor", "#111111"), fontFamily: previewTheme.fontFamily || undefined }}
            >
              <div className="flex flex-wrap gap-1.5">
                <span
                  className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: previewValue("primaryColor", "#0f62fe"), color: bestTextColor(previewValue("primaryColor", "#0f62fe")) }}
                >
                  {t("theme-preview-primary")}
                </span>
                <span
                  className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: previewValue("secondaryColor", "#666666"), color: bestTextColor(previewValue("secondaryColor", "#666666")) }}
                >
                  {t("theme-preview-secondary")}
                </span>
                <span
                  className="rounded-md border px-2.5 py-1 text-[11px] font-semibold"
                  style={{ borderColor: previewValue("errorColor", "#dc2626"), color: previewValue("errorColor", "#dc2626") }}
                >
                  {t("theme-error")}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["successColor", t("theme-success"), "#10B981"],
                  ["warningColor", t("theme-warning"), "#F59E0B"],
                  ["errorColor", t("theme-error"), "#DC2626"],
                  ["infoColor", t("theme-info"), "#3B82F6"],
                ] as const).map(([key, label, fallback]) => {
                  const color = previewValue(key, fallback);
                  return <span key={key} className="rounded-md px-2.5 py-1 text-[11px] font-semibold" style={{ background: color, color: bestTextColor(color) }}>{label}</span>;
                })}
              </div>
              <div className="rounded-lg border border-current/15 p-2.5">
                <p className="text-xs font-bold" style={{ fontFamily: previewTheme.headingFont || undefined }}>
                  {t("theme-preview-card-title")}
                </p>
                <p className="text-[11px] opacity-80">{t("theme-preview-card-body")}</p>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-medium opacity-70">{t("theme-preview-input-label")}</label>
                <input disabled className="w-full rounded-md border border-current/20 bg-white/50 px-2 py-1 text-[11px]" />
                <p className="text-[10px]" style={{ color: previewValue("errorColor", "#dc2626") }}>
                  {t("theme-preview-input-error")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {pendingImport && (
          <section aria-labelledby="theme-import-review" className="space-y-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-300/70">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-800">{t("theme-import-review-label")}</p>
              <h3 id="theme-import-review" className="mt-1 break-words text-lg font-bold text-slate-950">{pendingImport.name}</h3>
              <p className="mt-1 break-all text-xs text-slate-700">{pendingImport.fileName}</p>
            </div>
            <p className="text-sm leading-relaxed text-slate-800">{t("theme-import-mapped")}: <strong>{pendingImport.mappedFields.length}</strong>. {t("theme-import-only-supported")}</p>
            <div className="flex flex-wrap gap-1.5">
              {pendingImport.mappedFields.map((field) => <span key={field} className="rounded-full bg-white px-2.5 py-1 font-mono text-[10px] text-slate-700 ring-1 ring-amber-200">{field}</span>)}
            </div>
            {pendingImport.ignoredSections.length > 0 && <p className="text-xs leading-relaxed text-amber-900">{t("theme-import-ignored")}: {pendingImport.ignoredSections.join(", ")}.</p>}
            <p className="rounded-xl bg-white p-3 text-xs font-semibold leading-relaxed text-slate-900 ring-1 ring-amber-200">
              {previewTenantHost ? t("theme-import-impact-site") : t("theme-import-impact-global")}
            </p>
            <p className="text-xs leading-relaxed text-slate-700">{t("theme-import-backup-note")}</p>
            <label className="flex cursor-pointer items-start gap-2 text-xs font-medium leading-relaxed text-slate-900">
              <input type="checkbox" checked={importAcknowledged} onChange={(e) => setImportAcknowledged(e.target.checked)} className="mt-0.5 accent-amber-700" />
              {t("theme-import-acknowledge")}
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!importAcknowledged || applyingImport} onClick={() => void applyImportedTheme()} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                {applyingImport ? t("theme-import-applying") : t("theme-import-apply")}
              </button>
              <button type="button" onClick={() => { setPendingImport(null); setImportAcknowledged(false); }} className="rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-900/10">{t("theme-import-cancel")}</button>
            </div>
          </section>
        )}
        {lastImportBackup && !pendingImport && <button type="button" onClick={() => void restoreBeforeImport()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200"><RotateCcw className="h-4 w-4" />{t("theme-restore-before-import")}</button>}

        {/* Export/import a whole theme as a small human-readable file —
            works across sites: download here, upload on any other site's
            Theme panel to load the same settings into its form/preview. */}
        <div className={`${card} space-y-3 rounded-2xl p-4`}>
          <p className="text-sm font-bold text-ink">{t("theme-file-title")}</p>
          <p className="text-xs leading-relaxed text-sub">{t("theme-file-desc")}</p>
          <button type="button" onClick={() => downloadDesignMd(pendingImport ? mergeEffective(pendingImport.candidate) : effectiveTheme, pendingImport?.name || presetName.trim() || title)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-ink hover:bg-slate-200">
            <Download className="h-4 w-4" />{t("theme-file-download")}
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-body ring-1 ring-slate-900/15 hover:bg-slate-50"
          >
            <Upload className="h-4 w-4" />{t("theme-file-upload")}
          </button>
          <input ref={importInputRef} type="file" accept=".md,text/markdown" onChange={importDesignMd} className="hidden" />
          <div className="flex gap-2">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={t("theme-preset-name")} className={`${inputCls} min-w-0 flex-1 text-xs`} />
            <button type="button" disabled={!presetName.trim() || Boolean(pendingImport)} onClick={() => void saveToCollection()} className="rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-40">{t("theme-add-favourite")}</button>
          </div>
        </div>
        </aside>
      </div>

      {/* "My collection" — personal favourites, not tied to any one site;
          Test loads a preset into the form/preview without saving, Activate
          loads it and saves immediately. */}
      <Card className="rounded-[1.75rem]">
        <CardContent className="space-y-3 p-4 sm:p-6">
          <p className="text-sm font-bold text-ink">{t("theme-collection-title")}</p>
          {presets.length === 0 && <p className="text-[11px] text-sub">{t("theme-collection-empty")}</p>}
          <ul className="divide-y divide-line/20">
            {presets.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 text-xs">
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-line/30"
                  style={{ background: `linear-gradient(135deg, ${p.settings.primaryColor || "#ccc"} 50%, ${p.settings.secondaryColor || "#999"} 50%)` }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{p.name}</span>
                <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
                <Button variant="ghost" size="sm" onClick={() => testPreset(p)}>
                  {t("theme-preset-test")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void activatePreset(p)}>
                  {t("theme-preset-activate")}
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => downloadDesignMd(mergeEffective(p.settings), p.name)}
                >
                  {t("theme-file-download")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-500 hover:text-red-700"
                  title={t("theme-preset-delete")}
                  aria-label={t("theme-preset-delete")}
                  onClick={async () => {
                    if (!(await confirm(t("theme-preset-delete-confirm")))) return;
                    void deletePreset(p.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {allowDeactivate && (
        <button
          type="button"
          disabled={Boolean(pendingImport)}
          onClick={() => void deactivate()}
          className="text-xs font-semibold text-sub hover:text-red-600 hover:underline disabled:opacity-40"
        >
          {t("theme-deactivate")}
        </button>
      )}
    </section>
  );
}
