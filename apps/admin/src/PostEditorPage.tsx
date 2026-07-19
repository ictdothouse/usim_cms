import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Code,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  History,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Settings2,
  Strikethrough,
  Underline,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import type { Key } from "@/i18n";
import { useT, inputCls, btnPrimary, btnGhost } from "./App";
import MediaPickerModal from "./MediaPickerModal";

// ---------- Rich-text toolbar (fixed bar, not just Notion-style slash/hover) ----------
// BlockNote's own selection popup + slash menu stay as-is (kept per request) —
// this adds a persistent bar above the editor for people used to a
// Word/Google Docs-style always-visible toolbar instead of "/"-commands.
// Moved here from App.tsx (Task 15) — it was only ever used by the old
// inline PostEditor, which this full-page editor replaces.
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

function PostHistory({ tenantHost, token, postId, onRestored }: { tenantHost: string; token: string; postId: string; onRestored: () => void }) {
  const { t } = useT();
  const [revisions, setRevisions] = useState<api.PostRevision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.listPostRevisions(tenantHost, token, postId).then(setRevisions).catch((err) => setError((err as Error).message)).finally(() => setLoaded(true));
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
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink"><History className="h-3.5 w-3.5" /> {t("posts-history")}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {loaded && revisions.length === 0 && <p className="text-[11px] text-sub">{t("posts-history-empty")}</p>}
      <ul className="divide-y divide-line/20">
        {revisions.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-sub">{new Date(r.createdAt).toLocaleString()} · {r.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "private" ? "bg-violet-500/10 text-violet-700" : "bg-ok/10 text-ok"}`}>
              {r.status === "private" ? t("posts-private") : t("posts-published")}
            </span>
            <button onClick={() => void restore(r.id)} className="flex items-center gap-1 font-semibold text-accent hover:underline">{t("posts-restore")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type PostStatus = "draft" | "published" | "private";

export default function PostEditorPage({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Array<Record<string, unknown>> | null>(null);
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useMemo(() => posts?.find((p) => p.id === id), [posts, id]);

  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PostStatus>("draft");

  useEffect(() => {
    void api.getPosts(tenantHost, token).then(setPosts);
    void api.listCategories(tenantHost, token).then(setCategories);
  }, [tenantHost, id]);

  useEffect(() => {
    if (!post) return;
    setTitle(post.title as string);
    setExcerpt((post.excerpt as string | null) ?? "");
    setCategoryId((post.categoryId as string | null) ?? "");
    setTagsInput(((post.tags as string[] | null) ?? []).join(", "));
    setBannerImageUrl((post.bannerImageUrl as string | null) ?? null);
    setStatus((post.status as PostStatus) || "draft");
  }, [post]);

  const editor = useCreateBlockNote({
    uploadFile: async (file: File) => {
      const url = await api.uploadMedia(tenantHost, token, file);
      return url.startsWith("http") ? url : api.API_URL + url;
    },
  });

  useEffect(() => {
    if (!post) return;
    const blocks = editor.tryParseHTMLToBlocks((post.body as string) || "");
    editor.replaceBlocks(editor.document, blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  async function save(nextStatus?: PostStatus) {
    if (!post) return;
    setSaving(true);
    try {
      const tags = [...new Set(tagsInput.split(",").map((s) => s.trim()).filter(Boolean))];
      await api.updatePost(tenantHost, token, post.id as string, {
        title, excerpt, categoryId: categoryId || null, tags, bannerImageUrl,
        body: await editor.blocksToHTMLLossy(editor.document),
        ...(nextStatus ? { status: nextStatus, publishedAt: nextStatus === "draft" ? null : new Date().toISOString() } : {}),
      });
      if (nextStatus) setStatus(nextStatus);
      setPosts(await api.getPosts(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function createCategoryInline() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    try {
      const created = await api.createCategory(tenantHost, token, trimmed, trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      setCategories((prev) => [...prev, created]);
      setCategoryId(created.id);
      setNewCategoryName("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function share() {
    if (!post) return;
    try {
      await api.sharePost(tenantHost, token, post.id as string);
      alert(t("posts-shared"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function preview() {
    if (!post) return;
    const win = window.open("", "_blank", "noreferrer");
    if (!win) return;
    try {
      const previewToken = await api.getPostPreviewToken(tenantHost, token, post.id as string);
      win.location.href = api.previewUrl(tenantHost, `posts/${post.slug as string}`, previewToken);
    } catch (err) {
      win.close();
      setError((err as Error).message);
    }
  }

  if (posts === null) return null;
  if (!post) return <p className="p-8 text-xs text-sub">{t("posts-empty")}</p>;

  const statusBadge: Record<PostStatus, string> = { draft: "bg-warn/10 text-warn", published: "bg-ok/10 text-ok", private: "bg-violet-500/10 text-violet-700" };
  const otherStatuses = (current: PostStatus): PostStatus[] => (["draft", "published", "private"] as PostStatus[]).filter((s) => s !== current);
  const statusActionKey: Record<PostStatus, Key> = { draft: "posts-set-draft", published: "posts-publish", private: "posts-make-private" };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-line/40 px-6 py-3">
        <button onClick={() => navigate("/content/posts")} className="flex items-center gap-1 text-xs font-semibold text-body hover:text-ink"><ArrowLeft className="h-4 w-4" /></button>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadge[status]}`}>{t(`posts-${status}` as Key)}</span>
        <span className="flex-1" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={() => void preview()} className="flex items-center gap-1 text-xs font-semibold text-body hover:text-ink"><ExternalLink className="h-3.5 w-3.5" /> {t("posts-preview")}</button>
        {otherStatuses(status).map((s) => (<button key={s} onClick={() => void save(s)} disabled={saving} className={btnGhost}>{t(statusActionKey[s])}</button>))}
        <button onClick={() => void save()} disabled={saving} className={btnPrimary}>{saving ? t("blocks-saving") : t("posts-save")}</button>
        <button onClick={() => setPanelOpen((v) => !v)} className="rounded p-1.5 text-body hover:bg-canvas" title={t("posts-settings")}><Settings2 className="h-4 w-4" /></button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 p-8">
            {bannerImageUrl ? (
              <div className="group relative">
                <img src={bannerImageUrl} alt="" className="h-64 w-full rounded-lg object-cover" />
                <button onClick={() => setBannerImageUrl(null)} className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 group-hover:opacity-100"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <button onClick={() => setShowMediaPicker(true)} className="flex h-32 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line/40 text-xs font-semibold text-sub hover:border-accent hover:text-accent">
                <ImagePlus className="h-4 w-4" /> {t("posts-add-feature-image")}
              </button>
            )}
            <textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={1} placeholder={t("posts-title-placeholder")} className="w-full resize-none border-0 font-display text-3xl font-bold text-ink outline-none" onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }} />
            <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder={t("posts-excerpt")} className="w-full border-0 text-sm text-sub outline-none" />
            <div>
              <EditorToolbar editor={editor} />
              <div className="rounded-b-lg border border-line/30 bg-white py-2 [&_.bn-editor]:min-h-[400px]">
                <BlockNoteView editor={editor} theme="light" />
              </div>
            </div>
          </div>
        </div>
        {panelOpen && (
          <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-line/30 bg-canvas/30 p-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-category")}</label>
              <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t("posts-category-none")}</option>
                {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
              <div className="flex gap-1.5 pt-1">
                <input className={inputCls} placeholder={t("posts-new-category")} value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void createCategoryInline()} />
                <button onClick={() => void createCategoryInline()} className={`${btnGhost} shrink-0`}>{t("categories-create")}</button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-tags")}</label>
              <input className={inputCls} value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
            </div>
            {status === "published" && (<button onClick={() => void share()} className={`${btnGhost} w-full`}>{t("posts-share")}</button>)}
            {(post.authorEmail as string | null) && (<p className="text-[11px] text-sub">{t("posts-author")}: {post.authorEmail as string}</p>)}
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-sub hover:bg-canvas">
              <History className="h-3.5 w-3.5" /> {t("posts-history")}
            </button>
            {showHistory && (<PostHistory tenantHost={tenantHost} token={token} postId={post.id as string} onRestored={() => void api.getPosts(tenantHost, token).then(setPosts)} />)}
          </aside>
        )}
      </div>
      {showMediaPicker && (<MediaPickerModal tenantHost={tenantHost} token={token} onSelect={(url) => { setBannerImageUrl(url); setShowMediaPicker(false); }} onClose={() => setShowMediaPicker(false)} />)}
    </div>
  );
}
