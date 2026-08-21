// Small, closure-free leaf field-control components used by FieldInput and
// FourSideControl — split out of Designer.tsx (Layer 1a of the God
// Component refactor, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md). Each
// one holds its own useState/useRef and reads nothing from Designer()'s
// closure except BpToggle, which now takes `bp`/`t` as explicit props
// instead (see its signature below) — its call sites now live across
// Designer.tsx, FieldInput.tsx, and FieldGroups.tsx.
import { useEffect, useRef, useState } from "react";
import { Smartphone, Tablet } from "lucide-react";
import { GOOGLE_FONTS } from "@/lib/utils";
import type { Key } from "@/i18n";
import type { Bp } from "./types";

export function BufferedInput({
  value,
  onCommit,
  className,
  type,
  placeholder,
  title,
  step,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  type?: string;
  placeholder?: string;
  title?: string;
  step?: number;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      type={type}
      step={step}
      className={className}
      placeholder={placeholder}
      title={title}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

export function BufferedTextarea({
  value,
  onCommit,
  className,
  rows,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  rows?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      rows={rows}
      className={className}
      placeholder={placeholder}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

// Typeable/scrollable Google Font picker — mirrors App.tsx's ThemeForm
// FontField exactly (typing filters a dropdown of matches, each option
// rendered in its own font-family so it previews rather than just naming
// itself), but with no <label> of its own since FieldInput's other kinds
// are bare controls — FieldGroups/renderTypographyFields already render
// the field's label above it.
export function FontPickerInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const matches = GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(value.toLowerCase()));
  return (
    <div className="relative">
      <input
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Poppins"
      />
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

// "Volume up/down" style numeric stepper — a BufferedInput flanked by
// −/+ buttons, used by the shadow panel's X/Y/blur/spread fields (no
// preset dropdown; user explicitly asked for real numbers here).
export function NumberStepper({
  label,
  value,
  step = 1,
  min,
  onCommit,
}: {
  label: string;
  value: string;
  step?: number;
  min?: number;
  onCommit: (v: string) => void;
}) {
  const n = Number(value) || 0;
  const round = (x: number) => Math.round(x * 100) / 100;
  return (
    <label className="block text-[10px] font-medium text-sub">
      {label}
      <div className="mt-0.5 flex items-center rounded-lg border border-line/30 bg-canvas">
        <button
          type="button"
          onClick={() => onCommit(String(round(Math.max(min ?? -Infinity, n - step))))}
          className="px-2 py-1 text-sub hover:text-ink"
        >
          −
        </button>
        <BufferedInput
          type="number"
          step={step}
          value={value}
          onCommit={onCommit}
          className="w-full border-0 bg-transparent px-1 py-1 text-center text-[11px] outline-none"
        />
        <button type="button" onClick={() => onCommit(String(round(n + step)))} className="px-2 py-1 text-sub hover:text-ink">
          +
        </button>
      </div>
    </label>
  );
}

// Elementor/Webflow-style per-field responsive toggle: a small Tablet/
// Smartphone icon next to a setting's own label, filled/accent when THIS
// field (or, for FourSideControl, any of its side keys) actually has an
// override at the current bp, muted/outline when it's just inheriting the
// desktop value. Clicking toggles between the two — enabling seeds the
// override at "" (falls through to the normal default-preset resolution
// until typed over), disabling removes it. Renders nothing on desktop —
// there's nothing to override against on the base breakpoint itself.
// `bp`/`t` are explicit props (not read from a Designer() closure) since
// this component now lives outside Designer.tsx — every call site passes
// Designer()'s own `bp` state and `t` prop through unchanged.
export function BpToggle({
  active,
  onToggle,
  bp,
  t,
}: {
  active: boolean;
  onToggle: () => void;
  bp: Bp;
  t: (k: Key) => string;
}) {
  if (bp === "desktop") return null;
  const Icon = bp === "tablet" ? Tablet : Smartphone;
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onToggle();
      }}
      title={t(active ? "designer-bp-override-clear" : "designer-bp-override-set")}
      className={`inline-flex rounded p-0.5 ${active ? "text-accent" : "text-sub/40 hover:text-sub"}`}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
