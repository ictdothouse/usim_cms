import { createContext, useContext, useEffect, useState } from "react";
import {
  ChevronRight,
  FileText,
  Globe,
  Image as ImageIcon,
  Languages,
  Layers,
  LayoutDashboard,
  LogOut,
  Newspaper,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Palette,
  Pencil,
  Quote,
  Rss,
  Settings as SettingsIcon,
  ShieldCheck,
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
import type { Session } from "@/lib/api";
import { dict, type Key, type Lang } from "@/i18n";

const SESSION_KEY = "usim_cms_session";

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
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
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
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

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setBannerImageUrl(await api.uploadMedia(tenantHost, token, file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPage(tenantHost, token, { slug, title, ...(bannerImageUrl ? { bannerImageUrl } : {}) });
      setSlug("");
      setTitle("");
      setBannerImageUrl("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function publish(id: string) {
    try {
      await api.publishPage(tenantHost, token, id);
      alert(t("pages-published"));
    } catch (err) {
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

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <FileText className="h-4 w-4 text-accent" /> {t("pages-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className={`${card} space-y-3 p-4`}>
        <div className="flex gap-2">
          <input className={inputCls} placeholder={t("pages-slug")} value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <input className={inputCls} placeholder={t("pages-name")} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <label className="block text-xs font-medium text-body">
          {t("pages-banner")}
          <input type="file" accept="image/*" onChange={onFileChosen} className="mt-1 block text-xs" />
        </label>
        {uploading && <p className="text-[11px] text-sub">{t("uploading")}</p>}
        {bannerImageUrl && <img src={api.API_URL + bannerImageUrl} alt="banner preview" className="h-20 rounded-lg" />}
        <button type="submit" className={btnPrimary}>
          {t("pages-create")}
        </button>
      </form>
      <ul className={`${card} divide-y divide-line/20`}>
        {pages.map((p) => (
          <li key={p.id as string} className="px-4 py-3 text-xs">
            <div className="flex items-center justify-between">
              <span>
                <span className="font-semibold text-ink">{p.title as string}</span>{" "}
                <span className="font-mono text-sub">/{p.slug as string}</span>
              </span>
              <span className="flex items-center gap-3">
                <a
                  href={api.previewUrl(tenantHost, p.slug as string)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-semibold text-body hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {t("pages-view")}
                </a>
                <button
                  onClick={() => setEditingId(editingId === (p.id as string) ? null : (p.id as string))}
                  className="font-semibold text-accent hover:underline"
                >
                  {editingId === p.id ? t("pages-close") : t("pages-edit")}
                </button>
                <button onClick={() => publish(p.id as string)} className="font-semibold text-body hover:underline">
                  {t("pages-publish")}
                </button>
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
        ))}
        {pages.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("pages-empty")}</li>}
      </ul>
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
function PostEditor({
  post,
  tenantHost,
  token,
  onSaved,
  onClose,
}: {
  post: Record<string, unknown>;
  tenantHost: string;
  token: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState(post.title as string);
  const [excerpt, setExcerpt] = useState((post.excerpt as string | null) ?? "");
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
      await api.updatePost(tenantHost, token, post.id as string, {
        title,
        excerpt,
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
      <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className={inputCls} placeholder={t("posts-excerpt")} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
      <div>
        <EditorToolbar editor={editor} />
        <div className="rounded-b-lg border border-line/30 bg-white py-2 [&_.bn-editor]:min-h-[240px]">
          <BlockNoteView editor={editor} theme="light" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className={btnPrimary}>
          {saving ? t("blocks-saving") : t("posts-save")}
        </button>
        <button onClick={onClose} className={btnGhost}>
          {t("posts-close")}
        </button>
      </div>
    </div>
  );
}

function PostsPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPost(tenantHost, token, { slug, title });
      setSlug("");
      setTitle("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setStatus(p: Record<string, unknown>, status: "draft" | "published") {
    try {
      await api.updatePost(tenantHost, token, p.id as string, {
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

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Newspaper className="h-4 w-4 text-accent" /> {t("posts-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className={`${card} flex gap-2 p-4`}>
        <input className={inputCls} placeholder={t("pages-slug")} value={slug} onChange={(e) => setSlug(e.target.value)} required />
        <input className={inputCls} placeholder={t("pages-name")} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <button type="submit" className={`${btnPrimary} shrink-0`}>
          {t("posts-create")}
        </button>
      </form>
      <ul className={`${card} divide-y divide-line/20`}>
        {posts.map((p) => {
          const published = p.status === "published";
          return (
            <li key={p.id as string} className="px-4 py-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{p.title as string}</span>
                  <span className="font-mono text-sub">/posts/{p.slug as string}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      published ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
                    }`}
                  >
                    {published ? t("posts-published") : t("posts-draft")}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <button
                    onClick={() => setEditingId(editingId === (p.id as string) ? null : (p.id as string))}
                    className="font-semibold text-accent hover:underline"
                  >
                    {editingId === p.id ? t("posts-close") : t("posts-edit")}
                  </button>
                  <button
                    onClick={() => setStatus(p, published ? "draft" : "published")}
                    className="font-semibold text-body hover:underline"
                  >
                    {published ? t("posts-unpublish") : t("posts-publish")}
                  </button>
                  {published && (
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
  const [folders, setFolders] = useState<Array<Record<string, unknown>>>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null); // null = all files
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ originalName: "", altText: "", description: "", folderId: "" });
  const [error, setError] = useState<string | null>(null);

  async function refreshFolders() {
    try {
      setFolders(await api.listMediaFolders(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function refreshItems() {
    try {
      setItems(await api.listMedia(tenantHost, token, activeFolder));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refreshFolders();
  }, [tenantHost]);

  useEffect(() => {
    void refreshItems();
  }, [tenantHost, activeFolder]);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadMedia(tenantHost, token, file, activeFolder);
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function copyUrl(m: Record<string, unknown>) {
    await navigator.clipboard.writeText(api.API_URL + (m.url as string));
    setCopiedId(m.id as string);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function remove(id: string) {
    if (!confirm(t("media-delete-confirm"))) return;
    try {
      await api.deleteMedia(tenantHost, token, id);
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addFolder() {
    const name = prompt(t("media-new-folder-prompt"));
    if (!name?.trim()) return;
    try {
      await api.createMediaFolder(tenantHost, token, name.trim());
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

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <ImageIcon className="h-4 w-4 text-accent" /> {t("media-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setActiveFolder(null)}
          className={`rounded-full px-3 py-1 text-[11px] font-medium ${activeFolder === null ? "bg-accent text-white" : "bg-canvas text-sub"}`}
        >
          {t("media-all-files")}
        </button>
        {folders.map((f) => (
          <span
            key={f.id as string}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ${activeFolder === f.id ? "bg-accent text-white" : "bg-canvas text-sub"}`}
          >
            <button onClick={() => setActiveFolder(f.id as string)}>{f.name as string}</button>
            <button onClick={() => removeFolder(f.id as string)} className="opacity-60 hover:opacity-100">
              &times;
            </button>
          </span>
        ))}
        <button onClick={addFolder} className="rounded-full px-3 py-1 text-[11px] font-medium text-accent hover:underline">
          {t("media-new-folder")}
        </button>
      </div>
      <label className={`${btnGhost} inline-block cursor-pointer`}>
        {uploading ? t("uploading") : t("media-upload")}
        <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={onFileChosen} />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((m) => (
          <div key={m.id as string} className={`${card} overflow-hidden`}>
            <img src={api.API_URL + (m.url as string)} alt={(m.altText as string) || (m.originalName as string)} className="h-24 w-full object-cover" />
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
      {items.length === 0 && <p className="text-xs text-sub">{t("media-empty")}</p>}
    </section>
  );
}

// ---------- Theme (shared form for per-site and global) ----------
function ThemeForm({
  title,
  desc,
  load,
  save,
}: {
  title: string;
  desc?: string;
  load: () => Promise<Record<string, string>>;
  save: (settings: Record<string, string>) => Promise<unknown>;
}) {
  const { t } = useT();
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("");
  const [textColor, setTextColor] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load().then((th) => {
      setPrimaryColor(th.primaryColor ?? "");
      setSecondaryColor(th.secondaryColor ?? "");
      setBackgroundColor(th.backgroundColor ?? "");
      setTextColor(th.textColor ?? "");
      setFontFamily(th.fontFamily ?? "");
      setLogoUrl(th.logoUrl ?? "");
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await save({ primaryColor, secondaryColor, backgroundColor, textColor, fontFamily, logoUrl });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
      <form onSubmit={submit} className={`${card} max-w-sm space-y-3 p-4`}>
        <div className="flex flex-wrap gap-3">
          {colorField(t("theme-primary"), primaryColor, setPrimaryColor)}
          {colorField(t("theme-secondary"), secondaryColor, setSecondaryColor)}
          {colorField(t("theme-background"), backgroundColor, setBackgroundColor)}
          {colorField(t("theme-text"), textColor, setTextColor)}
        </div>
        <label className="block text-xs font-medium text-body">
          {t("theme-font")}
          <input
            className={`${inputCls} mt-1`}
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            placeholder="Noto Sans"
          />
        </label>
        {fontFamily && (
          <p className="text-sm" style={{ fontFamily }}>
            {t("theme-font-preview")}
          </p>
        )}
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
    </section>
  );
}

// ---------- Tenants (Multisite) ----------
function TenantsPanel({ token }: { token: string }) {
  const { t } = useT();
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [host, setHost] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Globe className="h-4 w-4 text-accent" /> {t("tenants-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
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
        {tenants.map((tn) => (
          <div key={tn.id as string} className={`${card} p-5`}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="rounded-lg bg-accent/5 p-2 text-accent">
                <Globe className="h-5 w-5" />
              </div>
              {tn.active ? (
                <span className="flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-bold text-ok">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Aktif
                </span>
              ) : (
                <span className="rounded-full bg-sub/10 px-2 py-0.5 text-[10px] font-bold text-sub">{t("tenants-suspended")}</span>
              )}
            </div>
            <h3 className="text-sm font-semibold leading-snug text-ink">{tn.departmentName as string}</h3>
            <p className="mt-1 truncate font-mono text-xs text-sub">{tn.host as string}</p>
          </div>
        ))}
      </div>
    </section>
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
};

function UsersPanel({ token, onImpersonate }: { token: string; onImpersonate: (s: Session) => void }) {
  const { t } = useT();
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<Record<string, unknown>>>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"webmaster" | "superadmin">("webmaster");
  const [tenantHost, setTenantHost] = useState("");
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);

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
        tenantHost: tenantHost || undefined,
        roleId: roleId || null,
      });
      setEmail("");
      setPassword("");
      setTenantHost("");
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
        <select
          className="rounded-lg border border-line/30 bg-white px-2 py-2 text-xs outline-none"
          value={role}
          onChange={(e) => setRole(e.target.value as "webmaster" | "superadmin")}
        >
          <option value="webmaster">webmaster</option>
          <option value="superadmin">superadmin</option>
        </select>
        {role === "webmaster" && (
          <input
            className={`${inputCls} w-auto`}
            placeholder={t("users-tenant")}
            value={tenantHost}
            onChange={(e) => setTenantHost(e.target.value)}
            required
          />
        )}
        {role === "webmaster" && (
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
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">{t("users-role")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/20 text-xs text-ink">
            {users.map((u) => (
              <tr key={u.id as string} className="transition-colors hover:bg-canvas/30">
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
                <td className="px-4 py-3 font-mono text-[11px] text-sub">{(u.tenantHost as string) ?? "—"}</td>
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
                <td className="px-4 py-3 text-right">
                  {u.role === "webmaster" && (
                    <button onClick={() => impersonate(u)} className="text-[10px] font-semibold text-accent hover:underline">
                      {t("users-impersonate")}
                    </button>
                  )}
                </td>
              </tr>
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

  async function refresh() {
    setRoles(await api.listPortalRoles(token));
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
              <h3 className="text-xs font-semibold text-ink">{r.name as string}</h3>
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
  siteHost,
  setSiteHost,
  tenants,
  token,
}: {
  isSuper: boolean;
  siteHost: string;
  setSiteHost: (host: string) => void;
  tenants: Array<Record<string, unknown>>;
  token: string;
}) {
  const { t } = useT();
  const [subTab, setSubTab] = useState<ContentSubTab>("pages");
  const subTabs: Array<{ id: ContentSubTab; labelKey: Key; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "pages", labelKey: "pages-title", icon: FileText },
    { id: "posts", labelKey: "posts-title", icon: Newspaper },
    { id: "media", labelKey: "media-title", icon: ImageIcon },
    ...(isSuper ? [{ id: "theme" as const, labelKey: "theme-title" as const, icon: Palette }] : []),
  ];

  return (
    <div className="space-y-6">
      {isSuper && (
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
                onClick={() => setSubTab(id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  subTab === id ? "bg-canvas text-accent" : "text-body hover:bg-canvas/60 hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
              </button>
            ))}
          </div>
          {subTab === "pages" && <PagesPanel tenantHost={siteHost} token={token} />}
          {subTab === "posts" && <PostsPanel key={`posts-${siteHost}`} tenantHost={siteHost} token={token} />}
          {subTab === "media" && <MediaManager key={`media-${siteHost}`} tenantHost={siteHost} token={token} />}
          {subTab === "theme" && isSuper && (
            <ThemeForm
              key={siteHost}
              title={t("theme-title")}
              desc={t("theme-desc")}
              load={() => api.getTheme(siteHost, token)}
              save={(s) => api.putTheme(siteHost, token, s)}
            />
          )}
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
  const [tab, setTab] = useState<Tab>("dashboard");
  // superadmin picks which site to manage in the content tab; webmaster is locked to theirs
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [siteHost, setSiteHost] = useState<string>(session.tenantHost ?? "");

  useEffect(() => {
    if (isSuper) void api.listPortalTenants(session.token).then(setTenants);
  }, [isSuper, session.token]);

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
              <NavButton key={tb} tab={tb} active={tab === tb} onClick={() => setTab(tb)} />
            ))}
            <div className="mb-2 px-3 pt-4 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-content")}</div>
            {contentTabs.map((tb) => (
              <NavButton key={tb} tab={tb} active={tab === tb} onClick={() => setTab(tb)} />
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
                {t(TAB_META[tab].labelKey)}
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
              {tab === "dashboard" && <Dashboard session={session} />}
              {tab === "multisite" && isSuper && <TenantsPanel token={session.token} />}
              {tab === "users" && isSuper && <UsersPanel token={session.token} onImpersonate={onImpersonate} />}
              {tab === "roles" && isSuper && <RolesPanel token={session.token} />}
              {tab === "content" && (
                <ContentManager
                  isSuper={isSuper}
                  siteHost={siteHost}
                  setSiteHost={setSiteHost}
                  tenants={tenants}
                  token={session.token}
                />
              )}
              {tab === "theme" && !isSuper && session.tenantHost && (
                <ThemeForm
                  title={t("theme-title")}
                  desc={t("theme-desc")}
                  load={() => api.getTheme(session.tenantHost!, session.token)}
                  save={(s) => api.putTheme(session.tenantHost!, session.token, s)}
                />
              )}
              {tab === "global-theme" && isSuper && (
                <ThemeForm title={t("gtheme-title")} load={() => api.getGlobalTheme(session.token)} save={(s) => api.putGlobalTheme(session.token, s)} />
              )}
              {tab === "feed" && isSuper && <PortalFeedPanel token={session.token} />}
              {tab === "settings" && isSuper && <SettingsPanel token={session.token} tenants={tenants} />}
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
  );
}
