import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Copy,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Languages,
  Layers,
  LayoutDashboard,
  LogOut,
  Newspaper,
  Search,
  UploadCloud,
  X,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  History,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Palette,
  Pencil,
  Quote,
  RotateCcw,
  Rss,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  Users as UsersIcon,
} from "lucide-react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import * as api from "@/lib/api";
import { slugify, oklchToHex, contrastRatio, bestTextColor } from "@/lib/utils";
import type { Session } from "@/lib/api";
import { dict, type Key, type Lang } from "@/i18n";
import Designer from "@/Designer";

const SESSION_KEY = "usim_cms_session";

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as Session;
  // Sessions cached before tenantHosts existed won't have it — log back in
  // to get a fresh one, but don't crash on the stale cached shape meanwhile.
  return { ...session, tenantHosts: session.tenantHosts ?? (session.tenantHost ? [session.tenantHost] : []) };
}

// ---------- i18n ----------
const I18nCtx = createContext<{ lang: Lang; t: (k: Key) => string }>({
  lang: "en",
  t: (k) => dict.en[k],
});
const useT = () => useContext(I18nCtx);

// ---------- shared styles (prototype look) ----------
const inputCls =
  "w-full rounded-lg border border-line/30 bg-canvas px-3 py-2 text-xs text-ink outline-none transition-all focus:border-line focus:bg-white";
const btnPrimary =
  "rounded-full bg-accent px-5 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-[#e8e8ed]";
const card = "rounded-xl border border-line/40 bg-white";

