// socialicons' platform picker (FieldInput.tsx's repeater "social" item field):
// search a brand by name, pick its logo, then fill the link. Brands are
// @ucms/element-render's SOCIAL_ICONS (Simple Icons logos), the same table
// RepeaterBlock.astro renders on the site; website/email/phone/link stay the
// generic stroke icons they always were.
import { useState } from "react";
import { ChevronDown, Share2 } from "lucide-react";
import { SOCIAL_ICONS, bestTextColor } from "@ucms/element-render";
import type { Key } from "@/i18n";
import { ICONS } from "./icons";

const GENERIC: Record<string, Key> = {
  globe: "designer-social-website",
  mail: "designer-social-email",
  phone: "designer-social-phone",
  link: "designer-social-link",
};
const PLATFORMS = [...Object.keys(SOCIAL_ICONS), ...Object.keys(GENERIC)];

function label(platform: string, t: (k: Key) => string): string {
  return SOCIAL_ICONS[platform]?.title ?? (GENERIC[platform] ? t(GENERIC[platform]) : platform);
}

// `brand` paints the logo in its own color (picker grid); otherwise currentColor.
export function SocialGlyph({ platform, className, brand }: { platform: string; className?: string; brand?: boolean }) {
  const icon = SOCIAL_ICONS[platform];
  if (!icon) {
    const Icon = ICONS[platform] ?? Share2;
    return <Icon className={className} aria-hidden />;
  }
  return (
    <svg viewBox={icon.viewBox ?? "0 0 24 24"} className={className} fill={brand ? `#${icon.hex}` : "currentColor"} aria-hidden>
      <path d={icon.path} />
    </svg>
  );
}

export function SocialPicker({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: (k: Key) => string }) {
  // A just-added (empty) row opens straight onto the search.
  const [open, setOpen] = useState(!value);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const options = PLATFORMS.filter((p) => !query || `${p} ${label(p, t)} ${SOCIAL_ICONS[p]?.alias ?? ""}`.toLowerCase().includes(query));
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-line/30 bg-canvas px-2 py-1.5 text-xs text-ink hover:border-line"
      >
        {value && <SocialGlyph platform={value} brand className="h-4 w-4 shrink-0" />}
        <span className="flex-1 truncate text-left">{value ? label(value, t) : t("designer-social-choose")}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-sub transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 rounded-lg border border-line/30 bg-canvas p-1.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("designer-social-search")}
            aria-label={t("designer-social-search")}
            className="w-full rounded-md border border-line/30 bg-white px-2 py-1 text-xs text-ink outline-none focus:border-line"
          />
          <div className="grid max-h-52 grid-cols-4 gap-1 overflow-y-auto">
            {options.length === 0 && <p className="col-span-4 py-2 text-center text-xs text-sub">{t("designer-social-none")}</p>}
            {options.map((p) => (
              <button
                key={p}
                type="button"
                title={label(p, t)}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                  setQ("");
                }}
                className={`flex flex-col items-center gap-1 rounded-md p-1.5 text-[9px] ${value === p ? "bg-accent/15 font-semibold text-accent" : "text-body hover:bg-white"}`}
              >
                <SocialGlyph platform={p} brand className="h-5 w-5" />
                <span className="w-full truncate text-center">{label(p, t)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// socialStyle's picture tiles: RepeaterBlock.astro's ds-socialicons-* drawn on one logo.
const SAMPLE = SOCIAL_ICONS.facebook;
export function SocialStyleTiles({ options, value, onChange, t }: { options: string[]; value: string; onChange: (v: string) => void; t: (k: Key) => string }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => {
        const on = (value || "outline") === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            title={t(`designer-social-style-${o}` as Key)}
            aria-label={t(`designer-social-style-${o}` as Key)}
            aria-pressed={on}
            className={`flex flex-1 justify-center rounded-lg border py-1.5 ${on ? "border-accent bg-accent/10" : "border-line/30 hover:border-accent/40"}`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-ink ${o === "outline" ? "border border-current" : ""}`}
              style={o === "brand" ? { background: `#${SAMPLE.hex}`, color: bestTextColor(`#${SAMPLE.hex}`) } : undefined}
            >
              <SocialGlyph platform="facebook" className="h-3.5 w-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
