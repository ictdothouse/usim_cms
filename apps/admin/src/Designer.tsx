import { useEffect, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  GripVertical,
  Heading1,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  Plus,
  Trash2,
  Type,
  Undo2,
  Video,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import type { Key } from "@/i18n";

// ---------- data model (stored in pages.layout JSONB) ----------
// A designer page is a list of blocks; the designer emits `section` blocks:
//   { type: "section", props: { bg?, bgImage?, textColor?, paddingY?, width?, rows: Row[] } }
// Legacy blocks (hero/text/image from the old BlockBuilder) are kept as-is and
// shown as locked cards — the frontend still renders them.

type ElType = "heading" | "text" | "image" | "button" | "spacer" | "divider" | "embed";

interface El {
  id: string;
  type: ElType;
  props: Record<string, string>;
}
interface Col {
  span: number;
  elements: El[];
}
interface Row {
  columns: Col[];
}
interface SectionProps {
  bg?: string;
  bgImage?: string;
  textColor?: string;
  paddingY?: string;
  width?: string;
  rows: Row[];
}
interface Block {
  type: string;
  props: Record<string, unknown>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type FieldKind = "text" | "textarea" | "select" | "color" | "image";
interface Field {
  key: string;
  labelKey: Key;
  kind: FieldKind;
  options?: string[];
}

const ELS: Record<ElType, { labelKey: Key; icon: typeof Type; defaults: Record<string, string>; fields: Field[] }> = {
  heading: {
    labelKey: "designer-el-heading",
    icon: Heading1,
    defaults: { text: "Heading", level: "2", align: "left" },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "level", labelKey: "designer-f-level", kind: "select", options: ["1", "2", "3", "4"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  text: {
    labelKey: "designer-el-text",
    icon: Type,
    defaults: { text: "", size: "md", align: "left" },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "size", labelKey: "designer-f-size", kind: "select", options: ["sm", "md", "lg"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  image: {
    labelKey: "designer-el-image",
    icon: ImageIcon,
    defaults: { src: "", alt: "", radius: "md" },
    fields: [
      { key: "src", labelKey: "designer-f-src", kind: "image" },
      { key: "alt", labelKey: "designer-f-alt", kind: "text" },
      { key: "radius", labelKey: "designer-f-radius", kind: "select", options: ["none", "md", "xl", "full"] },
    ],
  },
  button: {
    labelKey: "designer-el-button",
    icon: MousePointerClick,
    defaults: { label: "Button", href: "#", variant: "primary", align: "left" },
    fields: [
      { key: "label", labelKey: "designer-f-label", kind: "text" },
      { key: "href", labelKey: "designer-f-href", kind: "text" },
      { key: "variant", labelKey: "designer-f-variant", kind: "select", options: ["primary", "outline"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  spacer: {
    labelKey: "designer-el-spacer",
    icon: MoveVertical,
    defaults: { height: "md" },
    fields: [{ key: "height", labelKey: "designer-f-height", kind: "select", options: ["sm", "md", "lg", "xl"] }],
  },
  divider: { labelKey: "designer-el-divider", icon: Minus, defaults: {}, fields: [] },
  embed: {
    labelKey: "designer-el-embed",
    icon: Video,
    defaults: { url: "", ratio: "16:9" },
    fields: [
      { key: "url", labelKey: "designer-f-url", kind: "text" },
      { key: "ratio", labelKey: "designer-f-ratio", kind: "select", options: ["16:9", "4:3", "1:1"] },
    ],
  },
};

const SECTION_FIELDS: Field[] = [
  { key: "bg", labelKey: "designer-s-bg", kind: "color" },
  { key: "bgImage", labelKey: "designer-s-bgimage", kind: "image" },
  { key: "textColor", labelKey: "designer-s-textcolor", kind: "color" },
  { key: "paddingY", labelKey: "designer-s-padding", kind: "select", options: ["sm", "md", "lg", "xl"] },
  { key: "width", labelKey: "designer-s-width", kind: "select", options: ["contained", "full"] },
];

const PAD: Record<string, string> = { sm: "1.5rem", md: "3rem", lg: "5rem", xl: "7rem" };
const SPACE: Record<string, string> = { sm: "1rem", md: "2rem", lg: "4rem", xl: "6rem" };
const RADIUS: Record<string, string> = { none: "0", md: "0.75rem", xl: "1.5rem", full: "9999px" };
const TEXT_SIZE: Record<string, string> = { sm: "0.875rem", md: "1rem", lg: "1.2rem" };
const H_SIZE: Record<string, string> = { "1": "2.6rem", "2": "2rem", "3": "1.5rem", "4": "1.2rem" };

// Row presets offered by "add row": each entry is the column span list.
const ROW_PRESETS: number[][] = [[1], [1, 1], [1, 1, 1], [1, 1, 1, 1], [1, 2], [2, 1]];

const newSection = (): Block => ({
  type: "section",
  props: { paddingY: "md", width: "contained", rows: [{ columns: [{ span: 1, elements: [] }] }] },
});
const newEl = (type: ElType): El => ({ id: uid(), type, props: { ...ELS[type].defaults } });

// selection path: [block] | [block,row] | [block,row,col] | [block,row,col,el]
type Sel = number[] | null;

// drag payload: a new palette element, or a move of an existing one
type Drag = { kind: "new"; type: ElType } | { kind: "move"; path: number[] };

export default function Designer({
  page,
  tenantHost,
  token,
  t,
  onClose,
}: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  t: (k: Key) => string;
  onClose: (saved: boolean) => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => clone((page.layout as Block[] | undefined) ?? []));
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAny, setSavedAny] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const history = useRef<Block[][]>([]);
  const drag = useRef<Drag | null>(null);

  function mutate(fn: (next: Block[]) => void) {
    history.current.push(clone(blocks));
    if (history.current.length > 50) history.current.shift();
    const next = clone(blocks);
    fn(next);
    setBlocks(next);
    setDirty(true);
  }

  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    setBlocks(prev);
    setSel(null);
    setDirty(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const section = (bs: Block[], b: number) => bs[b].props as unknown as SectionProps;

  function removeAt(bs: Block[], path: number[]): El {
    const [b, r, c, e] = path;
    return section(bs, b).rows[r].columns[c].elements.splice(e, 1)[0];
  }

  function insertEl(bs: Block[], colPath: number[], el: El, index?: number) {
    const [b, r, c] = colPath;
    const list = section(bs, b).rows[r].columns[c].elements;
    list.splice(index ?? list.length, 0, el);
  }

  function dropIntoColumn(colPath: number[], index?: number) {
    const d = drag.current;
    drag.current = null;
    setDropHint(null);
    if (!d) return;
    mutate((bs) => {
      if (d.kind === "new") {
        insertEl(bs, colPath, newEl(d.type), index);
        return;
      }
      const [sb, sr, sc, se] = d.path;
      let idx = index;
      // same-column move: removing the source first shifts later indexes down
      if (idx !== undefined && sb === colPath[0] && sr === colPath[1] && sc === colPath[2] && se < idx) idx--;
      const el = removeAt(bs, d.path);
      insertEl(bs, colPath, el, idx);
    });
    setSel(null);
  }

  async function save(status?: "published") {
    setBusy(true);
    setError(null);
    try {
      await api.updatePage(tenantHost, token, page.id as string, {
        layout: blocks,
        ...(status ? { status, publishedAt: new Date().toISOString() } : {}),
      });
      if (status) page.status = status;
      setDirty(false);
      setSavedAny(true);
      setMsg(status ? t("designer-published") : t("designer-saved"));
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Same sync-open pattern as PagesPanel.preview: window.open must happen in
  // direct response to the click or popup blockers eat it.
  async function preview() {
    const win = window.open("", "_blank", "noreferrer");
    try {
      if (dirty) await save();
      const previewToken =
        page.status === "published" ? undefined : await api.getPagePreviewToken(tenantHost, token, page.id as string);
      if (win) win.location.href = api.previewUrl(tenantHost, page.slug as string, previewToken);
    } catch (err) {
      win?.close();
      setError((err as Error).message);
    }
  }

  function close() {
    if (dirty && !confirm(t("designer-unsaved"))) return;
    onClose(savedAny);
  }

  // ---------- selection helpers ----------
  const selEq = (p: number[]) => sel !== null && sel.length === p.length && p.every((v, i) => sel[i] === v);
  const selCls = (p: number[]) =>
    selEq(p) ? "outline outline-2 outline-accent" : "outline outline-1 outline-transparent hover:outline-accent/30";

  function pick(e: React.MouseEvent, p: number[]) {
    e.stopPropagation();
    setSel(p);
  }

  // ---------- inspector ----------
  async function uploadImage(file: File, setValue: (v: string) => void) {
    setUploading(true);
    try {
      setValue(api.API_URL + (await api.uploadMedia(tenantHost, token, file)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
    const base =
      "w-full rounded-lg border border-line/30 bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-line";
    if (field.kind === "textarea")
      return <textarea rows={4} className={base} value={value} onChange={(e) => onChange(e.target.value)} />;
    if (field.kind === "select")
      return (
        <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    if (field.kind === "color")
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value || "#ffffff"}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-line/30"
          />
          <input className={base} value={value} placeholder="#" onChange={(e) => onChange(e.target.value)} />
          {value && (
            <button onClick={() => onChange("")} className="text-[10px] font-semibold text-sub hover:text-red-500">
              ✕
            </button>
          )}
        </div>
      );
    if (field.kind === "image")
      return (
        <div className="space-y-1.5">
          <input className={base} value={value} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
          <label className="inline-block cursor-pointer rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-ink hover:bg-[#e8e8ed]">
            {uploading ? t("designer-uploading") : t("designer-upload")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f, onChange);
              }}
            />
          </label>
          {value && <img src={value} alt="" className="h-16 rounded-lg object-cover" />}
        </div>
      );
    return <input className={base} value={value} onChange={(e) => onChange(e.target.value)} />;
  }

  function Inspector() {
    if (!sel || blocks[sel[0]]?.type !== "section") {
      return <p className="text-xs text-sub">{t("designer-none-selected")}</p>;
    }
    const [b, r, c, e] = sel;
    const sp = blocks[b].props as unknown as SectionProps;

    if (sel.length === 1) {
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-section")}</p>
          {SECTION_FIELDS.map((f) => (
            <label key={f.key} className="block text-[11px] font-medium text-body">
              {t(f.labelKey)}
              <div className="mt-1">
                <FieldInput
                  field={f}
                  value={((sp as unknown as Record<string, string>)[f.key] as string) ?? ""}
                  onChange={(v) => mutate((bs) => ((bs[b].props as Record<string, unknown>)[f.key] = v))}
                />
              </div>
            </label>
          ))}
        </div>
      );
    }
    if (sel.length === 3) {
      const col = sp.rows[r]?.columns[c];
      if (!col) return null;
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t("designer-column")}</p>
          <label className="block text-[11px] font-medium text-body">
            {t("designer-col-span")}: {col.span}
            <input
              type="range"
              min={1}
              max={6}
              value={col.span}
              className="mt-1 w-full accent-accent"
              onChange={(ev) => mutate((bs) => (section(bs, b).rows[r].columns[c].span = Number(ev.target.value)))}
            />
          </label>
          <button
            onClick={() => {
              mutate((bs) => {
                const row = section(bs, b).rows[r];
                row.columns.splice(c, 1);
                if (row.columns.length === 0) section(bs, b).rows.splice(r, 1);
              });
              setSel(null);
            }}
            className="flex items-center gap-1 text-[11px] font-semibold text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
          </button>
        </div>
      );
    }
    if (sel.length === 4) {
      const el = sp.rows[r]?.columns[c]?.elements[e];
      if (!el) return null;
      const def = ELS[el.type];
      return (
        <div className="space-y-3">
          <p className="text-xs font-bold text-ink">{t(def.labelKey)}</p>
          {def.fields.map((f) => (
            <label key={f.key} className="block text-[11px] font-medium text-body">
              {t(f.labelKey)}
              <div className="mt-1">
                <FieldInput
                  field={f}
                  value={el.props[f.key] ?? ""}
                  onChange={(v) => mutate((bs) => (section(bs, b).rows[r].columns[c].elements[e].props[f.key] = v))}
                />
              </div>
            </label>
          ))}
          <div className="flex gap-3">
            <button
              onClick={() =>
                mutate((bs) => {
                  const src = section(bs, b).rows[r].columns[c].elements[e];
                  section(bs, b).rows[r].columns[c].elements.splice(e + 1, 0, { ...clone(src), id: uid() });
                })
              }
              className="flex items-center gap-1 text-[11px] font-semibold text-accent"
            >
              <Copy className="h-3.5 w-3.5" /> {t("designer-duplicate")}
            </button>
            <button
              onClick={() => {
                mutate((bs) => {
                  removeAt(bs, sel);
                });
                setSel(null);
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("designer-delete")}
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  // ---------- canvas element preview (visual approximation of SectionBlock.astro) ----------
  function ElPreview({ el }: { el: El }) {
    const p = el.props;
    const align = { textAlign: (p.align as "left" | "center" | "right") ?? "left" };
    switch (el.type) {
      case "heading":
        return (
          <div style={{ ...align, fontSize: H_SIZE[p.level ?? "2"], fontWeight: 700, lineHeight: 1.2 }} className="font-display">
            {p.text || "Heading"}
          </div>
        );
      case "text":
        return (
          <div style={{ ...align, fontSize: TEXT_SIZE[p.size ?? "md"], whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
            {p.text || <span className="opacity-40">{t("designer-f-text")}…</span>}
          </div>
        );
      case "image":
        return p.src ? (
          <img src={p.src} alt={p.alt ?? ""} style={{ borderRadius: RADIUS[p.radius ?? "md"], maxWidth: "100%" }} />
        ) : (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line/50 bg-canvas/50 text-sub">
            <ImageIcon className="h-6 w-6" />
          </div>
        );
      case "button":
        return (
          <div style={align}>
            <span
              className="inline-block rounded-full px-5 py-2 text-sm font-semibold"
              style={
                p.variant === "outline"
                  ? { border: "2px solid currentColor" }
                  : { backgroundColor: "#0f62fe", color: "#fff" }
              }
            >
              {p.label || "Button"}
            </span>
          </div>
        );
      case "spacer":
        return <div style={{ height: SPACE[p.height ?? "md"] }} className="rounded border border-dashed border-line/30" />;
      case "divider":
        return <hr className="border-current opacity-20" />;
      case "embed":
        return (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-black/70 text-white">
            <Video className="mr-2 h-5 w-5" />
            <span className="max-w-[80%] truncate text-xs">{p.url || t("designer-f-url")}</span>
          </div>
        );
    }
  }

  // section/legacy-block level controls: move up/down, duplicate, delete
  function BlockControls({ b }: { b: number }) {
    return (
      <span className="flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>
        <button
          onClick={() => b > 0 && mutate((bs) => bs.splice(b - 1, 0, bs.splice(b, 1)[0]))}
          disabled={b === 0}
          className="px-0.5 font-bold text-accent disabled:opacity-30"
        >
          ↑
        </button>
        <button
          onClick={() => b < blocks.length - 1 && mutate((bs) => bs.splice(b + 1, 0, bs.splice(b, 1)[0]))}
          disabled={b === blocks.length - 1}
          className="px-0.5 font-bold text-accent disabled:opacity-30"
        >
          ↓
        </button>
        <button
          onClick={() => mutate((bs) => bs.splice(b + 1, 0, clone(bs[b])))}
          className="px-0.5 text-accent"
          title={t("designer-duplicate")}
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          onClick={() => {
            mutate((bs) => {
              bs.splice(b, 1);
            });
            setSel(null);
          }}
          className="px-0.5 text-red-500"
          title={t("designer-delete")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    );
  }

  // ---------- render ----------
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas font-sans text-ink antialiased">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-line/30 bg-white px-4 py-2.5">
        <span className="text-xs font-bold text-ink">
          {page.title as string} <span className="font-mono font-normal text-sub">/{page.slug as string}</span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            page.status === "published" && !dirty ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
          }`}
        >
          {dirty ? t("designer-dirty") : page.status === "published" ? t("pages-published") : t("pages-draft")}
        </span>
        {msg && <span className="text-[11px] font-semibold text-ok">{msg}</span>}
        {error && <span className="max-w-xs truncate text-[11px] text-red-600">{error}</span>}
        <span className="flex-1" />
        <button
          onClick={undo}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
          title="Ctrl+Z"
        >
          <Undo2 className="h-3.5 w-3.5" /> {t("designer-undo")}
        </button>
        <button
          onClick={() => void preview()}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-body hover:bg-canvas"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t("designer-preview")}
        </button>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-[#e8e8ed] disabled:opacity-50"
        >
          {busy ? t("designer-saving") : t("designer-save")}
        </button>
        <button
          onClick={() => void save("published")}
          disabled={busy}
          className="rounded-full bg-accent px-5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("designer-publish")}
        </button>
        <button onClick={close} className="rounded-full p-2 text-body hover:bg-canvas" title={t("designer-close")}>
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* palette */}
        <aside className="w-44 shrink-0 space-y-1.5 overflow-y-auto border-r border-line/30 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("designer-elements")}</p>
          {(Object.keys(ELS) as ElType[]).map((type) => {
            const Icon = ELS[type].icon;
            return (
              <div
                key={type}
                draggable
                onDragStart={(ev) => {
                  drag.current = { kind: "new", type };
                  ev.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() => (drag.current = null)}
                className="flex cursor-grab items-center gap-2 rounded-lg border border-line/30 bg-canvas/60 px-2.5 py-2 text-xs font-medium text-ink hover:border-accent/50 hover:bg-white active:cursor-grabbing"
              >
                <Icon className="h-3.5 w-3.5 text-accent" /> {t(ELS[type].labelKey)}
              </div>
            );
          })}
          <p className="pt-2 text-[10px] leading-relaxed text-sub">{t("designer-drop-hint")}</p>
        </aside>

        {/* canvas */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6" onClick={() => setSel(null)}>
          <div className="mx-auto max-w-4xl space-y-4">
            {blocks.length === 0 && <p className="py-10 text-center text-xs text-sub">{t("designer-empty")}</p>}
            {blocks.map((block, b) => {
              if (block.type !== "section") {
                // legacy block from the old BlockBuilder — still rendered by the
                // frontend; movable/deletable here, edited via the old editor.
                return (
                  <div
                    key={b}
                    className={`flex items-center justify-between rounded-xl border border-line/40 bg-white px-4 py-3 text-xs ${selCls([b])}`}
                    onClick={(ev) => pick(ev, [b])}
                  >
                    <span className="font-semibold text-sub">
                      {t("designer-legacy")}: {block.type}
                    </span>
                    <BlockControls b={b} />
                  </div>
                );
              }
              const sp = block.props as unknown as SectionProps;
              const contained = (sp.width ?? "contained") === "contained";
              return (
                <div key={b} className={`group relative rounded-xl ${selCls([b])}`} onClick={(ev) => pick(ev, [b])}>
                  <div className="absolute -top-3 left-3 z-10 hidden items-center gap-1 rounded-full border border-line/30 bg-white px-2 py-0.5 text-[10px] font-bold text-sub shadow-sm group-hover:flex">
                    {t("designer-section")} <BlockControls b={b} />
                  </div>
                  <div
                    className="overflow-hidden rounded-xl border border-line/20"
                    style={{
                      background: sp.bgImage ? `url(${sp.bgImage}) center/cover` : sp.bg || "#ffffff",
                      color: sp.textColor || "inherit",
                      padding: `${PAD[sp.paddingY ?? "md"]} 1.5rem`,
                    }}
                  >
                    <div className={contained ? "mx-auto max-w-3xl space-y-5" : "space-y-5"}>
                      {(sp.rows ?? []).map((row, r) => (
                        <div
                          key={r}
                          className="grid gap-4"
                          style={{ gridTemplateColumns: row.columns.map((cc) => `${cc.span}fr`).join(" ") }}
                        >
                          {row.columns.map((col, c) => (
                            <div
                              key={c}
                              className={`min-h-[3rem] space-y-3 rounded-lg p-1.5 transition-colors ${selCls([b, r, c])} ${
                                dropHint === `${b}.${r}.${c}` ? "bg-accent/10" : ""
                              }`}
                              onClick={(ev) => pick(ev, [b, r, c])}
                              onDragOver={(ev) => {
                                ev.preventDefault();
                                setDropHint(`${b}.${r}.${c}`);
                              }}
                              onDragLeave={() => setDropHint(null)}
                              onDrop={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                dropIntoColumn([b, r, c]);
                              }}
                            >
                              {col.elements.length === 0 && (
                                <div className="flex h-12 items-center justify-center rounded-lg border border-dashed border-line/40 text-[10px] font-medium text-sub">
                                  {t("designer-empty-col")}
                                </div>
                              )}
                              {col.elements.map((el, e) => (
                                <div
                                  key={el.id}
                                  draggable
                                  onDragStart={(ev) => {
                                    ev.stopPropagation();
                                    drag.current = { kind: "move", path: [b, r, c, e] };
                                    ev.dataTransfer.effectAllowed = "move";
                                  }}
                                  onDragEnd={() => (drag.current = null)}
                                  onDrop={(ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    dropIntoColumn([b, r, c], e);
                                  }}
                                  onDragOver={(ev) => ev.preventDefault()}
                                  onClick={(ev) => pick(ev, [b, r, c, e])}
                                  className={`relative cursor-grab rounded-lg p-1 ${selCls([b, r, c, e])}`}
                                >
                                  {selEq([b, r, c, e]) && (
                                    <GripVertical className="absolute -left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
                                  )}
                                  <ElPreview el={el} />
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ))}
                      {/* add-row presets */}
                      <div className="hidden items-center gap-1.5 pt-1 group-hover:flex" onClick={(ev) => ev.stopPropagation()}>
                        <span className="text-[10px] font-semibold text-sub">{t("designer-add-row")}:</span>
                        {ROW_PRESETS.map((preset, i) => (
                          <button
                            key={i}
                            onClick={() =>
                              mutate((bs) =>
                                section(bs, b).rows.push({ columns: preset.map((span) => ({ span, elements: [] })) }),
                              )
                            }
                            className="flex h-6 items-center gap-0.5 rounded border border-line/40 bg-white px-1.5 hover:border-accent"
                            title={preset.join(" : ")}
                          >
                            {preset.map((span, j) => (
                              <span key={j} className="h-3 rounded-sm bg-sub/40" style={{ width: `${span * 5}px` }} />
                            ))}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                mutate((bs) => bs.push(newSection()));
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line/50 bg-white/60 py-4 text-xs font-semibold text-body hover:border-accent hover:text-accent"
            >
              <Plus className="h-4 w-4" /> {t("designer-add-section")}
            </button>
          </div>
        </main>

        {/* inspector */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-line/30 bg-white p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t("designer-inspector")}</p>
          <Inspector />
        </aside>
      </div>
    </div>
  );
}