// ---------- Setup wizard (first-run only, see /api/setup) ----------
function SetupWizard({ onDone }: { onDone: (s: Session) => void }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.setup({
        email,
        password,
        host: host || undefined,
        departmentName: host ? departmentName : undefined,
      });
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onDone(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas font-sans text-ink antialiased">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line/30 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
            U
          </div>
          <div>
            <h1 className="font-display text-sm font-bold tracking-tight">{t("setup-title")}</h1>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
          </div>
        </div>
        <p className="text-xs text-sub">{t("setup-desc")}</p>
        <input
          className={inputCls}
          type="email"
          placeholder={t("login-email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder={t("login-password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <input
          className={inputCls}
          type="text"
          placeholder={t("setup-host")}
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        {host && (
          <input
            className={inputCls}
            type="text"
            placeholder={t("setup-department")}
            value={departmentName}
            onChange={(e) => setDepartmentName(e.target.value)}
            required
          />
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? t("setup-busy") : t("setup-submit")}
        </button>
      </form>
    </div>
  );
}

// ---------- Login ----------
function LoginForm({ onLogin }: { onLogin: (s: Session) => void }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(email, password);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onLogin(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas font-sans text-ink antialiased">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line/30 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
            U
          </div>
          <div>
            <h1 className="font-display text-sm font-bold tracking-tight">{t("login-title")}</h1>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
          </div>
        </div>
        <p className="text-xs text-sub">{t("login-desc")}</p>
        <input
          className={inputCls}
          type="email"
          placeholder={t("login-email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder={t("login-password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? t("login-busy") : t("login-submit")}
        </button>
      </form>
    </div>
  );
}

// ---------- Block builder (MVP: hero/text/image, up/down reorder) ----------
// ponytail: reorder via up/down buttons, not a drag lib — dnd-kit is the
// upgrade path if drag UX is actually wanted later.
interface Block {
  type: string;
  props: Record<string, string>;
}

const BLOCK_TYPES: Record<string, { label: string; fields: Array<{ key: string; label: string }> }> = {
  hero: {
    label: "Hero",
    fields: [
      { key: "title", label: "Title" },
      { key: "subtitle", label: "Subtitle" },
      { key: "imageUrl", label: "Image URL" },
    ],
  },
  text: {
    label: "Text",
    fields: [{ key: "content", label: "Content" }],
  },
  image: {
    label: "Image",
    fields: [
      { key: "imageUrl", label: "Image URL" },
      { key: "alt", label: "Alt text" },
    ],
  },
};

function BlockBuilder({
  page,
  tenantHost,
  token,
  onClose,
  onSaved,
}: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [blocks, setBlocks] = useState<Block[]>(() => (page.layout as Block[] | undefined) ?? []);
  const [addType, setAddType] = useState("hero");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addBlock() {
    setBlocks([...blocks, { type: addType, props: {} }]);
  }

  function removeBlock(i: number) {
    setBlocks(blocks.filter((_, idx) => idx !== i));
  }

  function moveBlock(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  }

  function setField(i: number, key: string, value: string) {
    const next = [...blocks];
    next[i] = { ...next[i], props: { ...next[i].props, [key]: value } };
    setBlocks(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updatePage(tenantHost, token, page.id as string, { layout: blocks });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line/20 bg-canvas/60 p-4">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {blocks.length === 0 && <p className="text-xs text-sub">{t("blocks-empty")}</p>}
      {blocks.map((block, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line/30 bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">{BLOCK_TYPES[block.type]?.label ?? block.type}</span>
            <div className="flex gap-2 text-[11px]">
              <button onClick={() => moveBlock(i, -1)} disabled={i === 0} className="font-semibold text-accent disabled:opacity-30">
                {t("blocks-up")}
              </button>
              <button
                onClick={() => moveBlock(i, 1)}
                disabled={i === blocks.length - 1}
                className="font-semibold text-accent disabled:opacity-30"
              >
                {t("blocks-down")}
              </button>
              <button onClick={() => removeBlock(i)} className="font-semibold text-red-500">
                {t("blocks-remove")}
              </button>
            </div>
          </div>
          {(BLOCK_TYPES[block.type]?.fields ?? []).map((f) => (
            <label key={f.key} className="block text-[11px] font-medium text-body">
              {f.label}
              <input
                className={`${inputCls} mt-1`}
                value={block.props[f.key] ?? ""}
                onChange={(e) => setField(i, f.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border border-line/30 bg-white px-2 py-1.5 text-xs outline-none"
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
        >
          {Object.entries(BLOCK_TYPES).map(([key, bt]) => (
            <option key={key} value={key}>
              {bt.label}
            </option>
          ))}
        </select>
        <button onClick={addBlock} className={btnGhost}>
          {t("blocks-add")}
        </button>
        <span className="flex-1" />
        <button onClick={onClose} className="px-2 py-1 text-xs text-body">
          {t("blocks-close")}
        </button>
        <button onClick={save} disabled={saving} className={btnPrimary}>
          {saving ? t("blocks-saving") : t("blocks-save")}
        </button>
      </div>
    </div>
  );
}

// ---------- Pages ----------
function PagesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [pages, setPages] = useState<Array<Record<string, unknown>>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [designPage, setDesignPage] = useState<Record<string, unknown> | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setPages(await api.getPages(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantHost]);

  // Quick-create: title only, straight into Designer — slug is auto-derived
  // (de-duplicated against existing slugs) and stays editable there
  // afterwards (see Designer.tsx's slug-rename field), not up front here.
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const base = slugify(trimmed) || "page";
    const existing = new Set(pages.map((p) => p.slug as string));
    let candidate = base;
    for (let n = 2; existing.has(candidate); n++) candidate = `${base}-${n}`;
    setCreating(true);
    try {
      const item = await api.createPage(tenantHost, token, { slug: candidate, title: trimmed });
      setTitle("");
      await refresh();
      setDesignPage(item);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  // Draft/published visibility toggle (RLS-enforced, see
  // migrations/0007_pages_status.sql) — distinct from share(), which copies
  // the page into the cross-department portal pool.
  async function setStatus(p: Record<string, unknown>, status: "draft" | "published") {
    try {
      await api.updatePage(tenantHost, token, p.id as string, {
        status,
        publishedAt: status === "published" ? new Date().toISOString() : null,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function share(id: string) {
    try {
      await api.sharePage(tenantHost, token, id);
      alert(t("pages-shared"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Draft only: a published page renders a plain <a href target="_blank">
  // instead (see the "View" link below) — a real anchor click is a genuine
  // browser navigation, so it can't hit the "window.open then redirect"
  // pattern's failure mode (some browsers let the blank tab open but then
  // silently block the follow-up script navigation, leaving a permanently
  // blank tab). A draft still needs an async-minted preview token before the
  // URL is known, so it has no choice but to open first, navigate after.
  async function preview(p: Record<string, unknown>) {
    const win = window.open("", "_blank", "noreferrer");
    if (!win) {
      setError(t("designer-preview-blocked"));
      return;
    }
    try {
      const previewToken = await api.getPagePreviewToken(tenantHost, token, p.id as string);
      win.location.href = api.previewUrl(tenantHost, p.slug as string, previewToken);
    } catch (err) {
      win.close();
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("pages-delete-confirm"))) return;
    try {
      await api.deletePage(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // "home" is the frontend's reserved slug for a tenant's root page (see
  // apps/frontend's [...slug].astro) — only one page may hold it at a time,
  // so making a new page home demotes whichever page currently has it. Also
  // force-publishes the new home page: RLS hides drafts from anonymous
  // visitors, so a draft home page would 404 the whole site.
  async function setHome(id: string) {
    try {
      const prevHome = pages.find((x) => x.slug === "home" && x.id !== id);
      if (prevHome) {
        await api.updatePage(tenantHost, token, prevHome.id as string, { slug: `home-${(prevHome.id as string).slice(0, 8)}` });
      }
      await api.updatePage(tenantHost, token, id, { slug: "home", status: "published", publishedAt: new Date().toISOString() });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <FileText className="h-4 w-4 text-accent" /> {t("pages-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className={`${card} flex gap-2 p-4`}>
        <input
          className={inputCls}
          placeholder={t("pages-name")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button type="submit" disabled={creating} className={`${btnPrimary} shrink-0`}>
          {creating ? t("pages-creating") : t("pages-create")}
        </button>
      </form>
      <ul className={`${card} divide-y divide-line/20`}>
        {pages.map((p) => {
          const published = p.status === "published";
          return (
          <li key={p.id as string} className="px-4 py-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="font-semibold text-ink">{p.title as string}</span>
                <span className="font-mono text-sub">/{p.slug as string}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    published ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
                  }`}
                >
                  {published ? t("pages-published") : t("pages-draft")}
                </span>
                {p.slug === "home" && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">{t("pages-is-home")}</span>
                )}
              </span>
              <span className="flex items-center gap-3">
                {published ? (
                  <a
                    href={api.previewUrl(tenantHost, p.slug as string)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-semibold text-body hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> {t("pages-view")}
                  </a>
                ) : (
                  <button
                    onClick={() => preview(p)}
                    className="flex items-center gap-1 font-semibold text-body hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> {t("pages-view")}
                  </button>
                )}
                {p.slug !== "home" && (
                  <button onClick={() => setHome(p.id as string)} className="font-semibold text-body hover:underline">
                    {t("pages-set-home")}
                  </button>
                )}
                <button
                  onClick={() => setDesignPage(p)}
                  className="flex items-center gap-1 font-semibold text-accent hover:underline"
                >
                  <Palette className="h-3.5 w-3.5" /> {t("pages-design")}
                </button>
                <button
                  onClick={() => setEditingId(editingId === (p.id as string) ? null : (p.id as string))}
                  className="font-semibold text-accent hover:underline"
                >
                  {editingId === p.id ? t("pages-close") : t("pages-edit")}
                </button>
                <button
                  onClick={() => setStatus(p, published ? "draft" : "published")}
                  className="font-semibold text-body hover:underline"
                >
                  {published ? t("pages-unpublish") : t("pages-publish")}
                </button>
                {published && (
                  <button onClick={() => share(p.id as string)} className="font-semibold text-body hover:underline">
                    {t("pages-share")}
                  </button>
                )}
                <button
                  onClick={() => remove(p.id as string)}
                  className="rounded p-1 text-red-500 hover:bg-red-50"
                  title={t("pages-delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
            {editingId === p.id && (
              <div className="mt-3">
                <BlockBuilder
                  page={p}
                  tenantHost={tenantHost}
                  token={token}
                  onClose={() => setEditingId(null)}
                  onSaved={async () => {
                    setEditingId(null);
                    await refresh();
                  }}
                />
              </div>
            )}
          </li>
          );
        })}
        {pages.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("pages-empty")}</li>}
      </ul>
      {designPage && (
        <Designer
          page={designPage}
          tenantHost={tenantHost}
          token={token}
          t={t}
          onClose={(saved) => {
            setDesignPage(null);
            if (saved) void refresh();
          }}
        />
      )}
    </section>
  );
}

// ---------- Rich-text toolbar (fixed bar, not just Notion-style slash/hover) ----------
// BlockNote's own selection popup + slash menu stay as-is (kept per request) —
// this adds a persistent bar above the editor for people used to a
// Word/Google Docs-style always-visible toolbar instead of "/"-commands.
function EditorToolbar({ editor }: { editor: ReturnType<typeof useCreateBlockNote> }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => editor.onSelectionChange(() => forceUpdate((n) => n + 1)), [editor]);

  const active = editor.getActiveStyles();
  const block = editor.getTextCursorPosition()?.block;

  const styleBtn = (icon: React.ReactNode, key: "bold" | "italic" | "underline" | "strike" | "code", title: string) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor.toggleStyles({ [key]: true })}
      className={`rounded p-1.5 hover:bg-canvas ${active[key] ? "bg-canvas text-accent" : "text-body"}`}
    >
      {icon}
    </button>
  );

  const blockBtn = (icon: React.ReactNode, type: string, props: Record<string, unknown>, title: string) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => block && editor.updateBlock(block, { type, props } as never)}
      className={`rounded p-1.5 hover:bg-canvas ${block?.type === type ? "bg-canvas text-accent" : "text-body"}`}
    >
      {icon}
    </button>
  );

  const alignBtn = (icon: React.ReactNode, alignment: "left" | "center" | "right", title: string) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => block && editor.updateBlock(block, { props: { textAlignment: alignment } } as never)}
      className={`rounded p-1.5 hover:bg-canvas ${(block?.props as Record<string, unknown>)?.textAlignment === alignment ? "bg-canvas text-accent" : "text-body"}`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 border-line/30 bg-canvas/40 p-1.5">
      {styleBtn(<Bold className="h-3.5 w-3.5" />, "bold", "Bold")}
      {styleBtn(<Italic className="h-3.5 w-3.5" />, "italic", "Italic")}
      {styleBtn(<Underline className="h-3.5 w-3.5" />, "underline", "Underline")}
      {styleBtn(<Strikethrough className="h-3.5 w-3.5" />, "strike", "Strikethrough")}
      {styleBtn(<Code className="h-3.5 w-3.5" />, "code", "Code")}
      <span className="mx-1 h-4 w-px bg-line/30" />
      {blockBtn(<Heading1 className="h-3.5 w-3.5" />, "heading", { level: 1 }, "Heading 1")}
      {blockBtn(<Heading2 className="h-3.5 w-3.5" />, "heading", { level: 2 }, "Heading 2")}
      {blockBtn(<Heading3 className="h-3.5 w-3.5" />, "heading", { level: 3 }, "Heading 3")}
      {blockBtn(<Quote className="h-3.5 w-3.5" />, "quote", {}, "Quote")}
      <span className="mx-1 h-4 w-px bg-line/30" />
      {blockBtn(<List className="h-3.5 w-3.5" />, "bulletListItem", {}, "Bullet list")}
      {blockBtn(<ListOrdered className="h-3.5 w-3.5" />, "numberedListItem", {}, "Numbered list")}
      {blockBtn(<ListChecks className="h-3.5 w-3.5" />, "checkListItem", {}, "Checklist")}
      <span className="mx-1 h-4 w-px bg-line/30" />
      {alignBtn(<AlignLeft className="h-3.5 w-3.5" />, "left", "Align left")}
      {alignBtn(<AlignCenter className="h-3.5 w-3.5" />, "center", "Align center")}
      {alignBtn(<AlignRight className="h-3.5 w-3.5" />, "right", "Align right")}
      <span className="mx-1 h-4 w-px bg-line/30" />
      <button
        type="button"
        title="Link"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const url = window.prompt("URL:");
          if (url) editor.createLink(url);
        }}
        className="rounded p-1.5 text-body hover:bg-canvas"
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------- Posts (rich-text articles) ----------
type PostStatus = "draft" | "published" | "private";

// Revision history + restore — a small, self-contained panel so PostEditor
// itself doesn't have to hold the revisions list in state unless the admin
// actually opens it (avoids an extra request on every edit-open).
function PostHistory({
  tenantHost,
  token,
  postId,
  onRestored,
}: {
  tenantHost: string;
  token: string;
  postId: string;
  onRestored: () => void;
}) {
  const { t } = useT();
  const [revisions, setRevisions] = useState<api.PostRevision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listPostRevisions(tenantHost, token, postId)
      .then(setRevisions)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoaded(true));
  }, [postId]);

  async function restore(revisionId: string) {
    if (!confirm(t("posts-restore-confirm"))) return;
    try {
      await api.restorePostRevision(tenantHost, token, postId, revisionId);
      onRestored();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-line/30 bg-canvas/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <History className="h-3.5 w-3.5" /> {t("posts-history")}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {loaded && revisions.length === 0 && <p className="text-[11px] text-sub">{t("posts-history-empty")}</p>}
      <ul className="divide-y divide-line/20">
        {revisions.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-sub">
              {new Date(r.createdAt).toLocaleString()} · {r.title}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                r.status === "private" ? "bg-violet-500/10 text-violet-700" : "bg-ok/10 text-ok"
              }`}
            >
              {r.status === "private" ? t("posts-private") : t("posts-published")}
            </span>
            <button
              onClick={() => void restore(r.id)}
              className="flex items-center gap-1 font-semibold text-accent hover:underline"
            >
              <RotateCcw className="h-3 w-3" /> {t("posts-restore")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PostEditor({
  post,
  tenantHost,
  token,
  categoryOptions,
  onSaved,
  onClose,
}: {
  post: Record<string, unknown>;
  tenantHost: string;
  token: string;
  categoryOptions: string[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState(post.title as string);
  const [excerpt, setExcerpt] = useState((post.excerpt as string | null) ?? "");
  const [category, setCategory] = useState((post.category as string | null) ?? "");
  const [tagsInput, setTagsInput] = useState(((post.tags as string[] | null) ?? []).join(", "));
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useCreateBlockNote({
    uploadFile: async (file: File) => {
      const url = await api.uploadMedia(tenantHost, token, file);
      // local driver returns a relative /uploads/... path — make it absolute
      // so it renders in the editor and on the public site
      return url.startsWith("http") ? url : api.API_URL + url;
    },
  });

  useEffect(() => {
    const blocks = editor.tryParseHTMLToBlocks((post.body as string) || "");
    editor.replaceBlocks(editor.document, blocks);
  }, [editor]);

  async function save() {
    setSaving(true);
    try {
      const tags = [...new Set(tagsInput.split(",").map((s) => s.trim()).filter(Boolean))];
      await api.updatePost(tenantHost, token, post.id as string, {
        title,
        excerpt,
        category: category.trim() || null,
        tags,
        body: await editor.blocksToHTMLLossy(editor.document),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line/30 bg-canvas/40 p-4">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {(post.authorEmail as string | null) && (
        <p className="text-[11px] text-sub">
          {t("posts-author")}: {post.authorEmail as string}
        </p>
      )}
      <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className={inputCls} placeholder={t("posts-excerpt")} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
      <div className="flex gap-2">
        <input
          className={inputCls}
          list="post-category-options"
          placeholder={t("posts-category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <datalist id="post-category-options">
          {categoryOptions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <input
          className={inputCls}
          placeholder={t("posts-tags")}
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
        />
      </div>
      <div>
        <EditorToolbar editor={editor} />
        <div className="rounded-b-lg border border-line/30 bg-white py-2 [&_.bn-editor]:min-h-[240px]">
          <BlockNoteView editor={editor} theme="light" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className={btnPrimary}>
          {saving ? t("blocks-saving") : t("posts-save")}
        </button>
        <button onClick={onClose} className={btnGhost}>
          {t("posts-close")}
        </button>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-sub hover:bg-canvas"
        >
          <History className="h-3.5 w-3.5" /> {t("posts-history")}
        </button>
      </div>
      {showHistory && (
        <PostHistory tenantHost={tenantHost} token={token} postId={post.id as string} onRestored={onSaved} />
      )}
    </div>
  );
}

function PostsPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setPosts(await api.getPosts(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantHost]);

  // Quick-create: title only, straight into the writing view — slug is
  // auto-derived (de-duplicated against existing slugs), same pattern as
  // PagesPanel's quick-create (slug stays editable later via the same
  // pattern, if ever needed — not exposed yet since posts have no
  // Designer-equivalent slug-rename field today).
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const base = slugify(trimmed) || "post";
    const existing = new Set(posts.map((p) => p.slug as string));
    let candidate = base;
    for (let n = 2; existing.has(candidate); n++) candidate = `${base}-${n}`;
    setCreating(true);
    try {
      const item = await api.createPost(tenantHost, token, { slug: candidate, title: trimmed });
      setTitle("");
      await refresh();
      setEditingId(item.id as string);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(p: Record<string, unknown>, status: PostStatus) {
    try {
      await api.updatePost(tenantHost, token, p.id as string, {
        status,
        publishedAt: status === "draft" ? null : new Date().toISOString(),
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function share(id: string) {
    try {
      await api.sharePost(tenantHost, token, id);
      alert(t("posts-shared"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("posts-delete-confirm"))) return;
    try {
      await api.deletePost(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const categoryOptions = useMemo(
    () => [...new Set(posts.map((p) => p.category as string | null).filter((c): c is string => Boolean(c)))],
    [posts],
  );

  const statusBadge: Record<PostStatus, string> = {
    draft: "bg-warn/10 text-warn",
    published: "bg-ok/10 text-ok",
    private: "bg-violet-500/10 text-violet-700",
  };
  const statusLabelKey: Record<PostStatus, Key> = {
    draft: "posts-draft",
    published: "posts-published",
    private: "posts-private",
  };
  // Whichever states aren't the post's current one, offered as one-click
  // transitions — draft/published/private form a triangle, not a toggle.
  const otherStatuses = (current: PostStatus): PostStatus[] =>
    (["draft", "published", "private"] as PostStatus[]).filter((s) => s !== current);
  const statusActionKey: Record<PostStatus, Key> = {
    draft: "posts-set-draft",
    published: "posts-publish",
    private: "posts-make-private",
  };

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Newspaper className="h-4 w-4 text-accent" /> {t("posts-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className={`${card} flex gap-2 p-4`}>
        <input className={inputCls} placeholder={t("pages-name")} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <button type="submit" disabled={creating} className={`${btnPrimary} shrink-0`}>
          {creating ? t("pages-creating") : t("posts-create")}
        </button>
      </form>
      <ul className={`${card} divide-y divide-line/20`}>
        {posts.map((p) => {
          const status = (p.status as PostStatus) || "draft";
          return (
            <li key={p.id as string} className="px-4 py-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{p.title as string}</span>
                  <span className="font-mono text-sub">/posts/{p.slug as string}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadge[status]}`}>
                    {t(statusLabelKey[status])}
                  </span>
                  {(p.category as string | null) && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                      {p.category as string}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <button
                    onClick={() => setEditingId(editingId === (p.id as string) ? null : (p.id as string))}
                    className="font-semibold text-accent hover:underline"
                  >
                    {editingId === p.id ? t("posts-close") : t("posts-edit")}
                  </button>
                  {otherStatuses(status).map((s) => (
                    <button
                      key={s}
                      onClick={() => void setStatus(p, s)}
                      className="font-semibold text-body hover:underline"
                    >
                      {t(statusActionKey[s])}
                    </button>
                  ))}
                  {status === "published" && (
                    <button onClick={() => share(p.id as string)} className="font-semibold text-body hover:underline">
                      {t("posts-share")}
                    </button>
                  )}
                  <button onClick={() => remove(p.id as string)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("pages-delete")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </div>
              {editingId === p.id && (
                <div className="mt-3">
                  <PostEditor
                    key={p.id as string}
                    post={p}
                    tenantHost={tenantHost}
                    token={token}
                    categoryOptions={categoryOptions}
                    onClose={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null);
                      await refresh();
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
        {posts.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("posts-empty")}</li>}
      </ul>
    </section>
  );
}

// ---------- Media library ----------
function MediaManager({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [folders, setFolders] = useState<Array<Record<string, unknown>>>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null); // null = root (all folders + unfiled)
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ originalName: "", altText: "", description: "", folderId: "" });
  const [error, setError] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");

  async function refreshFolders() {
    try {
      setFolders(await api.listMediaFolders(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function refreshItems() {
    try {
      // Fetch the whole library once — folder counts and the root/folder
      // views below are all derived client-side from this one list.
      setItems(await api.listMedia(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refreshFolders();
    void refreshItems();
  }, [tenantHost]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of items) {
      const fid = m.folderId as string | null;
      if (fid) counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    // A query searches the whole library, not just the open folder — a
    // folder-scoped filter would hide matches that live elsewhere and look
    // like search is broken.
    return items
      .filter((m) => q || ((m.folderId as string | null) ?? null) === activeFolder)
      .filter((m) => !q || (m.originalName as string).toLowerCase().includes(q));
  }, [items, activeFolder, search]);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        await api.uploadMedia(tenantHost, token, file, activeFolder);
      }
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) await uploadFiles(e.target.files);
    e.target.value = "";
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    await uploadFiles(e.dataTransfer.files);
  }

  async function copyUrl(m: Record<string, unknown>) {
    await navigator.clipboard.writeText(api.API_URL + (m.url as string));
    setCopiedId(m.id as string);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === visibleItems.length ? new Set() : new Set(visibleItems.map((m) => m.id as string)),
    );
  }

  async function remove(id: string) {
    if (!confirm(t("media-delete-confirm"))) return;
    try {
      await api.deleteMedia(tenantHost, token, id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function bulkDelete() {
    if (!confirm(t("media-bulk-delete-confirm"))) return;
    try {
      for (const id of selected) await api.deleteMedia(tenantHost, token, id);
      setSelected(new Set());
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addFolder() {
    if (!newFolderName.trim()) return;
    try {
      await api.createMediaFolder(tenantHost, token, newFolderName.trim());
      setNewFolderName("");
      setAddingFolder(false);
      await refreshFolders();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function renameFolder(f: Record<string, unknown>) {
    if (!editingFolderName.trim()) return;
    try {
      await api.renameMediaFolder(tenantHost, token, f.id as string, editingFolderName.trim());
      setEditingFolderId(null);
      await refreshFolders();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeFolder(id: string) {
    if (!confirm(t("media-delete-folder-confirm"))) return;
    try {
      await api.deleteMediaFolder(tenantHost, token, id);
      if (activeFolder === id) setActiveFolder(null);
      await refreshFolders();
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit(m: Record<string, unknown>) {
    setEditingId(m.id as string);
    setEditForm({
      originalName: (m.originalName as string) ?? "",
      altText: (m.altText as string) ?? "",
      description: (m.description as string) ?? "",
      folderId: (m.folderId as string) ?? "",
    });
  }

  async function saveEdit(id: string) {
    try {
      await api.updateMedia(tenantHost, token, id, {
        originalName: editForm.originalName,
        altText: editForm.altText || null,
        description: editForm.description || null,
        folderId: editForm.folderId || null,
      });
      setEditingId(null);
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const activeFolderName = activeFolder ? (folders.find((f) => f.id === activeFolder)?.name as string | undefined) : null;

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <ImageIcon className="h-4 w-4 text-accent" /> {t("media-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setActiveFolder(null)}
            className={activeFolder === null ? "font-semibold text-ink" : "text-sub hover:text-ink"}
          >
            {t("media-all-files")}
          </button>
          {activeFolderName && (
            <>
              <ChevronRight className="h-3 w-3 text-sub" />
              <span className="font-semibold text-ink">{activeFolderName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sub" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("media-search-placeholder")}
              className={`${inputCls} py-1.5 pl-8`}
            />
          </div>
          {addingFolder ? (
            <div className="flex items-center gap-1.5">
              <input
                className="rounded border border-line/30 px-1.5 py-1 text-xs outline-none"
                placeholder={t("media-new-folder-prompt")}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addFolder();
                  if (e.key === "Escape") setAddingFolder(false);
                }}
                autoFocus
              />
              <button onClick={addFolder} className="text-xs font-semibold text-accent hover:underline">
                {t("media-save")}
              </button>
              <button onClick={() => setAddingFolder(false)} className="text-xs text-sub hover:underline">
                {t("media-cancel")}
              </button>
            </div>
          ) : (
            <button onClick={() => setAddingFolder(true)} className={btnGhost}>
              + {t("media-new-folder")}
            </button>
          )}
        </div>
      </div>

      {activeFolder === null && !search.trim() && folders.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sub">{t("media-folders-heading")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {folders.map((f) => (
              <div
                key={f.id as string}
                onClick={() => setActiveFolder(f.id as string)}
                className={`${card} group flex cursor-pointer flex-col gap-2 p-3 transition-colors hover:border-accent/50`}
              >
                <div className="flex items-start justify-between">
                  <Folder className="h-7 w-7 text-accent/70" />
                  {editingFolderId !== f.id && (
                    <div className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingFolderId(f.id as string);
                          setEditingFolderName(f.name as string);
                        }}
                        className="rounded p-1 text-sub hover:bg-canvas"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => removeFolder(f.id as string)} className="rounded p-1 text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                {editingFolderId === f.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="w-full rounded border border-line/30 px-1.5 py-0.5 text-xs outline-none"
                      value={editingFolderName}
                      onChange={(e) => setEditingFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void renameFolder(f);
                        if (e.key === "Escape") setEditingFolderId(null);
                      }}
                      autoFocus
                    />
                    <button onClick={() => renameFolder(f)} className="text-[10px] font-semibold text-accent hover:underline">
                      {t("media-save")}
                    </button>
                    <button onClick={() => setEditingFolderId(null)} className="text-[10px] text-sub hover:underline">
                      {t("media-cancel")}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="truncate text-xs font-semibold text-ink">{f.name as string}</p>
                    <p className="text-[10px] text-sub">
                      {folderCounts.get(f.id as string) ?? 0} {t("media-items-suffix")}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sub">{t("media-assets-heading")}</p>

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            dragOver ? "border-accent bg-accent/5" : "border-line/50 hover:border-accent/50"
          }`}
        >
          <UploadCloud className="h-6 w-6 text-accent" />
          <p className="text-xs font-medium text-ink">{uploading ? t("uploading") : t("media-dropzone-title")}</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={onFileChosen}
          />
        </div>

        {visibleItems.length > 0 && (
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5 text-sub">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === visibleItems.length}
                onChange={toggleSelectAll}
              />
              {selected.size > 0 ? `${selected.size} ${t("media-selected-suffix")}` : t("media-select-all")}
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-3">
                <button onClick={() => setSelected(new Set())} className="flex items-center gap-1 text-sub hover:text-ink">
                  <X className="h-3 w-3" /> {t("media-clear-selection")}
                </button>
                <button onClick={bulkDelete} className="font-semibold text-red-600 hover:underline">
                  {t("media-bulk-delete")}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {visibleItems.map((m) => (
            <div key={m.id as string} className={`${card} group relative overflow-hidden`}>
              <input
                type="checkbox"
                checked={selected.has(m.id as string)}
                onChange={() => toggleSelect(m.id as string)}
                className="absolute left-1.5 top-1.5 z-10 h-3.5 w-3.5"
              />
              <img
                src={api.API_URL + (m.url as string)}
                alt={(m.altText as string) || (m.originalName as string)}
                className="h-24 w-full object-cover"
              />
              {editingId === m.id ? (
                <div className="space-y-1.5 p-2">
                  <input
                    className="w-full rounded border border-line px-1.5 py-1 text-[10px]"
                    placeholder={t("media-name-label")}
                    value={editForm.originalName}
                    onChange={(e) => setEditForm({ ...editForm, originalName: e.target.value })}
                  />
                  <input
                    className="w-full rounded border border-line px-1.5 py-1 text-[10px]"
                    placeholder={t("media-alt-label")}
                    value={editForm.altText}
                    onChange={(e) => setEditForm({ ...editForm, altText: e.target.value })}
                  />
                  <textarea
                    className="w-full rounded border border-line px-1.5 py-1 text-[10px]"
                    placeholder={t("media-description-label")}
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                  <select
                    className="w-full rounded border border-line px-1.5 py-1 text-[10px]"
                    value={editForm.folderId}
                    onChange={(e) => setEditForm({ ...editForm, folderId: e.target.value })}
                  >
                    <option value="">{t("media-all-files")}</option>
                    {folders.map((f) => (
                      <option key={f.id as string} value={f.id as string}>
                        {f.name as string}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className="text-[10px] text-sub hover:underline">
                      {t("media-cancel")}
                    </button>
                    <button onClick={() => saveEdit(m.id as string)} className="text-[10px] font-semibold text-accent hover:underline">
                      {t("media-save")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 p-2">
                  <p className="truncate text-[10px] font-medium text-ink" title={m.originalName as string}>
                    {m.originalName as string}
                  </p>
                  <p className="text-[10px] text-sub">
                    {Math.max(1, Math.round((m.sizeBytes as number) / 1024))} KB ·{" "}
                    {new Date(m.createdAt as string).toLocaleDateString()}
                  </p>
                  <div className="flex items-center justify-between">
                    <button onClick={() => copyUrl(m)} className="text-[10px] font-semibold text-accent hover:underline">
                      {copiedId === m.id ? t("media-copied") : t("media-copy")}
                    </button>
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(m)} className="rounded p-1 text-sub hover:bg-canvas">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(m.id as string)} className="rounded p-1 text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {visibleItems.length === 0 && <p className="text-xs text-sub">{t("media-empty")}</p>}
      </div>
    </section>
  );
}

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

// Curated, not exhaustive — a scrollable/typeable starting list (the field
// still accepts any Google Font name typed by hand, curated or not).
const GOOGLE_FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway",
  "Playfair Display", "Merriweather", "Oswald", "Source Sans Pro", "PT Sans", "Ubuntu", "Rubik",
  "Work Sans", "Fira Sans", "Noto Sans", "Quicksand", "Josefin Sans", "Karla", "Mulish",
  "DM Sans", "Barlow", "Manrope", "Space Grotesk", "Outfit", "Plus Jakarta Sans",
  "Libre Baskerville", "Crimson Text", "Cormorant Garamond", "Bitter", "Domine", "Lora",
  "EB Garamond", "Vollkorn", "Zilla Slab", "IBM Plex Sans", "IBM Plex Serif", "Archivo",
  "Heebo", "Hind", "Titillium Web", "Cabin", "Dosis", "Comfortaa", "Pacifico", "Caveat",
  "Dancing Script", "Lobster", "Bebas Neue", "Anton", "Abril Fatface", "Righteous",
  "Permanent Marker", "Shadows Into Light", "Amatic SC", "Indie Flower",
];

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

function ThemeForm({
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
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("");
  const [textColor, setTextColor] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [headingFont, setHeadingFont] = useState("");
  const [subHeadingFont, setSubHeadingFont] = useState("");
  const [postTitleFont, setPostTitleFont] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<api.ThemePreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const currentColors = () => ({
    primaryColor,
    secondaryColor,
    backgroundColor,
    textColor,
    fontFamily,
    headingFont,
    subHeadingFont,
    postTitleFont,
    logoUrl,
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
      setLogoUrl(th.logoUrl ?? "");
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
    setLogoUrl(p.settings.logoUrl ?? "");
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
      logoUrl: "",
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

  // design.md export/import — a small YAML-frontmatter-flavored text file,
  // just the 6 known theme keys, human-readable and diffable, no library
  // needed to read or write it.
  function downloadDesignMd() {
    const colors = currentColors();
    const lines = [
      "---",
      `name: ${presetName.trim() || title}`,
      ...Object.entries(colors).map(([k, v]) => `${k}: ${v}`),
      "---",
      "",
      "# Design",
      "",
      "Generated by USIM CMS's Theme panel. Upload this file back into any site's",
      "Theme panel to preview or apply these settings.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(presetName.trim() || title)}.design.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
      setPrimaryColor(parsed.primaryColor ?? primaryColor);
      setSecondaryColor(parsed.secondaryColor ?? secondaryColor);
      setBackgroundColor(parsed.backgroundColor ?? backgroundColor);
      setTextColor(parsed.textColor ?? textColor);
      setFontFamily(parsed.fontFamily ?? fontFamily);
      setHeadingFont(parsed.headingFont ?? headingFont);
      setSubHeadingFont(parsed.subHeadingFont ?? subHeadingFont);
      setPostTitleFont(parsed.postTitleFont ?? postTitleFont);
      setLogoUrl(parsed.logoUrl ?? logoUrl);
      if (parsed.name) setPresetName(parsed.name);
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
      await save({
        primaryColor,
        secondaryColor,
        backgroundColor,
        textColor,
        fontFamily,
        headingFont,
        subHeadingFont,
        postTitleFont,
        logoUrl,
      });
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

  const colorField = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="block text-xs font-medium text-body">
      {label}
      <input
        type="color"
        className="mt-1 block h-9 w-16 cursor-pointer rounded border border-line/30"
        value={value || "#000000"}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Palette className="h-4 w-4 text-accent" /> {title}
      </h2>
      {desc && <p className="text-xs text-sub">{desc}</p>}
      <div className="flex flex-wrap items-start gap-4">
        <form onSubmit={submit} className={`${card} max-w-sm space-y-3 p-4`}>
          <div>
            <p className="mb-1 text-xs font-medium text-body">{t("theme-presets")}</p>
            <div className="flex flex-wrap gap-1.5">
              {THEME_PRESETS.map((p, i) => {
                const colors = presetToColors(p);
                return (
                  <button
                    key={p.name}
                    type="button"
                    title={`${t("theme-presets")} ${i + 1}`}
                    onClick={() => applyPalette(colors)}
                    className="h-7 w-7 overflow-hidden rounded-full border border-line/30"
                    style={{ background: `linear-gradient(135deg, ${colors.primaryColor} 50%, ${colors.secondaryColor} 50%)` }}
                  />
                );
              })}
              <button
                type="button"
                title={t("theme-generate")}
                onClick={() => applyPalette(randomTheme())}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-line/50 text-sub hover:border-accent hover:text-accent"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {colorField(t("theme-primary"), primaryColor, setPrimaryColor)}
            {colorField(t("theme-secondary"), secondaryColor, setSecondaryColor)}
            {colorField(t("theme-background"), backgroundColor, setBackgroundColor)}
            {colorField(t("theme-text"), textColor, setTextColor)}
          </div>
          <div className="space-y-2">
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
            <FontField label={t("theme-font-subheading")} value={subHeadingFont} onChange={setSubHeadingFont} placeholder="Poppins" />
            {sameFontNote(subHeadingFont, headingFont)}
            <FontField label={t("theme-font-posttitle")} value={postTitleFont} onChange={setPostTitleFont} placeholder="Poppins" />
            {sameFontNote(postTitleFont, headingFont)}
            <FontField label={t("theme-font-body")} value={fontFamily} onChange={setFontFamily} placeholder="Inter" />
          </div>
          <label className="block text-xs font-medium text-body">
            {t("theme-logo")}
            <input className={`${inputCls} mt-1`} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          </label>
          <button type="submit" className={btnPrimary}>
            {t("theme-save")}
          </button>
          {saved && <span className="ml-2 text-xs font-semibold text-ok">{t("theme-saved")}</span>}
          {error && <p className="text-xs text-red-600">{error}</p>}
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
            <p className="text-sm font-semibold opacity-80" style={{ fontFamily: postTitleFont || undefined }}>
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
        </div>
      </div>

      {/* "My collection" — personal favourites, not tied to any one site;
          Test loads a preset into the form/preview without saving, Activate
          loads it and saves immediately. */}
      <div className={`${card} max-w-3xl space-y-2 p-4`}>
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
              <button onClick={() => testPreset(p)} className="font-semibold text-body hover:underline">
                {t("theme-preset-test")}
              </button>
              <button onClick={() => void activatePreset(p)} className="font-semibold text-accent hover:underline">
                {t("theme-preset-activate")}
              </button>
              <button
                onClick={() => {
                  setPresetName(p.name);
                  loadPreset(p);
                  downloadDesignMd();
                }}
                className="font-semibold text-body hover:underline"
              >
                {t("theme-file-download")}
              </button>
              <button onClick={() => void deletePreset(p.id)} className="text-red-500 hover:text-red-700" title={t("theme-preset-delete")}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>

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

// ---------- Tenants (Multisite) ----------
// Staging tenants are createTenant'd with this exact department-name suffix
// (see CloneBox's stage action) — no separate DB column, so this is the one
// place that decides "is this a staging preview, not a real site".
const isStagingTenant = (tn: Record<string, unknown>) => (tn.departmentName as string).endsWith("(Staging)");

function TenantsPanel({ token }: { token: string }) {
  const { t } = useT();
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [host, setHost] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [manageHost, setManageHost] = useState<string | null>(null);

  async function refresh() {
    setTenants(await api.listPortalTenants(token));
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPortalTenant(token, host, departmentName);
      setHost("");
      setDepartmentName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const managed = tenants.find((tn) => tn.host === manageHost);
  if (managed) {
    const staging = isStagingTenant(managed);
    return (
      <section className="space-y-4">
        <button onClick={() => setManageHost(null)} className="flex items-center gap-1 text-xs font-semibold text-sub hover:text-ink">
          <ChevronRight className="h-3.5 w-3.5 rotate-180" /> {t("tenants-back")}
        </button>
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
          <Globe className="h-4 w-4 text-accent" /> {t("tenants-manage-title")}: {managed.departmentName as string}
        </h2>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {msg && <p className="text-xs text-green-700">{msg}</p>}
        <div className={`${card} space-y-2 p-5`}>
          <p className="font-mono text-xs text-sub">{managed.host as string}</p>
          <p className="text-xs text-sub">
            {staging ? (
              <span className="font-semibold text-amber-700">{t("tenants-clone-staging-tag")} · {t("tenants-preview-only")}</span>
            ) : managed.active ? (
              <span className="text-ok">Aktif</span>
            ) : (
              <span className="text-sub">{t("tenants-suspended")}</span>
            )}
          </p>
          <a
            href={api.previewUrl(managed.host as string, "home")}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btnGhost} inline-flex items-center gap-1.5`}
          >
            <ExternalLink className="h-3.5 w-3.5" /> {t("tenants-view")}
          </a>
        </div>
        {!staging && <CloneBox token={token} sourceHost={managed.host as string} onNewSite={refresh} />}
        <DangerZone
          token={token}
          host={managed.host as string}
          onDeleted={() => {
            setManageHost(null);
            void refresh();
          }}
        />
      </section>
    );
  }

  const stagingTenants = tenants.filter(isStagingTenant);
  const liveTenants = tenants.filter((tn) => !isStagingTenant(tn));

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Globe className="h-4 w-4 text-accent" /> {t("tenants-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
        <input className={inputCls} placeholder={t("tenants-host")} value={host} onChange={(e) => setHost(e.target.value)} required />
        <input
          className={inputCls}
          placeholder={t("tenants-name")}
          value={departmentName}
          onChange={(e) => setDepartmentName(e.target.value)}
          required
        />
        <button type="submit" className={`${btnPrimary} shrink-0`}>
          {t("tenants-register")}
        </button>
      </form>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {liveTenants.map((tn) => (
          <TenantCard key={tn.id as string} tn={tn} staging={false} onManage={() => setManageHost(tn.host as string)} />
        ))}
      </div>
      {stagingTenants.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {t("tenants-staging-section")}
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stagingTenants.map((tn) => (
              <TenantCard key={tn.id as string} tn={tn} staging onManage={() => setManageHost(tn.host as string)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TenantCard({
  tn,
  staging,
  onManage,
}: {
  tn: Record<string, unknown>;
  staging: boolean;
  onManage: () => void;
}) {
  const { t } = useT();
  return (
    <div className={`${card} p-5 ${staging ? "border-amber-300 bg-amber-50/60" : ""}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className={`rounded-lg p-2 ${staging ? "bg-amber-500/10 text-amber-600" : "bg-accent/5 text-accent"}`}>
          <Globe className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-1.5">
          {staging ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              {t("tenants-clone-staging-tag")} · {t("tenants-preview-only")}
            </span>
          ) : tn.active ? (
            <span className="flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-bold text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Aktif
            </span>
          ) : (
            <span className="rounded-full bg-sub/10 px-2 py-0.5 text-[10px] font-bold text-sub">{t("tenants-suspended")}</span>
          )}
        </div>
      </div>
      <h3 className="text-sm font-semibold leading-snug text-ink">{tn.departmentName as string}</h3>
      <p className="mt-1 truncate font-mono text-xs text-sub">{tn.host as string}</p>
      <div className="mt-4 flex items-center gap-2">
        <a
          href={api.previewUrl(tn.host as string, "home")}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btnGhost} flex-1 justify-center inline-flex items-center gap-1.5 py-1.5`}
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t("tenants-view")}
        </a>
        <button
          onClick={onManage}
          className={`${btnPrimary} flex-1 justify-center inline-flex items-center gap-1.5 px-3 py-1.5`}
        >
          <SettingsIcon className="h-3.5 w-3.5" /> {t("tenants-manage")}
        </button>
      </div>
    </div>
  );
}

// ---------- Danger Zone (delete site, type-to-confirm) ----------
function DangerZone({ token, host, onDeleted }: { token: string; host: string; onDeleted: () => void }) {
  const { t } = useT();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setError(null);
    setBusy(true);
    try {
      await api.deletePortalTenant(token, host, confirmText);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-300 bg-red-50/60 p-5">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-700">
        <Trash2 className="h-3.5 w-3.5" /> {t("tenants-danger-zone")}
      </h3>
      <p className="text-xs text-red-700/80">{t("tenants-danger-desc")}</p>
      <p className="text-xs text-red-700">
        {t("tenants-danger-confirm-label")} <code className="rounded bg-red-100 px-1 font-mono">{host}</code>
      </p>
      <input
        className={`${inputCls} border-red-300`}
        placeholder={host}
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        disabled={confirmText !== host || busy}
        onClick={() => void del()}
        className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" /> {busy ? t("settings-busy") : t("tenants-danger-delete-btn")}
      </button>
    </div>
  );
}

// ---------- Clone box (full / design-only clone, staging, promote) ----------
function CloneBox({ token, sourceHost, onNewSite }: { token: string; sourceHost: string; onNewSite: () => void }) {
  const { t } = useT();
  const [clones, setClones] = useState<api.CloneMeta[]>([]);
  const [type, setType] = useState<"full" | "design">("full");
  const [label, setLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setClones(await api.listClones(token, sourceHost));
  }
  useEffect(() => {
    void refresh();
  }, [sourceHost]);

  async function run(busyKey: string | null, fn: () => Promise<void>) {
    setError(null);
    setMsg(null);
    setBusyId(busyKey);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function stage(id: string) {
    await run(id, async () => {
      const { stagingHost } = await api.stageClone(token, id);
      setMsg(`${t("tenants-clone-staging-label")} ${stagingHost}`);
      await refresh();
    });
  }

  async function replace(stagingHost: string) {
    if (!window.confirm(t("tenants-clone-replace-confirm"))) return;
    await run(stagingHost, async () => {
      await api.replaceFromStaging(token, sourceHost, stagingHost);
      setMsg(t("tenants-clone-replace-done"));
    });
  }

  async function promote(id: string, suggestedHost?: string) {
    const newHost = window.prompt(t("tenants-clone-host-prompt"), suggestedHost ?? "");
    if (!newHost) return;
    const departmentName = window.prompt(t("tenants-clone-dept-prompt"));
    if (!departmentName) return;
    await run(id, async () => {
      const created = await api.promoteClone(token, id, newHost, departmentName);
      setMsg(`${t("tenants-clone-done")} ${created.host}`);
      onNewSite();
    });
  }

  return (
    <div className={`${card} space-y-3 p-5`}>
      <h3 className="text-xs font-bold text-ink">{t("tenants-clone-box-title")}</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          className={`${inputCls} sm:w-64 sm:shrink-0`}
          value={type}
          onChange={(e) => setType(e.target.value as "full" | "design")}
        >
          <option value="full">{t("tenants-clone-type-full")}</option>
          <option value="design">{t("tenants-clone-type-design")}</option>
        </select>
        <input
          className={inputCls}
          placeholder={t("tenants-clone-label-placeholder")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          disabled={busyId === "prepare"}
          onClick={() =>
            void run("prepare", async () => {
              await api.prepareClone(token, sourceHost, type, label || undefined);
              setLabel("");
              await refresh();
            })
          }
          className={`${btnPrimary} shrink-0 inline-flex items-center justify-center gap-1.5`}
        >
          <Copy className="h-3.5 w-3.5" /> {busyId === "prepare" ? t("settings-busy") : t("tenants-clone")}
        </button>
      </div>
      {clones.length === 0 && <p className="text-xs text-sub">{t("tenants-clone-empty")}</p>}
      <div className="space-y-2">
        {clones.map((c) => (
          <div
            key={c.id}
            className={`rounded-lg border p-3 text-xs ${
              c.stagingHost ? "border-amber-300 bg-amber-50" : "border-line/30"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">{c.label || (c.type === "full" ? t("tenants-clone-type-full") : t("tenants-clone-type-design"))}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    c.type === "full" ? "bg-accent/10 text-accent" : "bg-sub/10 text-sub"
                  }`}
                >
                  {c.type === "full" ? t("tenants-clone-type-full") : t("tenants-clone-type-design")}
                </span>
                {c.stagingHost && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    {t("tenants-clone-staging-tag")}
                  </span>
                )}
              </div>
              <span className="text-sub">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
            {c.stagingHost && <p className="mt-1 font-mono text-[11px] text-amber-700">{c.stagingHost}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                disabled={busyId === c.id}
                onClick={() => void run(c.id, () => api.downloadClone(token, c.id))}
                className={`${btnGhost} px-2.5 py-1`}
              >
                {t("tenants-clone-download")}
              </button>
              {c.stagingHost ? (
                <>
                  <a
                    href={api.previewUrl(c.stagingHost, "home")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${btnGhost} px-2.5 py-1`}
                  >
                    {t("tenants-view")}
                  </a>
                  <button
                    disabled={busyId === c.stagingHost}
                    onClick={() => void replace(c.stagingHost!)}
                    className={`${btnPrimary} px-2.5 py-1`}
                  >
                    {t("tenants-clone-replace")}
                  </button>
                </>
              ) : (
                <button disabled={busyId === c.id} onClick={() => void stage(c.id)} className={`${btnGhost} px-2.5 py-1`}>
                  {t("tenants-clone-stage")}
                </button>
              )}
              <button
                disabled={busyId === c.id}
                onClick={() => void promote(c.id, c.label)}
                className={`${btnGhost} px-2.5 py-1`}
              >
                {t("tenants-clone-newsite")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Users ----------
const PERMISSIONS = [
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
] as const;
const PERMISSION_LABEL_KEY: Record<(typeof PERMISSIONS)[number], Key> = {
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
};

function UsersPanel({ token, onImpersonate }: { token: string; onImpersonate: (s: Session) => void }) {
  const { t } = useT();
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<Record<string, unknown>>>([]);
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"webmaster" | "superadmin">("webmaster");
  const [tenantHosts, setTenantHosts] = useState<string[]>([]);
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPerms, setEditingPerms] = useState<string[]>([]);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editTenantHosts, setEditTenantHosts] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  const selectedRole = roles.find((r) => r.id === roleId);
  const canMultiSite = ((selectedRole?.permissions as string[] | undefined) ?? []).includes("sites.multi");
  useEffect(() => {
    if (!canMultiSite && tenantHosts.length > 1) setTenantHosts((prev) => prev.slice(0, 1));
  }, [canMultiSite, tenantHosts.length]);

  async function impersonate(u: Record<string, unknown>) {
    try {
      onImpersonate(await api.impersonateUser(token, u.id as string));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function refresh() {
    setUsers(await api.listPortalUsers(token));
    setRoles(await api.listPortalRoles(token));
    setTenants(await api.listPortalTenants(token));
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPortalUser(token, {
        email,
        password,
        role,
        tenantHosts: tenantHosts.length ? tenantHosts : undefined,
        roleId: roleId || null,
      });
      setEmail("");
      setPassword("");
      setTenantHosts([]);
      setRoleId("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function assignRole(u: Record<string, unknown>, newRoleId: string) {
    try {
      await api.updatePortalUserRole(token, u.id as string, newRoleId || null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setUserExtraPermissions(u: Record<string, unknown>, perms: string[]) {
    try {
      await api.updatePortalUserRole(token, u.id as string, (u.roleId as string | null) ?? null, perms);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openEditUser(u: Record<string, unknown>) {
    setEditUserId(u.id as string);
    setEditPassword("");
    setEditTenantHosts(((u.tenantHosts as string[] | null) ?? []).length ? (u.tenantHosts as string[]) : u.tenantHost ? [u.tenantHost as string] : []);
    setEditError(null);
  }

  async function saveEditPassword(u: Record<string, unknown>) {
    if (!editPassword.trim()) return;
    try {
      await api.updatePortalUserPassword(token, u.id as string, editPassword.trim());
      setEditPassword("");
    } catch (err) {
      setEditError((err as Error).message);
    }
  }

  async function saveEditTenantHosts(u: Record<string, unknown>) {
    if (editTenantHosts.length === 0) {
      setEditError(t("users-edit-sites-required"));
      return;
    }
    try {
      await api.updatePortalUserTenantHosts(token, u.id as string, editTenantHosts);
      await refresh();
    } catch (err) {
      setEditError((err as Error).message);
    }
  }

  async function removeUser(u: Record<string, unknown>) {
    if (!window.confirm(t("users-delete-confirm"))) return;
    try {
      await api.deletePortalUser(token, u.id as string);
      setEditUserId(null);
      await refresh();
    } catch (err) {
      setEditError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <UsersIcon className="h-4 w-4 text-accent" /> {t("users-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} w-auto flex-1`}
          placeholder={t("users-email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={`${inputCls} w-auto`}
          placeholder={t("users-password")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-sub">{t("users-account-type")}</label>
          <select
            className="rounded-lg border border-line/30 bg-white px-2 py-2 text-xs outline-none"
            value={role}
            onChange={(e) => setRole(e.target.value as "webmaster" | "superadmin")}
          >
            <option value="webmaster">{t("role-webmaster-label")}</option>
            <option value="superadmin">{t("role-superadmin-label")}</option>
          </select>
        </div>
        {role === "webmaster" && (
          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-bold uppercase tracking-wider text-sub">{t("users-role")}</label>
            <select
              className="rounded-lg border border-line/30 bg-white px-2 py-2 text-xs outline-none"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">{t("users-role-none")}</option>
              {roles.map((r) => (
                <option key={r.id as string} value={r.id as string}>
                  {r.name as string}
                </option>
              ))}
            </select>
          </div>
        )}
        {role === "webmaster" && canMultiSite && (
          <div className="flex max-w-xs flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line/30 bg-white px-3 py-2 text-[11px] text-body">
            {tenants.map((tn) => (
              <label key={tn.id as string} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={tenantHosts.includes(tn.host as string)}
                  onChange={(e) =>
                    setTenantHosts((prev) =>
                      e.target.checked
                        ? [...prev, tn.host as string]
                        : prev.filter((h) => h !== (tn.host as string)),
                    )
                  }
                />
                {tn.departmentName as string} — {tn.host as string}
              </label>
            ))}
          </div>
        )}
        {role === "webmaster" && !canMultiSite && (
          <select
            className={`${inputCls} w-auto`}
            value={tenantHosts[0] ?? ""}
            onChange={(e) => setTenantHosts(e.target.value ? [e.target.value] : [])}
            required
          >
            <option value="">{t("content-pick")}</option>
            {tenants.map((tn) => (
              <option key={tn.id as string} value={tn.host as string}>
                {tn.departmentName as string} — {tn.host as string}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className={btnPrimary}>
          {t("users-create")}
        </button>
      </form>
      <div className={`${card} overflow-hidden`}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line/30 bg-canvas text-[10px] font-bold uppercase tracking-wider text-sub">
              <th className="px-4 py-3">{t("users-email")}</th>
              <th className="px-4 py-3">{t("users-account-type")}</th>
              <th className="px-4 py-3">{t("users-tenant")}</th>
              <th className="px-4 py-3">{t("users-role")}</th>
              <th className="px-4 py-3">{t("users-extra-perms")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/20 text-xs text-ink">
            {users.map((u) => (
              <Fragment key={u.id as string}>
              <tr className="transition-colors hover:bg-canvas/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold uppercase text-accent">
                      {(u.email as string)[0]}
                    </div>
                    <span className="font-medium">{u.email as string}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-accent">
                    {u.role as string}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-sub">
                  {((u.tenantHosts as string[] | null) ?? []).join(", ") || (u.tenantHost as string) || "—"}
                </td>
                <td className="px-4 py-3">
                  {u.role === "superadmin" ? (
                    <span className="text-[10px] text-sub">{t("cap-all")}</span>
                  ) : (
                    <select
                      className="rounded-lg border border-line/30 bg-white px-2 py-1 text-[11px] outline-none"
                      value={(u.roleId as string | null) ?? ""}
                      onChange={(e) => assignRole(u, e.target.value)}
                    >
                      <option value="">{t("users-role-none")}</option>
                      {roles.map((r) => (
                        <option key={r.id as string} value={r.id as string}>
                          {r.name as string}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.role === "webmaster" &&
                    (editingId === (u.id as string) ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {PERMISSIONS.map((perm) => (
                            <label key={perm} className="flex items-center gap-1 text-[10px]">
                              <input
                                type="checkbox"
                                checked={editingPerms.includes(perm)}
                                onChange={(e) =>
                                  setEditingPerms((prev) =>
                                    e.target.checked ? [...prev, perm] : prev.filter((p) => p !== perm),
                                  )
                                }
                              />
                              {t(PERMISSION_LABEL_KEY[perm])}
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              await setUserExtraPermissions(u, editingPerms);
                              setEditingId(null);
                            }}
                            className="text-[10px] font-semibold text-accent hover:underline"
                          >
                            {t("media-save")}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-[10px] font-semibold text-sub hover:underline"
                          >
                            {t("media-cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-sub">
                          {((u.extraPermissions as string[] | null) ?? []).length
                            ? ((u.extraPermissions as string[]).map((p) => t(PERMISSION_LABEL_KEY[p as (typeof PERMISSIONS)[number]])).join(", "))
                            : "—"}
                        </span>
                        <button
                          onClick={() => {
                            setEditingId(u.id as string);
                            setEditingPerms((u.extraPermissions as string[] | null) ?? []);
                          }}
                          className="text-sub hover:text-ink"
                          title={t("media-edit")}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {u.role === "webmaster" && (
                      <button onClick={() => impersonate(u)} className="text-[10px] font-semibold text-accent hover:underline">
                        {t("users-impersonate")}
                      </button>
                    )}
                    <button
                      onClick={() => (editUserId === (u.id as string) ? setEditUserId(null) : openEditUser(u))}
                      className="text-sub hover:text-ink"
                      title={t("users-edit")}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
              {editUserId === (u.id as string) && (
                <tr key={`${u.id as string}-edit`} className="bg-canvas/40">
                  <td colSpan={6} className="space-y-3 px-4 py-4">
                    {editError && <p className="text-xs text-red-600">{editError}</p>}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[9px] font-bold uppercase tracking-wider text-sub">
                          {t("users-edit-password-label")}
                        </label>
                        <input
                          type="password"
                          className={`${inputCls} w-auto`}
                          placeholder={t("users-edit-password-placeholder")}
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                        />
                      </div>
                      <button
                        disabled={!editPassword.trim()}
                        onClick={() => void saveEditPassword(u)}
                        className={`${btnGhost} px-3 py-1.5 text-xs`}
                      >
                        {t("users-edit-save-password")}
                      </button>
                    </div>
                    {u.role === "webmaster" && (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] font-bold uppercase tracking-wider text-sub">
                            {t("users-edit-sites-label")}
                          </label>
                          <div className="flex max-w-md flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line/30 bg-white px-3 py-2 text-[11px] text-body">
                            {tenants.map((tn) => (
                              <label key={tn.id as string} className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={editTenantHosts.includes(tn.host as string)}
                                  onChange={(e) =>
                                    setEditTenantHosts((prev) =>
                                      e.target.checked
                                        ? [...prev, tn.host as string]
                                        : prev.filter((h) => h !== (tn.host as string)),
                                    )
                                  }
                                />
                                {tn.departmentName as string}
                              </label>
                            ))}
                          </div>
                        </div>
                        <button onClick={() => void saveEditTenantHosts(u)} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                          {t("users-edit-save-sites")}
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => void removeUser(u)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t("users-delete")}
                    </button>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Roles & Permissions ----------
function RolesPanel({ token }: { token: string }) {
  const { t } = useT();
  const [roles, setRoles] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState("");

  async function refresh() {
    setRoles(await api.listPortalRoles(token));
  }

  async function renameRole(r: Record<string, unknown>) {
    if (!editingRoleName.trim()) return;
    try {
      await api.updatePortalRole(token, r.id as string, (r.permissions as string[] | null) ?? [], editingRoleName.trim());
      setEditingRoleId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPortalRole(token, name, permissions);
      setName("");
      setPermissions([]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function togglePermission(r: Record<string, unknown>, perm: string) {
    const current = (r.permissions as string[] | null) ?? [];
    const next = current.includes(perm) ? current.filter((p) => p !== perm) : [...current, perm];
    try {
      await api.updatePortalRole(token, r.id as string, next);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("roles-delete-confirm"))) return;
    try {
      await api.deletePortalRole(token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <ShieldCheck className="h-4 w-4 text-accent" /> {t("roles-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className={`${card} max-w-xl space-y-3 p-4`}>
        <input
          className={inputCls}
          placeholder={t("roles-name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-2 text-xs text-body sm:grid-cols-3">
          {PERMISSIONS.map((perm) => (
            <label key={perm} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={permissions.includes(perm)}
                onChange={(e) =>
                  setPermissions((prev) => (e.target.checked ? [...prev, perm] : prev.filter((p) => p !== perm)))
                }
              />
              {t(PERMISSION_LABEL_KEY[perm])}
            </label>
          ))}
        </div>
        <button type="submit" className={btnPrimary}>
          {t("roles-create")}
        </button>
      </form>
      {roles.length === 0 && <p className="text-xs text-sub">{t("roles-empty")}</p>}
      <div className="space-y-3">
        {roles.map((r) => (
          <div key={r.id as string} className={`${card} space-y-2 p-4`}>
            <div className="flex items-center justify-between">
              {editingRoleId === (r.id as string) ? (
                <div className="flex items-center gap-1.5">
                  <input
                    className="rounded border border-line/30 px-1.5 py-0.5 text-xs outline-none"
                    value={editingRoleName}
                    onChange={(e) => setEditingRoleName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renameRole(r);
                      if (e.key === "Escape") setEditingRoleId(null);
                    }}
                    autoFocus
                  />
                  <button onClick={() => renameRole(r)} className="text-[10px] font-semibold text-accent hover:underline">
                    {t("media-save")}
                  </button>
                  <button onClick={() => setEditingRoleId(null)} className="text-[10px] font-semibold text-sub hover:underline">
                    {t("media-cancel")}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-semibold text-ink">{r.name as string}</h3>
                  <button
                    onClick={() => {
                      setEditingRoleId(r.id as string);
                      setEditingRoleName(r.name as string);
                    }}
                    className="text-sub hover:text-ink"
                    title={t("media-edit")}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
              <button
                onClick={() => remove(r.id as string)}
                className="rounded p-1 text-red-500 hover:bg-red-50"
                title={t("roles-delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PERMISSIONS.map((perm) => {
                const on = ((r.permissions as string[] | null) ?? []).includes(perm);
                return (
                  <button
                    key={perm}
                    type="button"
                    onClick={() => togglePermission(r, perm)}
                    className={`rounded-full px-2 py-0.5 text-[9px] font-semibold transition-colors ${
                      on ? "bg-accent/10 text-accent" : "bg-canvas text-sub"
                    }`}
                  >
                    {t(PERMISSION_LABEL_KEY[perm])}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Portal feed ----------
function PortalFeedPanel({ token }: { token: string }) {
  const { t } = useT();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void api.listPortalSharedContent(token).then(setItems);
  }, []);
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Rss className="h-4 w-4 text-accent" /> {t("feed-title")}
      </h2>
      <ul className={`${card} divide-y divide-line/20`}>
        {items.map((i) => (
          <li key={i.id as string} className="px-4 py-3 text-xs">
            <a href={i.link as string} className="font-semibold text-accent hover:underline" target="_blank" rel="noreferrer">
              {i.title as string}
            </a>
            <span className="ml-2 text-sub">
              {t("feed-from")} {i.sourceHost as string}
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("feed-empty")}</li>}
      </ul>
    </section>
  );
}

// ---------- Dashboard ----------
function MetricCard({ label, value, unit, icon }: { label: string; value: number | string; unit: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-canvas p-6 transition-transform duration-150 hover:scale-[1.01]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-sub">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">{icon}</div>
      </div>
      <div className="mt-4">
        <span className="text-3xl font-semibold tracking-tight text-ink">{value}</span>
        <span className="ml-2 text-xs text-sub">{unit}</span>
      </div>
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const { t } = useT();
  const [counts, setCounts] = useState<{ tenants?: number; users?: number; feed?: number; pages?: number }>({});

  useEffect(() => {
    if (session.role === "superadmin") {
      void api.listPortalTenants(session.token).then((x) => setCounts((c) => ({ ...c, tenants: x.length })));
      void api.listPortalUsers(session.token).then((x) => setCounts((c) => ({ ...c, users: x.length })));
      void api.listPortalSharedContent(session.token).then((x) => setCounts((c) => ({ ...c, feed: x.length })));
    } else if (session.tenantHost) {
      void api.getPages(session.tenantHost, session.token).then((x) => setCounts((c) => ({ ...c, pages: x.length })));
    }
  }, [session]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-canvas p-8">
        <div className="relative z-10 max-w-2xl">
          <span className="rounded-full bg-accent/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
            USIM CMS v1.0
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold leading-tight tracking-tight text-ink">{t("welcome-title")}</h2>
          <p className="mt-2 text-xs leading-relaxed text-sub">{t("welcome-desc")}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {session.role === "superadmin" ? (
          <>
            <MetricCard label={t("m-portals")} value={counts.tenants ?? "…"} unit={t("m-portals-unit")} icon={<Globe className="h-4 w-4 text-ok" />} />
            <MetricCard label={t("m-users")} value={counts.users ?? "…"} unit={t("m-users-unit")} icon={<UsersIcon className="h-4 w-4 text-accent" />} />
            <MetricCard label={t("m-feed")} value={counts.feed ?? "…"} unit={t("m-feed-unit")} icon={<Rss className="h-4 w-4 text-warn" />} />
          </>
        ) : (
          <MetricCard label={t("m-pages")} value={counts.pages ?? "…"} unit={t("m-pages-unit")} icon={<FileText className="h-4 w-4 text-accent" />} />
        )}
      </div>
    </div>
  );
}

// ---------- Content Manager (Pages/Posts/Media/Theme sub-tabs) ----------
type ContentSubTab = "pages" | "posts" | "media" | "theme";

function ContentManager({
  isSuper,
  showSitePicker,
  siteHost,
  setSiteHost,
  tenants,
  token,
}: {
  isSuper: boolean;
  showSitePicker: boolean;
  siteHost: string;
  setSiteHost: (host: string) => void;
  tenants: Array<Record<string, unknown>>;
  token: string;
}) {
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const activeSubTab = (location.pathname.split("/")[2] || "pages") as ContentSubTab;
  const subTabs: Array<{ id: ContentSubTab; labelKey: Key; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "pages", labelKey: "pages-title", icon: FileText },
    { id: "posts", labelKey: "posts-title", icon: Newspaper },
    { id: "media", labelKey: "media-title", icon: ImageIcon },
    ...(isSuper ? [{ id: "theme" as const, labelKey: "theme-title" as const, icon: Palette }] : []),
  ];

  return (
    <div className="space-y-6">
      {showSitePicker && (
        <div className="max-w-sm space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("content-site")}</label>
          <select
            className="w-full rounded-lg border border-line/30 bg-white px-3 py-2 text-xs outline-none"
            value={siteHost}
            onChange={(e) => setSiteHost(e.target.value)}
          >
            <option value="">{t("content-pick")}</option>
            {tenants.map((tn) => (
              <option key={tn.id as string} value={tn.host as string}>
                {tn.departmentName as string} — {tn.host as string}
              </option>
            ))}
          </select>
        </div>
      )}
      {siteHost && (
        <>
          <div className="flex gap-1.5 border-b border-line/30 pb-2">
            {subTabs.map(({ id, labelKey, icon: Icon }) => (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeSubTab === id ? "bg-canvas text-accent" : "text-body hover:bg-canvas/60 hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
              </button>
            ))}
          </div>
          <Routes>
            <Route index element={<Navigate to="pages" replace />} />
            <Route path="pages" element={<PagesPanel tenantHost={siteHost} token={token} />} />
            <Route path="posts" element={<PostsPanel key={`posts-${siteHost}`} tenantHost={siteHost} token={token} />} />
            <Route path="media" element={<MediaManager key={`media-${siteHost}`} tenantHost={siteHost} token={token} />} />
            {isSuper && (
              <Route path="theme" element={<ThemeForm key={siteHost} title={t("theme-title")} desc={t("theme-desc")} load={() => api.getTheme(siteHost, token)} save={(s) => api.putTheme(siteHost, token, s)} token={token} allowDeactivate previewTenantHost={siteHost} />} />
            )}
          </Routes>
        </>
      )}
    </div>
  );
}

// ---------- Shell (sidebar + header, prototype layout) ----------
type Tab = "dashboard" | "multisite" | "users" | "roles" | "content" | "theme" | "global-theme" | "feed" | "settings";

const TAB_META: Record<Tab, { labelKey: Key; icon: React.ComponentType<{ className?: string }> }> = {
  dashboard: { labelKey: "tab-dashboard", icon: LayoutDashboard },
  multisite: { labelKey: "tab-multisite", icon: Layers },
  users: { labelKey: "tab-users", icon: UsersIcon },
  roles: { labelKey: "tab-roles", icon: ShieldCheck },
  content: { labelKey: "tab-content", icon: FileText },
  theme: { labelKey: "tab-theme", icon: Palette },
  "global-theme": { labelKey: "tab-global-theme", icon: Palette },
  feed: { labelKey: "tab-feed", icon: Rss },
  settings: { labelKey: "tab-settings", icon: SettingsIcon },
};

// ---------- Settings (superadmin: backup / restore / static export) ----------
function SettingsPanel({ token, tenants }: { token: string; tenants: Array<Record<string, unknown>> }) {
  const { t } = useT();
  const [host, setHost] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!window.confirm(t("settings-restore-confirm"))) return;
      void run("restore", async () => {
        await api.restoreTenantBackup(token, host, file);
        setMsg(t("settings-restore-done"));
      });
    };
    input.click();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <select className={inputCls} value={host} onChange={(e) => setHost(e.target.value)}>
        <option value="">{t("settings-tenant")}</option>
        {tenants.map((tn) => (
          <option key={tn.host as string} value={tn.host as string}>
            {(tn.departmentName as string) || (tn.host as string)}
          </option>
        ))}
      </select>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
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
    </div>
  );
}

function NavButton({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
  const { t } = useT();
  const { labelKey, icon: Icon } = TAB_META[tab];
  return (
    <button
      onClick={onClick}
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

  const mainTabs: Tab[] = isSuper ? ["dashboard", "multisite", "users", "roles", "settings"] : ["dashboard"];
  const contentTabs: Tab[] = isSuper ? ["content", "global-theme", "feed"] : ["content", "theme"];

  return (
    <I18nCtx.Provider value={{ lang, t }}>
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
        {/* Sidebar */}
        <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line/50 bg-white">
          <div className="flex items-center gap-3 border-b border-line/30 p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
              U
            </div>
            <div>
              <h1 className="font-display text-sm font-bold tracking-tight text-ink">USIM CMS</h1>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
            </div>
          </div>
          <nav className="flex-1 space-y-1.5 overflow-y-auto p-4">
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-main")}</div>
            {mainTabs.map((tb) => (
              <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => navigate(`/${tb}`)} />
            ))}
            <div className="mb-2 px-3 pt-4 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-content")}</div>
            {contentTabs.map((tb) => (
              <NavButton key={tb} tab={tb} active={activeTab === tb} onClick={() => navigate(`/${tb}`)} />
            ))}
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
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden bg-white">
          <header className="flex shrink-0 items-center justify-between border-b border-line/40 bg-white px-8 py-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-sub">{t("header-workspace")}</span>
              <ChevronRight className="h-3.5 w-3.5 text-line" />
              <span className="flex items-center gap-1.5 rounded-full border border-line/30 bg-canvas px-2.5 py-0.5 text-xs font-bold text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {t(TAB_META[activeTab].labelKey)}
              </span>
              <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
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

          <main className="flex-1 overflow-y-auto bg-white p-8">
            <div className="mx-auto max-w-7xl space-y-6 pb-10">
              <Routes>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard session={session} />} />
                <Route path="multisite" element={isSuper ? <TenantsPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
                <Route path="users" element={isSuper ? <UsersPanel token={session.token} onImpersonate={onImpersonate} /> : <Navigate to="/dashboard" replace />} />
                <Route path="roles" element={isSuper ? <RolesPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
                <Route path="content/*" element={<ContentManager isSuper={isSuper} showSitePicker={showSitePicker} siteHost={siteHost} setSiteHost={setSiteHost} tenants={siteOptions} token={session.token} />} />
                <Route path="theme" element={!isSuper && session.tenantHost ? (<ThemeForm title={t("theme-title")} desc={t("theme-desc")} load={() => api.getTheme(session.tenantHost!, session.token)} save={(s) => api.putTheme(session.tenantHost!, session.token, s)} token={session.token} allowDeactivate previewTenantHost={session.tenantHost!} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="global-theme" element={isSuper ? (<ThemeForm title={t("gtheme-title")} load={() => api.getGlobalTheme(session.token)} save={(s) => api.putGlobalTheme(session.token, s)} token={session.token} />) : (<Navigate to="/dashboard" replace />)} />
                <Route path="feed" element={isSuper ? <PortalFeedPanel token={session.token} /> : <Navigate to="/dashboard" replace />} />
                <Route path="settings" element={isSuper ? <SettingsPanel token={session.token} tenants={tenants} /> : <Navigate to="/dashboard" replace />} />
              </Routes>
            </div>
          </main>
        </div>
        </div>
      </div>
    </I18nCtx.Provider>
  );
}

const IMPERSONATOR_KEY = "usim_cms_impersonator";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  // Set only while a superadmin is "viewing as" a webmaster — the stashed
  // superadmin session to restore on exit. Persisted so a page refresh
  // mid-impersonation doesn't strand the admin in the webmaster's view.
  const [adminSession, setAdminSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem(IMPERSONATOR_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  });
  // null = still checking; a fresh install has zero users, so the wizard
  // must win the race against LoginForm rather than flash it on load.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) api.getSetupStatus().then(setNeedsSetup).catch(() => setNeedsSetup(false));
  }, [session]);

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(IMPERSONATOR_KEY);
    setSession(null);
    setAdminSession(null);
  }

  function impersonate(target: Session) {
    if (session) {
      localStorage.setItem(IMPERSONATOR_KEY, JSON.stringify(session));
      setAdminSession(session);
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(target));
    setSession(target);
  }

  function exitImpersonation() {
    if (!adminSession) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(adminSession));
    localStorage.removeItem(IMPERSONATOR_KEY);
    setSession(adminSession);
    setAdminSession(null);
  }

  if (!session) {
    if (needsSetup === null) return null;
    if (needsSetup) return <SetupWizard onDone={setSession} />;
    return <LoginForm onLogin={setSession} />;
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
              impersonating={adminSession !== null}
              onExitImpersonation={exitImpersonation}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
