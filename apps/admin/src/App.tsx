import { createContext, Fragment, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams, Link } from "react-router-dom";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  Languages,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  ListTree,
  Loader2,
  LogOut,
  Menu,
  Newspaper,
  Palette,
  PanelTop,
  Pencil,
  Rss,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Users as UsersIcon,
  Wrench,
  X,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import * as api from "@/lib/api";
import { slugify, oklchToHex, contrastRatio, bestTextColor, GOOGLE_FONTS } from "@/lib/utils";
import type { Session } from "@/lib/api";
import { dict, type Key, type Lang } from "@/i18n";
import { useConfirm, ConfirmDialogProvider } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QrCode } from "@/components/QrCode";
// PostEditorPage (BlockNote rich-text editor) and BlueprintGallery are
// heavy routed views — code-split so a session that only ever opens
// Media/Menus/etc never downloads them. Designer itself is code-split from
// inside DesignerRoutes.tsx, the only place that renders it.
export const BlueprintGallery = lazy(() => import("./BlueprintGallery").then((m) => ({ default: m.BlueprintGallery })));
import CategoriesPanel from "./CategoriesPanel";
import SetupWizard from "./SetupWizard";
import LoginForm from "./LoginForm";
import { PageDesignerRoute, BlueprintDesignerRoute, SymbolDesignerRoute, HeaderFooterDesignerRoute } from "./DesignerRoutes";
import { Dashboard, PortalFeedPanel } from "./Dashboard";
import TenantLanguagesForm from "./TenantLanguagesForm";
import SecurityPanel from "./SecurityPanel";
import RolesPanel from "./RolesPanel";
import UsersPanel from "./UsersPanel";
import PostsPanel from "./PostsPanel";
import PagesPanel from "./PagesPanel";
import MediaManager from "./MediaManager";
import ContentManager from "./ContentManager";
import TenantsPanel from "./TenantsPanel";
const PostEditorPage = lazy(() => import("./PostEditorPage"));
import MenusPanel from "./MenusPanel";
import HeaderFooterPanel from "./HeaderFooterPanel";
import EventsPanel from "./EventsPanel";

export const SESSION_KEY = "usim_cms_session";

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as Session;
  // Sessions cached before tenantHosts existed won't have it — log back in
  // to get a fresh one, but don't crash on the stale cached shape meanwhile.
  return { ...session, tenantHosts: session.tenantHosts ?? (session.tenantHost ? [session.tenantHost] : []) };
}

// ---------- i18n ----------
export const I18nCtx = createContext<{ lang: Lang; t: (k: Key) => string }>({
  lang: "en",
  t: (k) => dict.en[k],
});
export const useT = () => useContext(I18nCtx);

// ---------- shared styles (prototype look) ----------
export const inputCls =
  "w-full rounded-lg border border-line/30 bg-canvas px-3 py-2 text-xs text-ink outline-none transition-all focus:border-line focus:bg-white";
export const btnPrimary =
  "rounded-full bg-accent px-5 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50";
export const btnGhost =
  "rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-[#e8e8ed]";
export const card = "rounded-xl border border-line/40 bg-white";

// Standardized form error — role="alert"/aria-live so a screen reader
// announces it the moment it appears, not just when focus happens to land
// on it. Replaces the same hand-repeated <p className="text-xs text-red-600">
// pattern that was duplicated across every panel's own error state.
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" aria-live="assertive" className="text-xs text-red-600">
      {children}
    </p>
  );
}

// Sprint 4 UX audit: standard loading/empty states, reused across the
// Pages/Posts/Media list panels instead of each rolling its own.
export function ListLoading() {
  const { t } = useT();
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-sub">
      <Loader2 className="h-4 w-4 animate-spin" /> {t("list-loading")}
    </div>
  );
}

export function ListEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-xs text-sub">
      <Inbox className="h-6 w-6 text-line" />
      <p>{children}</p>
    </div>
  );
}

export const PAGE_SIZE = 20;

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
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
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
        />
      </label>
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line/30 bg-white shadow-lg">
          {matches.map((f) => (
            <li key={f}>
              <button
                type="button"
                onMouseDown={() => {
                  onChange(f);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas"
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
  load: () => Promise<Record<string, string>>;
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
  const [importNotice, setImportNotice] = useState(false);
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
  const importInputRef = useRef<HTMLInputElement>(null);

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

  async function refreshPresets() {
    try {
      setPresets(await api.listThemePresets(token));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load().then((th) => {
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
    });
    void refreshPresets();
  }, []);

  // "Add to my favourites" — saves whatever's currently in the form
  // (unsaved edits included) as a new named preset, not what's on disk.
  async function saveToCollection() {
    const name = presetName.trim();
    if (!name) return;
    try {
      await api.createThemePreset(token, name, currentColors());
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
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Revert this site to inheriting the global theme untouched — clearing
  // every key (not deleting the row) is exactly what the existing PUT
  // /api/theme already treats as "no override" (validateThemeSettings
  // allows "" for every field; getMergedTheme spreads an empty object).
  async function deactivate() {
    const empty = {
      primaryColor: "",
      secondaryColor: "",
      backgroundColor: "",
      textColor: "",
      fontFamily: "",
      headingFont: "",
      subHeadingFont: "",
      postTitleFont: "",
      postTitleFontSize: "",
      postTitleLineHeight: "",
      tertiaryColor: "",
      successColor: "",
      warningColor: "",
      errorColor: "",
      infoColor: "",
      captionFont: "",
      headingFontSize: "",
      headingLineHeight: "",
      subHeadingFontSize: "",
      subHeadingLineHeight: "",
      bodyFontSize: "",
      bodyLineHeight: "",
      captionFontSize: "",
      captionLineHeight: "",
      showPostTags: "",
      showPostCategory: "",
      showPostAuthor: "",
      showPostDate: "",
      logoUrl: "",
      faviconUrl: "",
    };
    try {
      await save(empty);
      loadPreset({ id: "", name: "", createdAt: "", settings: empty });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // design.md export/import (v2) — a YAML-frontmatter-flavored text file:
  // the frontmatter is still the exact round-trippable key:value dump this
  // app's own importDesignMd reads back (every key currentColors() returns,
  // generic — a new theme key added later needs no change here), the body
  // below it is human-readable documentation of the same values (palette
  // w/ fixed role labels, typography scale) for a person reading the file
  // outside this app. Deliberately does NOT include marketplace/social
  // metadata (license, uploaded-by, downloads/likes, "Use with MCP") — this
  // is a single-tenant CMS, per the user's own explicit scope call.
  function downloadDesignMd() {
    const c = currentColors();
    const palette: Array<[string, string, string]> = [
      [t("theme-primary"), c.primaryColor, t("theme-role-primary")],
      [t("theme-secondary"), c.secondaryColor, t("theme-role-secondary")],
      [t("theme-tertiary"), c.tertiaryColor, t("theme-role-tertiary")],
      [t("theme-background"), c.backgroundColor, t("theme-role-background")],
      [t("theme-text"), c.textColor, t("theme-role-text")],
      [t("theme-success"), c.successColor, t("theme-role-success")],
      [t("theme-warning"), c.warningColor, t("theme-role-warning")],
      [t("theme-error"), c.errorColor, t("theme-role-error")],
      [t("theme-info"), c.infoColor, t("theme-role-info")],
    ].filter(([, hex]) => hex) as Array<[string, string, string]>;
    const typography: Array<[string, string, string, string]> = [
      [t("theme-font-heading"), c.headingFont, c.headingFontSize, c.headingLineHeight],
      [t("theme-font-subheading"), c.subHeadingFont, c.subHeadingFontSize, c.subHeadingLineHeight],
      [t("theme-font-posttitle"), c.postTitleFont, c.postTitleFontSize, c.postTitleLineHeight],
      [t("theme-font-body"), c.fontFamily, c.bodyFontSize, c.bodyLineHeight],
      [t("theme-font-caption"), c.captionFont, c.captionFontSize, c.captionLineHeight],
    ].filter(([, font, size, lh]) => font || size || lh) as Array<[string, string, string, string]>;
    const lines = [
      "---",
      `name: ${presetName.trim() || title}`,
      ...Object.entries(c).map(([k, v]) => `${k}: ${v}`),
      "---",
      "",
      `# ${presetName.trim() || title}`,
      "",
      "Generated by USIM CMS's Theme panel. Upload this file back into any site's",
      "Theme panel to preview or apply these settings — colors/fonts it recognizes",
      "are filled in automatically, the rest of this file is documentation only.",
      "",
      "## Palette",
      "",
      "| Role | Color | Description |",
      "| --- | --- | --- |",
      ...palette.map(([role, hex, desc]) => `| ${role} | \`${hex}\` | ${desc} |`),
      "",
      "## Typography scale",
      "",
      "| Role | Font | Size (px) | Line height |",
      "| --- | --- | --- | --- |",
      ...typography.map(([role, font, size, lh]) => `| ${role} | ${font || "(inherit)"} | ${size || "(auto)"} | ${lh || "(auto)"} |`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(presetName.trim() || title)}.design.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Generic import fallback — for a design.md NOT written by this app (e.g.
  // CorpScale-style exports): no known frontmatter keys to read, so instead
  // scan the whole file text for "<role word> ... #hexcolor" (covers both a
  // foreign frontmatter's own naming and a plain markdown palette table row
  // like "| Primary | `#0F62FE` | ..."). Best-effort only — fonts/sizes have
  // too many free-form spellings to reliably regex-extract, so this covers
  // colors only; a value the frontmatter pass already found always wins.
  const GENERIC_COLOR_ROLES: Array<[RegExp, (v: string) => void]> = [
    [/primary/i, setPrimaryColor],
    [/secondary/i, setSecondaryColor],
    [/tertiary/i, setTertiaryColor],
    [/background/i, setBackgroundColor],
    [/\btext\b/i, setTextColor],
    [/success/i, setSuccessColor],
    [/warning/i, setWarningColor],
    [/error|danger/i, setErrorColor],
    [/\binfo\b/i, setInfoColor],
  ];

  async function importDesignMd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const parsed: Record<string, string> = {};
      for (const line of frontmatter.split("\n")) {
        const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
        if (m) parsed[m[1]] = m[2].trim();
      }
      let usedGenericFallback = false;
      const hex = (role: RegExp): string | undefined => {
        for (const line of text.split("\n")) {
          if (!role.test(line)) continue;
          const m = line.match(/#[0-9a-f]{6}/i);
          if (m) return m[0];
        }
        return undefined;
      };
      const resolveColor = (key: string, role: RegExp, current: string): string => {
        if (parsed[key] !== undefined) return parsed[key];
        const found = hex(role);
        if (found) {
          usedGenericFallback = true;
          return found;
        }
        return current;
      };
      setPrimaryColor(resolveColor("primaryColor", GENERIC_COLOR_ROLES[0][0], primaryColor));
      setSecondaryColor(resolveColor("secondaryColor", GENERIC_COLOR_ROLES[1][0], secondaryColor));
      setTertiaryColor(resolveColor("tertiaryColor", GENERIC_COLOR_ROLES[2][0], tertiaryColor));
      setBackgroundColor(resolveColor("backgroundColor", GENERIC_COLOR_ROLES[3][0], backgroundColor));
      setTextColor(resolveColor("textColor", GENERIC_COLOR_ROLES[4][0], textColor));
      setSuccessColor(resolveColor("successColor", GENERIC_COLOR_ROLES[5][0], successColor));
      setWarningColor(resolveColor("warningColor", GENERIC_COLOR_ROLES[6][0], warningColor));
      setErrorColor(resolveColor("errorColor", GENERIC_COLOR_ROLES[7][0], errorColor));
      setInfoColor(resolveColor("infoColor", GENERIC_COLOR_ROLES[8][0], infoColor));
      setFontFamily(parsed.fontFamily ?? fontFamily);
      setHeadingFont(parsed.headingFont ?? headingFont);
      setSubHeadingFont(parsed.subHeadingFont ?? subHeadingFont);
      setPostTitleFont(parsed.postTitleFont ?? postTitleFont);
      setCaptionFont(parsed.captionFont ?? captionFont);
      setPostTitleFontSize(parsed.postTitleFontSize ?? postTitleFontSize);
      setPostTitleLineHeight(parsed.postTitleLineHeight ?? postTitleLineHeight);
      setHeadingFontSize(parsed.headingFontSize ?? headingFontSize);
      setHeadingLineHeight(parsed.headingLineHeight ?? headingLineHeight);
      setSubHeadingFontSize(parsed.subHeadingFontSize ?? subHeadingFontSize);
      setSubHeadingLineHeight(parsed.subHeadingLineHeight ?? subHeadingLineHeight);
      setBodyFontSize(parsed.bodyFontSize ?? bodyFontSize);
      setBodyLineHeight(parsed.bodyLineHeight ?? bodyLineHeight);
      setCaptionFontSize(parsed.captionFontSize ?? captionFontSize);
      setCaptionLineHeight(parsed.captionLineHeight ?? captionLineHeight);
      setShowPostTags(parsed.showPostTags ?? showPostTags);
      setShowPostCategory(parsed.showPostCategory ?? showPostCategory);
      setShowPostAuthor(parsed.showPostAuthor ?? showPostAuthor);
      setShowPostDate(parsed.showPostDate ?? showPostDate);
      setLogoUrl(parsed.logoUrl ?? logoUrl);
      if (parsed.name) setPresetName(parsed.name);
      setImportNotice(usedGenericFallback);
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
    try {
      await save(currentColors());
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
  const colorReadability = readabilityScore(
    Math.min(
      contrastRatio(textColor || "#111111", backgroundColor || "#ffffff"),
      contrastRatio(bestTextColor(primaryColor || "#0f62fe"), primaryColor || "#0f62fe"),
      // Secondary/accent is checked the same way as primary: as a filled
      // swatch with an auto-picked (black-or-white) label, matching how
      // daisyUI actually pairs every color with its own "-content" text —
      // not as raw secondaryColor used directly as text on the page
      // background, which isn't how any real color system uses an accent
      // hue and made several legitimately-fine presets score "poor" for a
      // combination nothing actually renders. Accent color still moves this
      // score (a genuinely low-contrast fill, e.g. white text picked for a
      // near-white accent, is still caught).
      contrastRatio(bestTextColor(secondaryColor || "#666666"), secondaryColor || "#666666"),
    ),
  );
  // Font legibility is checked separately from color contrast (a script body
  // font is unreadable even with perfect contrast) — if any field fails,
  // that caps the overall score/tone, since "readable" has to mean both.
  const illegibleFontFields = [
    !isLegibleFont(fontFamily, "body") && t("theme-font-body"),
    !isLegibleFont(headingFont, "heading") && t("theme-font-heading"),
    !isLegibleFont(subHeadingFont, "heading") && t("theme-font-subheading"),
    !isLegibleFont(postTitleFont, "heading") && t("theme-font-posttitle"),
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
  const colorField = (label: string, value: string, onChange: (v: string) => void, role?: string) => (
    <label
      className="flex flex-col items-center gap-1 rounded-xl border border-line/30 bg-white px-2 py-2.5 text-center transition-colors hover:border-line/60"
      title={role}
    >
      <span className="text-[11px] font-medium text-body">{label}</span>
      <span className="h-9 w-9 overflow-hidden rounded-lg border border-line/30 shadow-sm">
        <input
          type="color"
          className="h-full w-full cursor-pointer border-0 p-0"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      <span className="font-mono text-[10px] uppercase text-sub">{value || "#000000"}</span>
      {role && <span className="text-[9px] leading-tight text-sub/70">{role}</span>}
    </label>
  );

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
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Palette className="h-4 w-4 text-accent" /> {title}
      </h2>
      {desc && <p className="text-xs text-sub">{desc}</p>}
      <div className="flex flex-wrap items-start gap-4">
        <form onSubmit={submit} className={`${card} max-w-sm space-y-4 p-5`}>
          <div className="space-y-2 rounded-xl border border-line/20 bg-canvas/40 p-3">
            <p className="text-xs font-medium text-body">{t("theme-presets")}</p>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((p, i) => {
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
                    title={`${t("theme-presets")} ${i + 1}`}
                    onClick={() => applyPalette(colors)}
                    className={`h-9 w-9 shrink-0 overflow-hidden rounded-lg border shadow-sm transition-all hover:scale-110 hover:shadow-md ${
                      active ? "border-accent ring-2 ring-accent ring-offset-2 ring-offset-canvas" : "border-line/30"
                    }`}
                    style={{ background: `linear-gradient(135deg, ${colors.primaryColor} 50%, ${colors.secondaryColor} 50%)` }}
                  />
                );
              })}
              <button
                type="button"
                title={t("theme-generate")}
                aria-label={t("theme-generate")}
                onClick={() => applyPalette(randomTheme())}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-line/50 text-sub transition-all hover:scale-110 hover:border-accent hover:text-accent"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-1 rounded-xl border border-line/20 bg-canvas/40 p-1">
            {(["colors", "typography", "postdisplay", "branding"] as const).map((tabId) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  activeTab === tabId ? "bg-white text-ink shadow-sm" : "text-sub hover:text-ink"
                }`}
              >
                {t(`theme-tab-${tabId}`)}
              </button>
            ))}
          </div>

          {activeTab === "colors" && (
            <div className="space-y-2 rounded-xl border border-line/20 bg-canvas/40 p-3">
              <p className="text-xs font-medium text-body">{t("theme-colors")}</p>
              <div className="grid grid-cols-3 gap-2">
                {colorField(t("theme-primary"), primaryColor, setPrimaryColor, t("theme-role-primary"))}
                {colorField(t("theme-secondary"), secondaryColor, setSecondaryColor, t("theme-role-secondary"))}
                {colorField(t("theme-tertiary"), tertiaryColor, setTertiaryColor, t("theme-role-tertiary"))}
                {colorField(t("theme-background"), backgroundColor, setBackgroundColor, t("theme-role-background"))}
                {colorField(t("theme-text"), textColor, setTextColor, t("theme-role-text"))}
                {colorField(t("theme-success"), successColor, setSuccessColor, t("theme-role-success"))}
                {colorField(t("theme-warning"), warningColor, setWarningColor, t("theme-role-warning"))}
                {colorField(t("theme-error"), errorColor, setErrorColor, t("theme-role-error"))}
                {colorField(t("theme-info"), infoColor, setInfoColor, t("theme-role-info"))}
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
              <FontField label={t("theme-font-heading")} value={headingFont} onChange={setHeadingFont} placeholder="Poppins" />
              {sizeLineHeightFields(
                t("theme-heading-size"), headingFontSize, setHeadingFontSize,
                t("theme-heading-line-height"), headingLineHeight, setHeadingLineHeight,
              )}
              <FontField label={t("theme-font-subheading")} value={subHeadingFont} onChange={setSubHeadingFont} placeholder="Poppins" />
              {sameFontNote(subHeadingFont, headingFont)}
              {sizeLineHeightFields(
                t("theme-subheading-size"), subHeadingFontSize, setSubHeadingFontSize,
                t("theme-subheading-line-height"), subHeadingLineHeight, setSubHeadingLineHeight,
              )}
              <FontField label={t("theme-font-posttitle")} value={postTitleFont} onChange={setPostTitleFont} placeholder="Poppins" />
              {sameFontNote(postTitleFont, headingFont)}
              {sizeLineHeightFields(
                t("theme-post-title-size"), postTitleFontSize, setPostTitleFontSize,
                t("theme-post-title-line-height"), postTitleLineHeight, setPostTitleLineHeight,
                12, 96,
              )}
              <FontField label={t("theme-font-body")} value={fontFamily} onChange={setFontFamily} placeholder="Inter" />
              {sizeLineHeightFields(
                t("theme-body-size"), bodyFontSize, setBodyFontSize,
                t("theme-body-line-height"), bodyLineHeight, setBodyLineHeight,
              )}
              <FontField label={t("theme-font-caption")} value={captionFont} onChange={setCaptionFont} placeholder="Inter" />
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
            <button type="submit" className={`${btnPrimary} w-full py-3 text-sm shadow-md`}>
              {t("theme-save")}
            </button>
            {saved && <span className="shrink-0 text-xs font-semibold text-ok">{t("theme-saved")}</span>}
          </div>
          <FormError>{error}</FormError>
        </form>

        {/* Live preview — reflects the form's current (unsaved) state, not
            what's actually saved, so tweaking a color/font shows its effect
            immediately without a round trip to Save. The readability check
            sits in its own box below (not inside the preview) and always
            uses fixed neutral styling, not the theme's own colors — it has
            to stay legible even when the theme it's judging isn't. */}
        <div className="w-72 shrink-0 space-y-2">
          <div
            className="space-y-3 rounded-xl border border-line/30 p-5"
            style={{
              background: backgroundColor || "#ffffff",
              color: textColor || "#111111",
              fontFamily: fontFamily || undefined,
            }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">{t("theme-preview-label")}</p>
            <p className="text-lg font-bold" style={{ fontFamily: headingFont || undefined }}>
              {t("theme-preview-heading")}
            </p>
            <p className="text-base font-semibold opacity-90" style={{ fontFamily: subHeadingFont || undefined }}>
              {t("theme-preview-subheading")}
            </p>
            <p
              className="text-sm font-semibold opacity-80"
              style={{
                fontFamily: postTitleFont || undefined,
                fontSize: postTitleFontSize ? `${postTitleFontSize}px` : undefined,
                lineHeight: postTitleLineHeight || undefined,
              }}
            >
              {t("theme-preview-posttitle")}
            </p>
            <p className="text-sm opacity-80">{t("theme-preview-body")}</p>
            <div className="flex gap-2">
              <span
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{ background: primaryColor || "#0f62fe", color: bestTextColor(primaryColor || "#0f62fe") }}
              >
                {t("theme-preview-primary")}
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{ background: secondaryColor || "#666666", color: bestTextColor(secondaryColor || "#666666") }}
              >
                {t("theme-preview-secondary")}
              </span>
            </div>
            <div className="flex gap-1.5 border-t border-current/10 pt-3">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t("theme-preset-name")}
                className="min-w-0 flex-1 rounded-lg border border-current/20 bg-white/40 px-2 py-1 text-xs text-ink placeholder:text-current/50"
              />
              <button
                type="button"
                onClick={() => void saveToCollection()}
                disabled={!presetName.trim()}
                className="shrink-0 rounded-lg bg-black/10 px-2 py-1 text-xs font-semibold disabled:opacity-40"
              >
                {t("theme-add-favourite")}
              </button>
            </div>
          </div>
          <div className={`${card} space-y-1 p-3`}>
            <p className={`text-xs font-semibold ${readabilityToneClass}`}>
              {t("theme-readability")}: {readability.percent}% — {t(`theme-readability-${readability.tone}`)}
            </p>
            {illegibleFontFields.length > 0 && (
              <p className="text-[11px] text-sub">
                {t("theme-readability-font-note")} {illegibleFontFields.join(", ")}
              </p>
            )}
          </div>

          {/* Visual-only mockup of common components in the current
              colors/fonts — never changes real site styling, just an
              at-a-glance preview of the palette+typography in context. */}
          <div className={`${card} space-y-2 p-3`}>
            <p className="text-xs font-semibold text-ink">{t("theme-component-preview")}</p>
            <p className="text-[10px] text-sub">{t("theme-component-preview-note")}</p>
            <div
              className="space-y-2 rounded-lg border border-line/20 p-3"
              style={{ background: backgroundColor || "#ffffff", color: textColor || "#111111", fontFamily: fontFamily || undefined }}
            >
              <div className="flex flex-wrap gap-1.5">
                <span
                  className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: primaryColor || "#0f62fe", color: bestTextColor(primaryColor || "#0f62fe") }}
                >
                  {t("theme-preview-primary")}
                </span>
                <span
                  className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: secondaryColor || "#666666", color: bestTextColor(secondaryColor || "#666666") }}
                >
                  {t("theme-preview-secondary")}
                </span>
                <span
                  className="rounded-md border px-2.5 py-1 text-[11px] font-semibold"
                  style={{ borderColor: errorColor || "#dc2626", color: errorColor || "#dc2626" }}
                >
                  {t("theme-error")}
                </span>
              </div>
              <div className="rounded-lg border border-current/15 p-2.5">
                <p className="text-xs font-bold" style={{ fontFamily: headingFont || undefined }}>
                  {t("theme-preview-card-title")}
                </p>
                <p className="text-[11px] opacity-80">{t("theme-preview-card-body")}</p>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-medium opacity-70">{t("theme-preview-input-label")}</label>
                <input disabled className="w-full rounded-md border border-current/20 bg-white/50 px-2 py-1 text-[11px]" />
                <p className="text-[10px]" style={{ color: errorColor || "#dc2626" }}>
                  {t("theme-preview-input-error")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Export/import a whole theme as a small human-readable file —
            works across sites: download here, upload on any other site's
            Theme panel to load the same settings into its form/preview. */}
        <div className={`${card} w-64 shrink-0 space-y-2 p-4`}>
          <p className="text-xs font-semibold text-ink">{t("theme-file-title")}</p>
          <p className="text-[11px] text-sub">{t("theme-file-desc")}</p>
          <button type="button" onClick={downloadDesignMd} className="w-full rounded-lg bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-[#e8e8ed]">
            {t("theme-file-download")}
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="w-full rounded-lg border border-line/30 px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
          >
            {t("theme-file-upload")}
          </button>
          <input ref={importInputRef} type="file" accept=".md,text/markdown" onChange={importDesignMd} className="hidden" />
          {importNotice && <p className="text-[11px] text-amber-600">{t("theme-import-generic-note")}</p>}
        </div>
      </div>

      {/* "My collection" — personal favourites, not tied to any one site;
          Test loads a preset into the form/preview without saving, Activate
          loads it and saves immediately. */}
      <Card className="max-w-3xl">
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-semibold text-ink">{t("theme-collection-title")}</p>
          {presets.length === 0 && <p className="text-[11px] text-sub">{t("theme-collection-empty")}</p>}
          <ul className="divide-y divide-line/20">
            {presets.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-xs">
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-line/30"
                  style={{ background: `linear-gradient(135deg, ${p.settings.primaryColor || "#ccc"} 50%, ${p.settings.secondaryColor || "#999"} 50%)` }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{p.name}</span>
                <Button variant="ghost" size="sm" onClick={() => testPreset(p)}>
                  {t("theme-preset-test")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void activatePreset(p)}>
                  {t("theme-preset-activate")}
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setPresetName(p.name);
                    loadPreset(p);
                    downloadDesignMd();
                  }}
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
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {allowDeactivate && (
        <button
          type="button"
          onClick={() => void deactivate()}
          className="text-xs font-semibold text-sub hover:text-red-600 hover:underline"
        >
          {t("theme-deactivate")}
        </button>
      )}
    </section>
  );
}


// ---------- Users ----------
export const PERMISSIONS = [
  "pages.create",
  "pages.update",
  "pages.delete",
  "posts.create",
  "posts.update",
  "posts.delete",
  "media.upload",
  "media.delete",
  "theme.write",
  "users.manage",
  "sites.multi",
  "languages.write",
  "menus.write",
  "blueprints.write",
  "events.write",
  "headerFooter.write",
] as const;
export const PERMISSION_LABEL_KEY: Record<(typeof PERMISSIONS)[number], Key> = {
  "pages.create": "perm-pages-create",
  "pages.update": "perm-pages-update",
  "pages.delete": "perm-pages-delete",
  "posts.create": "perm-posts-create",
  "posts.update": "perm-posts-update",
  "posts.delete": "perm-posts-delete",
  "media.upload": "perm-media-upload",
  "media.delete": "perm-media-delete",
  "theme.write": "perm-theme-write",
  "users.manage": "perm-users-manage",
  "sites.multi": "perm-sites-multi",
  "languages.write": "perm-languages-write",
  "menus.write": "perm-menus-write",
  "blueprints.write": "perm-blueprints-write",
  "events.write": "perm-events-write",
  "headerFooter.write": "perm-header-footer-write",
};

// ---------- Shell (sidebar + header, prototype layout) ----------
// Shared with ContentManager.tsx's own sub-nav grouping (imported back from
// there) — the webmaster sidebar's flat Tab list groups by the same taxonomy.
export type NavGroup = "content" | "design" | "settings";
export const NAV_GROUP_ORDER: NavGroup[] = ["content", "design", "settings"];
export const NAV_GROUP_LABEL: Record<NavGroup, Key> = {
  content: "nav-group-content",
  design: "nav-group-design",
  settings: "nav-group-settings",
};
type Tab =
  | "dashboard"
  | "multisite"
  | "users"
  | "roles"
  | "content"
  | "theme"
  | "languages"
  | "menus"
  | "header-footer"
  | "blueprints"
  | "events"
  | "global-theme"
  | "feed"
  | "settings"
  | "security";

const TAB_META: Record<Tab, { labelKey: Key; icon: React.ComponentType<{ className?: string }> }> = {
  dashboard: { labelKey: "tab-dashboard", icon: LayoutDashboard },
  multisite: { labelKey: "tab-multisite", icon: Layers },
  users: { labelKey: "tab-users", icon: UsersIcon },
  roles: { labelKey: "tab-roles", icon: ShieldCheck },
  content: { labelKey: "tab-content", icon: FileText },
  theme: { labelKey: "tab-theme", icon: Palette },
  languages: { labelKey: "tab-languages", icon: Globe },
  menus: { labelKey: "menus-title", icon: ListTree },
  "header-footer": { labelKey: "header-footer-title", icon: PanelTop },
  blueprints: { labelKey: "blueprints-title", icon: LayoutTemplate },
  events: { labelKey: "events-title", icon: CalendarDays },
  "global-theme": { labelKey: "tab-global-theme", icon: Palette },
  feed: { labelKey: "tab-feed", icon: Rss },
  settings: { labelKey: "tab-settings", icon: SettingsIcon },
  security: { labelKey: "tab-security", icon: KeyRound },
};

// Webmaster's sidebar has no site-picker, so ContentManager's own Content/
// Design/Settings sub-tabs (menus/theme/etc, see CONTENT_SUBTAB_GROUP above)
// surface as flat top-level Tabs instead — grouped here the same way so a
// webmaster gets the same taxonomy a superadmin sees inside Content Manager.
// Superadmin's own sidebar contentTabs (content/global-theme/feed) is left
// flat — only 3 items, not crowded.
const TAB_GROUP: Partial<Record<Tab, NavGroup>> = {
  content: "content",
  theme: "design",
  menus: "design",
  "header-footer": "design",
  blueprints: "design",
  languages: "settings",
  events: "settings",
};

// Common languages for the "add language" typeahead below — picking a
// suggestion fills both code and label at once so an author never has to
// hand-type an ISO code. Freeform code/label still works for anything not
// in this list (mirrors Designer.tsx's FontPickerInput: a curated list is a
// narrowing filter, not a closed enum).
const COMMON_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "zh", label: "Chinese" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "fil", label: "Filipino" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pa", label: "Punjabi" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "ur", label: "Urdu" },
  { code: "vi", label: "Vietnamese" },
];

// Upload quota card — reused for both the Global tab (tenantHost=null, edits
// the instance-wide default) and the Site tab (tenantHost=the selected
// site's host, edits that site's override only — blank fields there mean
// "inherit global", not zero). Superadmin-only either way (SettingsPanel's
// whole route is), so no permission check needed here beyond that.
function StorageLimitsCard({ token, tenantHost }: { token: string; tenantHost: string | null }) {
  const { t } = useT();
  const [limits, setLimits] = useState<api.StorageLimits>({ maxUploadFileSizeMb: null, maxTotalStorageMb: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    setMsg(null);
    const load = tenantHost === null ? api.getGlobalStorageLimits(token) : api.getTenantStorageLimitsOverride(token, tenantHost);
    void load.then(setLimits).catch((e) => setErr((e as Error).message));
  }, [token, tenantHost]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (tenantHost === null) await api.putGlobalStorageLimits(token, limits);
      else await api.putTenantStorageLimitsOverride(token, tenantHost, limits);
      setMsg(t("settings-storage-saved"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const numField = (key: keyof api.StorageLimits, label: string) => (
    <label className="block space-y-1">
      <span className="text-xs text-sub">{label}</span>
      <input
        type="number"
        min={1}
        className={inputCls}
        value={limits[key] ?? ""}
        onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value === "" ? null : Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <div className={`${card} space-y-3 p-5`}>
      <h3 className="text-xs font-bold text-ink">{t("settings-storage-title")}</h3>
      <p className="text-xs text-sub">{t(tenantHost === null ? "settings-storage-desc-global" : "settings-storage-desc-site")}</p>
      <p className="text-[11px] italic text-sub">{t("settings-storage-blank-hint")}</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <div className="grid grid-cols-2 gap-3">
        {numField("maxUploadFileSizeMb", t("settings-storage-max-file"))}
        {numField("maxTotalStorageMb", t("settings-storage-max-total"))}
      </div>
      <button onClick={() => void save()} disabled={busy} className={btnPrimary}>
        {busy ? t("settings-busy") : t("settings-storage-save-btn")}
      </button>
    </div>
  );
}

// ---------- Settings (superadmin: backup / restore / static export) ----------
function SettingsPanel({ token, tenants }: { token: string; tenants: Array<Record<string, unknown>> }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [settingsTab, setSettingsTab] = useState<"global" | "site">("global");
  const [host, setHost] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [langs, setLangs] = useState<api.SiteLanguage[]>([]);
  const [langErr, setLangErr] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [langSuggestOpen, setLangSuggestOpen] = useState(false);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyConnected, setProxyConnected] = useState(false);
  const [proxyErr, setProxyErr] = useState<string | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaErr, setMfaErr] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [entraEnabled, setEntraEnabledState] = useState(false);
  const [entraOnly, setEntraOnlyState] = useState(false);
  const [entraTenantId, setEntraTenantIdState] = useState("");
  const [entraClientId, setEntraClientIdState] = useState("");
  const [entraErr, setEntraErr] = useState<string | null>(null);
  const [entraBusy, setEntraBusy] = useState(false);
  const [switcherPosition, setSwitcherPosition] = useState<api.SwitcherPosition>("header");
  const [switcherStyle, setSwitcherStyle] = useState<api.SwitcherStyle>("text");
  const [switcherErr, setSwitcherErr] = useState<string | null>(null);
  const [switcherBusy, setSwitcherBusy] = useState(false);
  const [switcherMsg, setSwitcherMsg] = useState<string | null>(null);
  const [proxyTenants, setProxyTenants] = useState<Array<Record<string, unknown>>>(tenants);
  const [certUploadHost, setCertUploadHost] = useState<string | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [sslDomain, setSslDomain] = useState("");
  const [sslEmail, setSslEmail] = useState("");
  const [sslBusy, setSslBusy] = useState(false);
  const [sslErr, setSslErr] = useState<string | null>(null);
  const [sslMsg, setSslMsg] = useState<string | null>(null);
  const existingCodes = new Set(langs.map((l) => l.code));
  const langSuggestions = newLabel.trim()
    ? COMMON_LANGUAGES.filter(
        (l) => l.label.toLowerCase().includes(newLabel.trim().toLowerCase()) && !existingCodes.has(l.code),
      ).slice(0, 8)
    : [];

  function pickLanguageSuggestion(l: { code: string; label: string }) {
    setNewLabel(l.label);
    setNewCode(l.code);
    setCodeTouched(false);
    setLangSuggestOpen(false);
  }

  function onNewLabelChange(value: string) {
    setNewLabel(value);
    setLangSuggestOpen(true);
    if (codeTouched) return;
    const trimmed = value.trim().toLowerCase();
    const match =
      COMMON_LANGUAGES.find((l) => l.label.toLowerCase() === trimmed) ??
      COMMON_LANGUAGES.find((l) => l.label.toLowerCase().startsWith(trimmed));
    setNewCode(trimmed && match ? match.code : "");
  }

  function reloadLanguages() {
    void api.listPortalLanguages(token).then(setLangs).catch((e) => setLangErr((e as Error).message));
  }
  useEffect(reloadLanguages, [token]);

  function reloadProxySettings() {
    void api.getProxySettings(token).then((s) => {
      setProxyEnabled(s.enabled);
      setProxyConnected(s.connected);
    }).catch((e) => setProxyErr((e as Error).message));
  }
  useEffect(reloadProxySettings, [token]);
  useEffect(() => setProxyTenants(tenants), [tenants]);

  function reloadProxyTenants() {
    void api.listPortalTenants(token).then(setProxyTenants);
  }
  // Cert status (hasCustomCert/certExpiresAt) can change from another admin's
  // session or a previous one of this admin's own — refresh whenever this
  // panel becomes visible or the selected site changes, not only right after
  // this session's own upload/revert.
  useEffect(() => {
    if (settingsTab === "site") reloadProxyTenants();
  }, [settingsTab, host, token]);

  async function toggleProxyEnabled(enabled: boolean) {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.setProxyAutomationEnabled(token, enabled);
      reloadProxySettings();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  function reloadLoginSettings() {
    void api
      .getLoginSettings(token)
      .then((s) => {
        setMfaEnabled(s.mfaEnabled);
        setMfaRequired(s.mfaRequired);
        setEntraEnabledState(s.entraEnabled);
        setEntraOnlyState(s.entraOnly);
        setEntraTenantIdState(s.entraTenantId ?? "");
        setEntraClientIdState(s.entraClientId ?? "");
      })
      .catch((e) => setMfaErr((e as Error).message));
  }
  useEffect(reloadLoginSettings, [token]);

  async function toggleMfaEnabled(enabled: boolean) {
    setMfaErr(null);
    setMfaBusy(true);
    try {
      await api.setLoginSettings(token, { mfaEnabled: enabled });
      reloadLoginSettings();
    } catch (e) {
      setMfaErr((e as Error).message);
    } finally {
      setMfaBusy(false);
    }
  }

  async function toggleMfaRequired(required: boolean) {
    setMfaErr(null);
    setMfaBusy(true);
    try {
      await api.setLoginSettings(token, { mfaRequired: required });
      reloadLoginSettings();
    } catch (e) {
      setMfaErr((e as Error).message);
    } finally {
      setMfaBusy(false);
    }
  }

  async function toggleEntraEnabled(enabled: boolean) {
    setEntraErr(null);
    setEntraBusy(true);
    try {
      await api.setLoginSettings(token, { entraEnabled: enabled });
      reloadLoginSettings();
    } catch (e) {
      setEntraErr((e as Error).message);
    } finally {
      setEntraBusy(false);
    }
  }

  async function toggleEntraOnly(only: boolean) {
    setEntraErr(null);
    setEntraBusy(true);
    try {
      await api.setLoginSettings(token, { entraOnly: only });
      reloadLoginSettings();
    } catch (e) {
      setEntraErr((e as Error).message);
    } finally {
      setEntraBusy(false);
    }
  }

  async function saveEntraConfig() {
    setEntraErr(null);
    setEntraBusy(true);
    try {
      await api.setLoginSettings(token, {
        entraTenantId: entraTenantId.trim() || null,
        entraClientId: entraClientId.trim() || null,
      });
      reloadLoginSettings();
    } catch (e) {
      setEntraErr((e as Error).message);
    } finally {
      setEntraBusy(false);
    }
  }

  function reloadSwitcherSettings() {
    void api
      .getLanguageSwitcherSettings(token)
      .then((s) => {
        setSwitcherPosition(s.switcherPosition);
        setSwitcherStyle(s.switcherStyle);
      })
      .catch((e) => setSwitcherErr((e as Error).message));
  }
  useEffect(reloadSwitcherSettings, [token]);

  async function saveSwitcherSettings() {
    setSwitcherErr(null);
    setSwitcherMsg(null);
    setSwitcherBusy(true);
    try {
      await api.setLanguageSwitcherSettings(token, switcherPosition, switcherStyle);
      setSwitcherMsg(t("tenant-languages-saved"));
    } catch (e) {
      setSwitcherErr((e as Error).message);
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function resyncProxy() {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      const res = await api.resyncProxy(token);
      if (!res.synced) setProxyErr(res.error ?? "Resync failed");
      reloadProxySettings();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function submitCertUpload() {
    if (!certUploadHost || !certFile || !keyFile) return;
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.uploadTenantCert(token, certUploadHost, certFile, keyFile);
      setCertUploadHost(null);
      setCertFile(null);
      setKeyFile(null);
      reloadProxyTenants();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function revertCert(host: string) {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.revertTenantCert(token, host);
      reloadProxyTenants();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function issueSsl() {
    setSslErr(null);
    setSslMsg(null);
    setSslBusy(true);
    try {
      await api.issueSslCert(token, sslDomain.trim(), sslEmail.trim());
      setSslMsg(t("settings-ssl-success"));
    } catch (e) {
      setSslErr((e as Error).message);
    } finally {
      setSslBusy(false);
    }
  }

  async function addLanguage() {
    setLangErr(null);
    try {
      await api.createPortalLanguage(token, newCode.trim(), newLabel.trim());
      setNewCode("");
      setNewLabel("");
      setCodeTouched(false);
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function saveLanguageLabel(id: string, label: string) {
    if (!label.trim()) return;
    setLangErr(null);
    try {
      await api.updatePortalLanguage(token, id, { label: label.trim() });
      setLabelDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function toggleLanguageEnabled(id: string, enabled: boolean) {
    setLangErr(null);
    try {
      await api.updatePortalLanguage(token, id, { enabled });
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function removeLanguage(id: string) {
    if (!(await confirm(t("settings-languages-delete-confirm")))) return;
    setLangErr(null);
    try {
      await api.deletePortalLanguage(token, id);
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setMsg(null);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const sections: Array<{ key: string; title: Key; desc: Key; btn: Key; onClick: () => void }> = [
    {
      key: "backup",
      title: "settings-backup-title",
      desc: "settings-backup-desc",
      btn: "settings-backup-btn",
      onClick: () => void run("backup", () => api.downloadTenantBackup(token, host)),
    },
    {
      key: "static",
      title: "settings-static-title",
      desc: "settings-static-desc",
      btn: "settings-static-btn",
      onClick: () => void run("static", () => api.downloadStaticExport(token, host)),
    },
  ];

  function pickRestoreFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!(await confirm(t("settings-restore-confirm")))) return;
      void run("restore", async () => {
        await api.restoreTenantBackup(token, host, file);
        setMsg(t("settings-restore-done"));
      });
    };
    input.click();
  }

  const selectedTenant = proxyTenants.find((tn) => (tn.host as string) === host);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex w-fit gap-1 rounded-full bg-canvas p-0.5">
        {(["global", "site"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSettingsTab(tab)}
            className={`rounded-full px-4 py-1 text-[11px] font-semibold ${
              settingsTab === tab ? "bg-white text-ink shadow-sm" : "text-sub hover:text-ink"
            }`}
          >
            {t(tab === "global" ? "settings-tab-global" : "settings-tab-site")}
          </button>
        ))}
      </div>

      {settingsTab === "global" && (
        <>
          <StorageLimitsCard token={token} tenantHost={null} />
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="text-xs font-bold text-ink">{t("settings-languages-title")}</h3>
            <p className="text-xs text-sub">{t("settings-languages-desc")}</p>
            {langErr && <p className="text-xs text-red-600">{langErr}</p>}
            <div className="space-y-1.5">
              {langs.map((l) => {
                const isLastEnabled = l.enabled && langs.filter((x) => x.enabled).length === 1;
                const draft = labelDrafts[l.id] ?? l.label;
                const dirty = draft !== l.label;
                return (
                  <div key={l.id} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 font-mono text-[11px] text-sub">{l.code}</span>
                    <input
                      className={inputCls}
                      value={draft}
                      onChange={(e) => setLabelDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    />
                    {dirty && (
                      <button
                        onClick={() => void saveLanguageLabel(l.id, draft)}
                        title={t("settings-languages-save-btn")}
                        aria-label={t("settings-languages-save-btn")}
                        className="shrink-0 text-accent hover:text-ink"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-sub">
                      <input
                        type="checkbox"
                        checked={l.enabled}
                        onChange={(e) => void toggleLanguageEnabled(l.id, e.target.checked)}
                      />
                      {t("settings-languages-enabled")}
                    </label>
                    <button
                      onClick={() => void removeLanguage(l.id)}
                      disabled={isLastEnabled}
                      title={isLastEnabled ? t("settings-languages-last-enabled") : undefined}
                      className="shrink-0 text-sub hover:text-red-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-start gap-2 pt-1">
              <div className="relative flex-1">
                <input
                  className={inputCls}
                  placeholder={t("settings-languages-label-placeholder")}
                  value={newLabel}
                  onChange={(e) => onNewLabelChange(e.target.value)}
                  onFocus={() => setLangSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setLangSuggestOpen(false), 150)}
                />
                {langSuggestOpen && langSuggestions.length > 0 && (
                  <div className={`${card} absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-auto shadow-lg`}>
                    {langSuggestions.map((l) => (
                      <button
                        key={l.code}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickLanguageSuggestion(l);
                        }}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-ink hover:bg-canvas"
                      >
                        <span>{l.label}</span>
                        <span className="font-mono text-[10px] text-sub">{l.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className={`${inputCls} !w-20 shrink-0`}
                placeholder={t("settings-languages-code-placeholder")}
                value={newCode}
                onChange={(e) => {
                  setNewCode(e.target.value);
                  setCodeTouched(true);
                }}
              />
              <button
                onClick={() => void addLanguage()}
                disabled={!newCode.trim() || !newLabel.trim()}
                className={`${btnGhost} shrink-0`}
              >
                {t("settings-languages-add-btn")}
              </button>
            </div>
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-proxy-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-proxy-desc")}</p>
            {proxyErr && <p className="text-xs text-red-600">{proxyErr}</p>}
            <label className="flex items-center gap-2 text-xs font-medium text-ink">
              <input
                type="checkbox"
                checked={proxyEnabled}
                disabled={proxyBusy}
                onChange={(e) => void toggleProxyEnabled(e.target.checked)}
              />
              {t("settings-proxy-enable")}
            </label>
            <p className="text-xs text-sub">{t("settings-proxy-dns-reminder")}</p>
            {!proxyEnabled && <p className="text-xs text-sub">{t("settings-proxy-manual-hint")}</p>}
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-ssl-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-ssl-desc")}</p>
            {sslErr && <p className="text-xs text-red-600">{sslErr}</p>}
            {sslMsg && <p className="text-xs text-green-700">{sslMsg}</p>}
            <div className="flex flex-wrap gap-2">
              <input
                className={`${inputCls} !w-56`}
                placeholder={t("settings-ssl-domain-placeholder")}
                value={sslDomain}
                onChange={(e) => setSslDomain(e.target.value)}
              />
              <input
                className={`${inputCls} !w-56`}
                placeholder={t("settings-ssl-email-placeholder")}
                value={sslEmail}
                onChange={(e) => setSslEmail(e.target.value)}
              />
              <button
                onClick={() => void issueSsl()}
                disabled={sslBusy || !sslDomain.trim() || !sslEmail.trim()}
                className={btnGhost}
              >
                {sslBusy ? t("settings-ssl-busy") : t("settings-ssl-issue-btn")}
              </button>
            </div>
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-login-methods-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-login-methods-desc")}</p>
            {mfaErr && <p className="text-xs text-red-600">{mfaErr}</p>}
            <div className="space-y-2 rounded-lg border border-line/40 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink">{t("settings-login-password")}</span>
                <span className="text-sub">{t("settings-login-always-on")}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={mfaEnabled}
                    disabled={mfaBusy}
                    onChange={(e) => void toggleMfaEnabled(e.target.checked)}
                  />
                  {t("settings-login-mfa")}
                </label>
              </div>
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={mfaRequired}
                    disabled={mfaBusy || !mfaEnabled}
                    onChange={(e) => void toggleMfaRequired(e.target.checked)}
                  />
                  {t("settings-login-mfa-required")}
                </label>
              </div>
              {mfaRequired && <p className="text-xs text-sub">{t("settings-login-mfa-required-hint")}</p>}
            </div>
            {mfaEnabled && <p className="text-xs text-sub">{t("settings-login-mfa-hint")}</p>}
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-login-entra")}
            </h3>
            <p className="text-xs text-sub">{t("settings-entra-desc")}</p>
            {entraErr && <p className="text-xs text-red-600">{entraErr}</p>}
            <div className="space-y-2 rounded-lg border border-line/40 p-3">
              <label className="flex items-center gap-2 text-xs font-medium text-ink">
                <input
                  type="checkbox"
                  checked={entraEnabled}
                  disabled={entraBusy}
                  onChange={(e) => void toggleEntraEnabled(e.target.checked)}
                />
                {t("settings-entra-enable")}
              </label>
              {entraEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className={inputCls}
                      placeholder={t("settings-entra-tenant-id-placeholder")}
                      value={entraTenantId}
                      onChange={(e) => setEntraTenantIdState(e.target.value)}
                    />
                    <input
                      className={inputCls}
                      placeholder={t("settings-entra-client-id-placeholder")}
                      value={entraClientId}
                      onChange={(e) => setEntraClientIdState(e.target.value)}
                    />
                  </div>
                  <button onClick={() => void saveEntraConfig()} disabled={entraBusy} className={btnGhost}>
                    {t("settings-entra-save")}
                  </button>
                  <p className="text-[11px] text-sub">{t("settings-entra-secret-hint")}</p>
                  <label className="flex items-center gap-2 text-xs font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={entraOnly}
                      disabled={entraBusy}
                      onChange={(e) => void toggleEntraOnly(e.target.checked)}
                    />
                    {t("settings-entra-only")}
                  </label>
                  {entraOnly && <p className="text-[11px] text-amber-700">{t("settings-entra-only-warning")}</p>}
                </>
              )}
            </div>
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <Globe className="h-3.5 w-3.5 text-accent" /> {t("settings-switcher-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-switcher-desc")}</p>
            {switcherErr && <p className="text-xs text-red-600">{switcherErr}</p>}
            {switcherMsg && <p className="text-xs text-green-700">{switcherMsg}</p>}
            <label className="block text-xs text-ink">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-languages-switcher-position")}</span>
              <select
                value={switcherPosition}
                onChange={(e) => setSwitcherPosition(e.target.value as api.SwitcherPosition)}
                className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
              >
                <option value="header">{t("switcher-pos-header")}</option>
                <option value="topbar">{t("switcher-pos-topbar")}</option>
                <option value="float">{t("switcher-pos-float")}</option>
                <option value="footer">{t("switcher-pos-footer")}</option>
              </select>
            </label>
            <label className="block text-xs text-ink">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-languages-switcher-style")}</span>
              <select
                value={switcherStyle}
                onChange={(e) => setSwitcherStyle(e.target.value as api.SwitcherStyle)}
                className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
              >
                <option value="text">{t("switcher-style-text")}</option>
                <option value="flag">{t("switcher-style-flag")}</option>
                <option value="shortform">{t("switcher-style-shortform")}</option>
              </select>
            </label>
            <button onClick={() => void saveSwitcherSettings()} disabled={switcherBusy} className={btnPrimary}>
              {switcherBusy ? t("settings-busy") : t("tenant-languages-save-btn")}
            </button>
          </div>
        </>
      )}

      {settingsTab === "site" && (
        <>
          <Select value={host} onValueChange={setHost}>
            <SelectTrigger>
              <SelectValue placeholder={t("settings-tenant")} />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((tn) => (
                <SelectItem key={tn.host as string} value={tn.host as string}>
                  {(tn.departmentName as string) || (tn.host as string)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err && <p className="text-xs text-red-600">{err}</p>}
          {msg && <p className="text-xs text-green-700">{msg}</p>}
          {host && <StorageLimitsCard key={host} token={token} tenantHost={host} />}
          {sections.map((s) => (
            <div key={s.key} className={`${card} space-y-2 p-5`}>
              <h3 className="text-xs font-bold text-ink">{t(s.title)}</h3>
              <p className="text-xs text-sub">{t(s.desc)}</p>
              <button disabled={!host || busy !== null} onClick={s.onClick} className={btnPrimary}>
                {busy === s.key ? t("settings-busy") : t(s.btn)}
              </button>
            </div>
          ))}
          <div className={`${card} space-y-2 p-5`}>
            <h3 className="text-xs font-bold text-ink">{t("settings-restore-title")}</h3>
            <p className="text-xs text-sub">{t("settings-restore-desc")}</p>
            <button disabled={!host || busy !== null} onClick={pickRestoreFile} className={btnPrimary}>
              {busy === "restore" ? t("settings-busy") : t("settings-restore-btn")}
            </button>
          </div>
          {proxyEnabled && host && (
            <div className={`${card} space-y-3 p-5`}>
              <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
                <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-proxy-title")}
              </h3>
              {proxyErr && <p className="text-xs text-red-600">{proxyErr}</p>}
              <div className="flex items-center gap-2 text-xs">
                <span className={proxyConnected ? "text-ok" : "text-red-600"}>
                  {proxyConnected ? t("settings-proxy-status-connected") : t("settings-proxy-status-disconnected")}
                </span>
                <button onClick={() => void resyncProxy()} disabled={proxyBusy} className={btnGhost}>
                  {proxyBusy ? t("settings-busy") : t("settings-proxy-resync-btn")}
                </button>
              </div>
              {selectedTenant && (
                <div className="space-y-2">
                  {(() => {
                    const tHost = selectedTenant.host as string;
                    const hasCustomCert = Boolean(selectedTenant.hasCustomCert);
                    const certExpiresAt = selectedTenant.certExpiresAt as string | null;
                    const expiringSoon =
                      hasCustomCert && Boolean(certExpiresAt) &&
                      new Date(certExpiresAt as string).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
                    return (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div>
                          <p className="font-mono text-ink">{tHost}</p>
                          <p className={expiringSoon ? "font-semibold text-amber-700" : "text-sub"}>
                            {hasCustomCert && certExpiresAt
                              ? `${t("settings-proxy-cert-custom")} — ${new Date(certExpiresAt).toLocaleDateString()}`
                              : t("settings-proxy-cert-auto")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {hasCustomCert && (
                            <button onClick={() => void revertCert(tHost)} disabled={proxyBusy} className={btnGhost}>
                              {t("settings-proxy-revert-btn")}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setCertUploadHost(certUploadHost === tHost ? null : tHost);
                              setCertFile(null);
                              setKeyFile(null);
                            }}
                            disabled={proxyBusy}
                            className={btnGhost}
                          >
                            {t("settings-proxy-upload-btn")}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              {certUploadHost && (
                <div className={`${card} space-y-2 border border-line p-3`}>
                  <p className="text-xs font-semibold text-ink">{certUploadHost}</p>
                  <label className="block text-xs text-sub">
                    {t("settings-proxy-upload-cert-file")}
                    <input
                      type="file"
                      accept=".crt,.pem,.cer"
                      onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                      className="mt-1 block text-xs"
                    />
                  </label>
                  <label className="block text-xs text-sub">
                    {t("settings-proxy-upload-key-file")}
                    <input
                      type="file"
                      accept=".key,.pem"
                      onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
                      className="mt-1 block text-xs"
                    />
                  </label>
                  <button
                    onClick={() => void submitCertUpload()}
                    disabled={proxyBusy || !certFile || !keyFile}
                    className={btnPrimary}
                  >
                    {proxyBusy ? t("settings-busy") : t("settings-proxy-upload-submit")}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NavButton({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
  const { t } = useT();
  const { labelKey, icon: Icon } = TAB_META[tab];
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        active ? "bg-canvas text-accent" : "text-body hover:bg-canvas/60 hover:text-ink"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{t(labelKey)}</span>
    </button>
  );
}

function Shell({
  session,
  onLogout,
  onImpersonate,
  impersonating,
  onExitImpersonation,
}: {
  session: Session;
  onLogout: () => void;
  onImpersonate: (s: Session) => void;
  impersonating: boolean;
  onExitImpersonation: () => void;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const t = (k: Key) => dict[lang][k];
  const isSuper = session.role === "superadmin";
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = (location.pathname.split("/")[1] || "dashboard") as Tab;
  // Sidebar is a fixed off-canvas drawer below md (Sprint 2: responsive admin
  // shell), static in-flow at md+ — see the `aside`/backdrop classes below.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const goTo = (tb: Tab) => {
    navigate(`/${tb}`);
    setMobileNavOpen(false);
  };
  // superadmin picks which site to manage in the content tab; webmaster is locked to theirs
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [siteHost, setSiteHost] = useState<string>(session.tenantHost ?? "");

  useEffect(() => {
    if (isSuper) void api.listPortalTenants(session.token).then(setTenants);
  }, [isSuper, session.token]);

  // Webmaster with more than one assigned site gets the same site picker a
  // superadmin sees, restricted to just their own sites (no departmentName
  // available for these, host doubles as the label).
  const siteOptions = isSuper
    ? tenants
    : session.tenantHosts.map((h) => ({ id: h, host: h, departmentName: h }));
  const showSitePicker = isSuper || session.tenantHosts.length > 1;

  const mainTabs: Tab[] = isSuper ? ["dashboard", "multisite", "users", "roles", "settings", "security"] : ["dashboard", "security"];
  const contentTabs: Tab[] = isSuper
    ? ["content", "global-theme", "feed"]
    : ["content", "theme", "languages", "menus", "header-footer", "blueprints", "events"];

  return (
    <I18nCtx.Provider value={{ lang, t }}>
      {/* Nested here (not at the app root in main.tsx) so its confirm-dialog
          labels can call useT() and actually see this real lang state —
          every useConfirm() call site lives inside Shell anyway (nothing
          pre-login uses it), so nothing upstream needs it. */}
      <ConfirmDialogProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-canvas font-sans text-ink antialiased">
        {impersonating && (
          <div className="flex shrink-0 items-center justify-center gap-3 bg-warn px-4 py-1.5 text-[11px] font-semibold text-white">
            <span>
              {t("impersonate-banner")} {session.tenantHost} ({session.role})
            </span>
            <button onClick={onExitImpersonation} className="rounded-full bg-white/20 px-2.5 py-0.5 hover:bg-white/30">
              {t("impersonate-exit")}
            </button>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
        {/* Mobile-only backdrop, closes the drawer on outside tap */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}
        {/* Sidebar: fixed off-canvas drawer below md, static in-flow at md+ */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex h-full w-64 shrink-0 transform flex-col border-r border-line/50 bg-white transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center gap-3 border-b border-line/30 p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
              U
            </div>
            <div>
              <h1 className="font-display text-sm font-bold tracking-tight text-ink">USIM CMS</h1>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
            </div>
            <button
              onClick={() => setMobileNavOpen(false)}
              className="ml-auto rounded-full p-1.5 text-sub hover:bg-canvas hover:text-ink md:hidden"
              aria-label={t("nav-close")}
              title={t("nav-close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex-1 space-y-1.5 overflow-y-auto p-4">
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-main")}</div>
            {mainTabs.map((tb) => (
              <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => goTo(tb)} />
            ))}
            {isSuper ? (
              <>
                <div className="mb-2 px-3 pt-4 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-content")}</div>
                {contentTabs.map((tb) => (
                  <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => goTo(tb)} />
                ))}
              </>
            ) : (
              NAV_GROUP_ORDER.map((group) => {
                const tabs = contentTabs.filter((tb) => TAB_GROUP[tb] === group);
                if (tabs.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="mb-2 px-3 pt-4 text-[10px] font-bold uppercase tracking-wider text-sub">{t(NAV_GROUP_LABEL[group])}</div>
                    {tabs.map((tb) => (
                      <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => goTo(tb)} />
                    ))}
                  </div>
                );
              })
            )}
          </nav>
          <div className="flex items-center gap-3 border-t border-line/30 bg-canvas/30 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold uppercase text-white">
              {session.role[0]}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-xs font-semibold capitalize text-ink">{session.role}</h4>
              {session.tenantHost && <p className="truncate text-[10px] text-sub">{session.tenantHost}</p>}
            </div>
            <button
              onClick={onLogout}
              className="rounded-full p-1.5 text-sub transition-colors hover:bg-canvas hover:text-ink"
              title={t("logout")}
              aria-label={t("logout")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden bg-white">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line/40 bg-white px-4 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="shrink-0 rounded-full p-1.5 text-sub hover:bg-canvas hover:text-ink md:hidden"
                aria-label={t("nav-open")}
                title={t("nav-open")}
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="hidden text-xs font-bold uppercase tracking-wider text-sub sm:inline">{t("header-workspace")}</span>
              <ChevronRight className="hidden h-3.5 w-3.5 text-line sm:inline" />
              <span className="flex items-center gap-1.5 truncate rounded-full border border-line/30 bg-canvas px-2.5 py-0.5 text-xs font-bold text-ink">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="truncate">{t(TAB_META[activeTab].labelKey)}</span>
              </span>
              <span className="hidden shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-accent sm:inline">
                {session.role}
              </span>
            </div>
            <div className="flex shrink-0 rounded-lg border border-line/50 bg-canvas p-0.5">
              {(["ms", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`flex items-center gap-1 rounded px-3 py-1 text-[10px] transition-all ${
                    lang === l ? "bg-white font-semibold text-ink shadow-sm" : "font-medium text-sub hover:text-ink"
                  }`}
                >
                  <Languages className="h-3 w-3 text-accent" /> {l.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <main className="flex-1 overflow-y-auto bg-white p-4 sm:p-8">
            <div className="mx-auto max-w-7xl space-y-6 pb-10">
              <Suspense fallback={<ListLoading />}>
              <Routes>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard session={session} />} />
                <Route
                  path="multisite"
                  element={isSuper ? <TenantsPanel token={session.token} setSiteHost={setSiteHost} /> : <Navigate to="/dashboard" replace />}
                />
                <Route path="users" element={isSuper ? <UsersPanel token={session.token} onImpersonate={onImpersonate} /> : <Navigate to="/dashboard" replace />} />
                <Route path="roles" element={isSuper ? <RolesPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
                <Route path="content/*" element={<ContentManager isSuper={isSuper} showSitePicker={showSitePicker} siteHost={siteHost} setSiteHost={setSiteHost} tenants={siteOptions} token={session.token} />} />
                <Route path="theme" element={!isSuper && session.tenantHost ? (<ThemeForm title={t("theme-title")} desc={t("theme-desc")} load={() => api.getTheme(session.tenantHost!, session.token)} save={(s) => api.putTheme(session.tenantHost!, session.token, s)} token={session.token} allowDeactivate previewTenantHost={session.tenantHost!} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="languages" element={!isSuper && session.tenantHost ? (<TenantLanguagesForm tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="menus" element={!isSuper && session.tenantHost ? (<MenusPanel tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="header-footer" element={!isSuper && session.tenantHost ? (<HeaderFooterPanel tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route
                  path="header-footer/:id"
                  element={!isSuper && session.tenantHost ? (<HeaderFooterDesignerRoute tenantHost={session.tenantHost} token={session.token} isSuper={false} backTo="/header-footer" />) : (<Navigate to="/dashboard" replace />)}
                />
                <Route path="blueprints" element={!isSuper && session.tenantHost ? (<BlueprintGallery tenantHost={session.tenantHost} token={session.token} mode="manage" isSuper={false} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="blueprints/:id" element={!isSuper && session.tenantHost ? (<BlueprintDesignerRoute tenantHost={session.tenantHost} token={session.token} isSuper={false} backTo="/blueprints" />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="symbols/:id" element={!isSuper && session.tenantHost ? (<SymbolDesignerRoute tenantHost={session.tenantHost} token={session.token} isSuper={false} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="events" element={!isSuper && session.tenantHost ? (<EventsPanel tenantHost={session.tenantHost} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="global-theme" element={isSuper ? (<ThemeForm title={t("gtheme-title")} load={() => api.getGlobalTheme(session.token)} save={(s) => api.putGlobalTheme(session.token, s)} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="feed" element={isSuper ? <PortalFeedPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
                <Route path="settings" element={isSuper ? <SettingsPanel token={session.token} tenants={tenants} /> : <Navigate to="/dashboard" replace />} />
                <Route path="security" element={<SecurityPanel token={session.token} />} />
              </Routes>
              </Suspense>
            </div>
          </main>
        </div>
        </div>
      </div>
      </ConfirmDialogProvider>
    </I18nCtx.Provider>
  );
}

const IMPERSONATOR_KEY = "usim_cms_impersonator";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  // Entra login lands here as a real browser navigation (never a fetch —
  // Microsoft's own login page needs a top-level redirect). entra/callback
  // deliberately does NOT put session data in this redirect's query string
  // (a URL leaks into server access logs and Referer far more readily than a
  // response body — see apps/api/CLAUDE.md's Auth hardening section), so on
  // landing here this fetches it back via GET /api/auth/session, authenticated
  // by the httpOnly cookie that route already set — there's no client-side
  // router mounted pre-login at all (see the BrowserRouter further down, only
  // wrapping the post-session Shell), so this is a plain pathname check, not
  // a routed page.
  const [entraError, setEntraError] = useState<string | null>(null);
  useEffect(() => {
    if (window.location.pathname !== "/entra-callback") return;
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState({}, "", "/");
    const err = params.get("entraError");
    if (err) {
      setEntraError(err);
      return;
    }
    api
      .fetchEntraSession()
      .then((s) => {
        const newSession: Session = { token: s.csrfToken, role: s.role, tenantHost: s.tenantHost, tenantHosts: s.tenantHosts };
        localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
        setSession(newSession);
      })
      .catch(() => setEntraError("verification_failed"));
  }, []);
  // Set only while a superadmin is "viewing as" a webmaster — the stashed
  // superadmin session to restore on exit. Persisted so a page refresh
  // mid-impersonation doesn't strand the admin in the webmaster's view.
  // Only a UI flag (banner + exit button) now — the superadmin's original
  // session cannot be restored from a value stashed in localStorage anymore
  // (the real session is an httpOnly cookie the impersonate call overwrote,
  // unreadable by JS even before that). exitImpersonation() below gets it
  // back via a real server round-trip instead. See POST
  // /api/portal/exit-impersonation.
  const [impersonating, setImpersonating] = useState<boolean>(() => localStorage.getItem(IMPERSONATOR_KEY) === "1");
  // null = still checking; a fresh install has zero users, so the wizard
  // must win the race against LoginForm rather than flash it on load.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) api.getSetupStatus().then(setNeedsSetup).catch(() => setNeedsSetup(false));
  }, [session]);

  async function logout() {
    const t = session?.token ?? null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(IMPERSONATOR_KEY);
    setSession(null);
    setImpersonating(false);
    try {
      await api.logout(t);
    } catch {
      // Clearing the local session already logs the user out of the UI;
      // the server-side cookie clear is best-effort (e.g. already expired).
    }
  }

  function impersonate(target: Session) {
    if (session) {
      localStorage.setItem(IMPERSONATOR_KEY, "1");
      setImpersonating(true);
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(target));
    setSession(target);
  }

  async function exitImpersonation() {
    if (!session) return;
    const restored = await api.exitImpersonation(session.token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(restored));
    localStorage.removeItem(IMPERSONATOR_KEY);
    setSession(restored);
    setImpersonating(false);
  }

  if (!session) {
    if (needsSetup === null) return null;
    if (needsSetup) return <SetupWizard onDone={setSession} />;
    return <LoginForm onLogin={setSession} entraError={entraError} />;
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/*"
          element={
            <Shell
              // Forces a full remount on every session swap (login/impersonate/exit)
              // — Shell's siteHost/tab state only initializes from session on mount,
              // and without this a same-instance prop swap leaves both stuck on
              // whatever the previous session had (wrong x-tenant-host, dead tabs).
              key={session.token}
              session={session}
              onLogout={logout}
              onImpersonate={impersonate}
              impersonating={impersonating}
              onExitImpersonation={exitImpersonation}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
