import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { bookmarkCardSchema } from "./blocknote/bookmarkCard";
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
import { toast } from "sonner";
import * as api from "@/lib/api";
import type { Key } from "@/i18n";
import { useT, inputCls, btnPrimary, btnGhost } from "./App";
import { useConfirm } from "@/hooks/useConfirm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MediaPickerModal from "./MediaPickerModal";

// i18n Phase 5 — sentinel key for the post's own base-language content
// inside the `content` map (PostEditorPage below). Never a real language
// code, so it can't collide with one; the base slot's actual language is
// whatever the `language` state/field says.
const BASE_LANG = "__base__";
interface LangContent {
  title: string;
  excerpt: string;
  body: string;
}

// Used by save() when the excerpt field is left blank — strips tags from the
// sanitized body HTML and takes the first ~160 chars, so a post never ships
// with no excerpt just because the author didn't fill it in.
function autoExcerpt(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

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

function PostHistory({ tenantHost, token, postId, onRestored }: { tenantHost: string; token: string; postId: string; onRestored: (restoredPost: Record<string, unknown>) => void }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [revisions, setRevisions] = useState<api.PostRevision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.listPostRevisions(tenantHost, token, postId).then(setRevisions).catch((err) => setError((err as Error).message)).finally(() => setLoaded(true));
  }, [postId]);
  async function restore(revisionId: string) {
    if (!(await confirm(t("posts-restore-confirm")))) return;
    try {
      const restoredPost = await api.restorePostRevision(tenantHost, token, postId, revisionId);
      onRestored(restoredPost);
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
type DisplayOverride = "inherit" | "show" | "hide";

function toDisplayOverride(value: boolean | null | undefined): DisplayOverride {
  return value === true ? "show" : value === false ? "hide" : "inherit";
}

function fromDisplayOverride(value: DisplayOverride): boolean | null {
  return value === "show" ? true : value === "hide" ? false : null;
}

// "inherit" has no on/off position of its own — it takes whichever the
// theme's site-wide default currently is, so the switch below always shows
// a real state instead of a third disabled-looking one.
function effectiveDisplay(value: DisplayOverride, themeDefault: boolean): boolean {
  return value === "inherit" ? themeDefault : value === "show";
}

// A real on/off switch, not a checkbox — this panel used to have a 3-option
// <select> ("Ikut Tema"/"Papar"/"Sorok") per field; feedback was that it read
// as fussy for what's just a visibility toggle. Clicking always commits an
// explicit show/hide (see effectiveDisplay above) — there's no separate UI
// to return to "inherit" once touched, by design, matching the request for
// "toggle button on/off shj".
function MetaSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-xs text-body">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line/40"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </label>
  );
}

export default function PostEditorPage({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Array<Record<string, unknown>> | null>(null);
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);
  // i18n Phase 5 — site-wide master switch (Settings ▸ Languages); the
  // Translations panel below is only offered when this AND the post's own
  // multilangEnabled are both true.
  const [siteMultilangEnabled, setSiteMultilangEnabled] = useState(false);
  const [siteDefaultLanguage, setSiteDefaultLanguage] = useState<string | null>(null);
  const [multilangEnabled, setMultilangEnabled] = useState(false);
  // i18n Phase 5 — every language's content lives on this one post row.
  // `content[BASE_LANG]` mirrors the top-level title/excerpt/body columns;
  // `content[code]` for any real code mirrors `post.translations[code]`.
  // `activeLang` is whichever slot the editor is currently showing/editing.
  const [content, setContent] = useState<Record<string, LangContent>>({});
  const [activeLang, setActiveLang] = useState(BASE_LANG);
  const [translating, setTranslating] = useState(false);
  // Per-language resync-on-save prompt (save() below) — a small promise-based
  // modal, same shape as useConfirm but returning which of several languages
  // were picked instead of a single yes/no, since re-translating is opt-in
  // PER LANGUAGE (protects a language someone just hand-edited from being
  // silently overwritten just because the base content also changed).
  const [resyncPrompt, setResyncPrompt] = useState<{ langs: string[]; resolve: (picked: string[]) => void } | null>(null);
  const [resyncChecked, setResyncChecked] = useState<Set<string>>(new Set());
  function askResyncLangs(langs: string[]): Promise<string[]> {
    setResyncChecked(new Set());
    return new Promise((resolve) => setResyncPrompt({ langs, resolve }));
  }
  // Only for computing each MetaSwitch's default on/off position when a
  // field is still "inherit" — this page never edits the theme itself.
  const [theme, setTheme] = useState<Record<string, string> | null>(null);
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
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PostStatus>("draft");
  const [language, setLanguage] = useState("");
  const [showTags, setShowTags] = useState<DisplayOverride>("inherit");
  const [showCategory, setShowCategory] = useState<DisplayOverride>("inherit");
  const [showAuthor, setShowAuthor] = useState<DisplayOverride>("inherit");
  const [showPublishedDate, setShowPublishedDate] = useState<DisplayOverride>("inherit");
  // Minted eagerly (not on-click) so the Preview link for a draft/private
  // post can be a real <a href>, same as the published case below — a real
  // anchor click is a genuine browser navigation and can't hit the
  // "window.open then redirect after an async fetch" failure mode (some
  // browsers silently block that delayed navigation, leaving the tab blank
  // forever — see commit 5363b24, which fixed this for published posts by
  // removing the token round-trip entirely; draft/private still needs one).
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  // Bumped by PostHistory's onRestored below — post?.id never changes across
  // a restore (same post, new content), so the body-load effect needs this
  // extra dependency to know a restore happened and reload the editor's
  // content instead of leaving the pre-restore body on screen (which Save
  // would otherwise silently write back over the just-restored revision).
  const [bodyVersion, setBodyVersion] = useState(0);

  useEffect(() => {
    void api.getPosts(tenantHost, token).then(setPosts);
    void api.listCategories(tenantHost, token).then(setCategories);
    void api.getTheme(tenantHost, token).then(setTheme);
    void api.getTenantLanguages(tenantHost, token).then((d) => {
      setSiteLanguages(d.allEnabled);
      setSiteMultilangEnabled(d.multilangEnabled);
      setSiteDefaultLanguage(d.defaultLanguage);
    });
  }, [tenantHost, id]);

  // Applied once the site default arrives — only for a post that has never
  // had its own language explicitly chosen (post.language still null). A
  // post already saved with an explicit language (including "None") is
  // never overridden by a later-arriving default.
  useEffect(() => {
    if (!post) return;
    if (!post.language && siteDefaultLanguage) setLanguage(siteDefaultLanguage);
  }, [post?.id, siteDefaultLanguage]);

  // Keyed on post?.id (not the `post` object itself) — save() below always
  // calls setPosts() to refresh from the server afterward, which gives
  // `post` a new object/array identity for the SAME row; keying on the
  // whole object would re-fire this effect after every save and snap
  // activeLang back to BASE_LANG mid-edit. Only a genuine navigation to a
  // different post (id changes) should reset the editor's local state.
  useEffect(() => {
    if (!post) return;
    const base: LangContent = { title: post.title as string, excerpt: (post.excerpt as string | null) ?? "", body: (post.body as string) || "" };
    setContent({ [BASE_LANG]: base, ...((post.translations as Record<string, LangContent> | null) ?? {}) });
    setActiveLang(BASE_LANG);
    setTitle(base.title);
    setExcerpt(base.excerpt);
    setCategoryId((post.categoryId as string | null) ?? "");
    setTags((post.tags as string[] | null) ?? []);
    setTagDraft("");
    setBannerImageUrl((post.bannerImageUrl as string | null) ?? null);
    setStatus((post.status as PostStatus) || "draft");
    setLanguage((post.language as string | null) ?? "");
    setMultilangEnabled(Boolean(post.multilangEnabled));
    setShowTags(toDisplayOverride(post.showTags as boolean | null | undefined));
    setShowCategory(toDisplayOverride(post.showCategory as boolean | null | undefined));
    setShowAuthor(toDisplayOverride(post.showAuthor as boolean | null | undefined));
    setShowPublishedDate(toDisplayOverride(post.showPublishedDate as boolean | null | undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  // The Language control doubles as the translation switcher once multilang
  // is on: picking a language other than the currently-active one swaps
  // which slot of `content` the title/excerpt/editor fields show — always
  // the SAME post row, never a separate one. Leaving a slot snapshots its
  // current (possibly just-edited) values into `content` first, so nothing
  // is lost; entering a slot with no content yet runs it through the real
  // auto-translate API (apps/api/src/translate.ts) — falling back to a
  // verbatim copy if that call fails, so a provider hiccup never blocks the
  // switch. Picking a language before this post has one of its own yet
  // (activeLang still BASE_LANG's default "") just labels the base row
  // instead — nothing meaningful to translate from/to.
  async function switchLanguage(target: string) {
    if (target === activeLang) return;
    const html = await editor.blocksToHTMLLossy(editor.document);
    const leaving: LangContent = { title, excerpt, body: html };
    let targetEntry = content[target];
    if (!targetEntry) {
      const sourceCode = activeLang === BASE_LANG ? (language || undefined) : activeLang;
      setTranslating(true);
      setError(null);
      try {
        // Sequential, not Promise.all: three requests hitting an
        // unmigrated tenant DB at once race on the migration DDL and can
        // deadlock in Postgres (each request independently tries to
        // ensure/migrate the tenant DB — see tenant-pool.ts's
        // ensureTenantDatabase). Only the FIRST request in a cold process
        // actually pays that cost; sequencing avoids the race entirely.
        const tTitle = leaving.title ? await api.translateText(tenantHost, token, leaving.title, target, { source: sourceCode }) : "";
        const tExcerpt = leaving.excerpt ? await api.translateText(tenantHost, token, leaving.excerpt, target, { source: sourceCode }) : "";
        const tBody = leaving.body ? await api.translateText(tenantHost, token, leaving.body, target, { source: sourceCode, html: true }) : "";
        targetEntry = { title: tTitle, excerpt: tExcerpt, body: tBody };
      } catch (err) {
        setError((err as Error).message);
        targetEntry = leaving;
      } finally {
        setTranslating(false);
      }
    }
    setContent((prev) => ({ ...prev, [activeLang]: leaving, [target]: targetEntry! }));
    setTitle(targetEntry.title);
    setExcerpt(targetEntry.excerpt);
    editor.replaceBlocks(editor.document, editor.tryParseHTMLToBlocks(targetEntry.body || ""));
    setActiveLang(target);
  }

  function clickLanguagePill(code: string) {
    if (!language) {
      setLanguage(code);
      return;
    }
    void switchLanguage(code === language ? BASE_LANG : code);
  }

  const editor = useCreateBlockNote({
    schema: bookmarkCardSchema,
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
  }, [post?.id, bodyVersion]);

  useEffect(() => {
    setPreviewToken(null);
    if (!post || status === "published") return;
    let cancelled = false;
    void api.getPostPreviewToken(tenantHost, token, post.id as string).then((t) => {
      if (!cancelled) setPreviewToken(t);
    });
    return () => {
      cancelled = true;
    };
  }, [post?.id, status, tenantHost, token]);

  async function save(nextStatus?: PostStatus) {
    if (!post) return;
    if (nextStatus === "published") {
      const draftHtml = await editor.blocksToHTMLLossy(editor.document);
      const warnings: string[] = [];
      if (autoExcerpt(draftHtml).length < 20) warnings.push(t("prepublish-empty-body"));
      if (!excerpt.trim()) warnings.push(t("prepublish-no-excerpt"));
      if (warnings.length > 0 && !(await confirm(`${t("prepublish-warning-title")}\n\n- ${warnings.join("\n- ")}`))) {
        return;
      }
    }
    setSaving(true);
    try {
      const html = await editor.blocksToHTMLLossy(editor.document);
      // Commit whatever slot is currently on screen before splitting into
      // base fields (top-level columns) + translations (everything else) —
      // the live editor/title/excerpt state is always the freshest copy of
      // `activeLang`'s content, `content` itself only gets updated on switch.
      let merged: Record<string, LangContent> = { ...content, [activeLang]: { title, excerpt, body: html } };
      const base = merged[BASE_LANG];
      const otherLangs = Object.keys(merged).filter((c) => c !== BASE_LANG);
      // Base content only really "changed" if it differs from what was
      // loaded from the server — comparing against the post's own
      // currently-saved fields (not some tracked snapshot) is enough to
      // avoid nagging on every Save when nothing in the base slot moved.
      const baseChanged =
        base.title !== (post.title as string) ||
        base.excerpt !== ((post.excerpt as string | null) ?? "") ||
        base.body !== ((post.body as string) || "");
      if (baseChanged && otherLangs.length > 0) {
        // Per-language opt-in, not all-or-nothing — a language someone just
        // hand-edited (e.g. fixed a bad auto-translation) can be left
        // unchecked so this save never overwrites that work; only the
        // checked ones get re-translated from the updated base.
        const picked = await askResyncLangs(otherLangs);
        if (picked.length > 0) {
          setTranslating(true);
          for (const code of picked) {
            try {
              const tTitle = base.title ? await api.translateText(tenantHost, token, base.title, code, { source: language || undefined }) : "";
              const tExcerpt = base.excerpt ? await api.translateText(tenantHost, token, base.excerpt, code, { source: language || undefined }) : "";
              const tBody = base.body ? await api.translateText(tenantHost, token, base.body, code, { source: language || undefined, html: true }) : "";
              merged = { ...merged, [code]: { title: tTitle, excerpt: tExcerpt, body: tBody } };
            } catch {
              // Leave that language's existing content untouched if its
              // re-translate call fails — a provider hiccup on one language
              // shouldn't block saving the rest.
            }
          }
          setTranslating(false);
        }
      }
      setContent(merged);
      const translations: Record<string, LangContent> = {};
      for (const [code, entry] of Object.entries(merged)) {
        if (code !== BASE_LANG) translations[code] = entry;
      }
      await api.updatePost(tenantHost, token, post.id as string, {
        title: base.title, excerpt: base.excerpt.trim() || autoExcerpt(base.body), categoryId: categoryId || null, tags, bannerImageUrl,
        body: base.body,
        translations,
        language: language || null,
        multilangEnabled,
        showTags: fromDisplayOverride(showTags),
        showCategory: fromDisplayOverride(showCategory),
        showAuthor: fromDisplayOverride(showAuthor),
        showPublishedDate: fromDisplayOverride(showPublishedDate),
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
      toast(t("posts-shared"));
    } catch (err) {
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
        {status === "published" ? (
          <a href={api.previewUrl(tenantHost, `posts/${post.slug as string}`)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-body hover:text-ink"><ExternalLink className="h-3.5 w-3.5" /> {t("posts-preview")}</a>
        ) : (
          <a href={api.previewUrl(tenantHost, `posts/${post.slug as string}`, previewToken ?? undefined)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-body hover:text-ink"><ExternalLink className="h-3.5 w-3.5" /> {t("posts-preview")}</a>
        )}
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
            <div>
              <EditorToolbar editor={editor} />
              <div className="rounded-b-lg border border-line/30 bg-white py-2 [&_.bn-editor]:min-h-[400px]">
                <BlockNoteView editor={editor} theme="light">
                  <SuggestionMenuController
                    triggerCharacter="@"
                    getItems={async (query) => {
                      try {
                        const results = await api.searchContent(tenantHost, token, query);
                        return results.map((r) => ({
                          title: r.title,
                          subtext: r.type === "post" ? t("posts-title") : t("pages-title"),
                          onItemClick: () => {
                            editor.insertBlocks(
                              [
                                {
                                  type: "bookmarkCard",
                                  props: {
                                    targetType: r.type,
                                    targetId: r.id,
                                    title: r.title,
                                    excerpt: r.excerpt ?? "",
                                    imageUrl: r.bannerImageUrl ?? "",
                                    url: r.url,
                                  },
                                },
                              ],
                              editor.getTextCursorPosition().block,
                              "after",
                            );
                          },
                        }));
                      } catch (err) {
                        setError((err as Error).message);
                        return [];
                      }
                    }}
                  />
                </BlockNoteView>
              </div>
            </div>
          </div>
        </div>
        {panelOpen && (
          <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-line/30 bg-canvas/30 p-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-category")}</label>
              <Select value={categoryId || "__none"} onValueChange={(v) => setCategoryId(v === "__none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("posts-category-none")}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-1.5 pt-1">
                <input className={inputCls} placeholder={t("posts-new-category")} value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void createCategoryInline()} />
                <button onClick={() => void createCategoryInline()} className={`${btnGhost} shrink-0`}>{t("categories-create")}</button>
              </div>
            </div>
            {siteMultilangEnabled && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-language")}</label>
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input type="checkbox" checked={multilangEnabled} onChange={(e) => setMultilangEnabled(e.target.checked)} />
                  {t("posts-multilang-enable")}
                </label>
                {multilangEnabled ? (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {siteLanguages.map((l) => {
                      const slotKey = l.code === language ? BASE_LANG : l.code;
                      const isCurrent = activeLang === slotKey;
                      const hasContent = Boolean(content[slotKey]);
                      const isBase = l.code === language;
                      return (
                        <button
                          key={l.code}
                          type="button"
                          disabled={isCurrent || translating}
                          onClick={() => clickLanguagePill(l.code)}
                          title={isBase ? t("posts-language-default-badge") : !language || hasContent ? undefined : t("posts-translate-btn")}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                            isBase ? "ring-2 ring-amber-400 ring-offset-1" : ""
                          } ${
                            isCurrent
                              ? "bg-accent text-white"
                              : hasContent
                                ? "bg-canvas text-ink hover:bg-[#e8e8ed]"
                                : "border border-dashed border-line/50 text-sub hover:border-accent hover:text-accent"
                          }`}
                        >
                          {isBase && "★ "}{l.label}{!isCurrent && !hasContent && (translating ? "…" : " +")}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Select value={language || "__none"} onValueChange={(v) => setLanguage(v === "__none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t("posts-language-none")}</SelectItem>
                      {siteLanguages.map((l) => (
                        <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-excerpt")}</label>
              <textarea rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder={t("posts-excerpt-auto")} className={`${inputCls} resize-none`} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-tags")}</label>
              <div
                className={`${inputCls} flex flex-wrap items-center gap-1`}
                onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
              >
                {tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-body">
                    {tag}
                    <button type="button" onClick={() => setTags((prev) => prev.filter((t2) => t2 !== tag))} className="text-sub hover:text-ink"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value.includes(",")) { setTagDraft(value); return; }
                    const [committed, rest] = [value.slice(0, value.lastIndexOf(",")), value.slice(value.lastIndexOf(",") + 1)];
                    const parts = committed.split(",").map((s) => s.trim()).filter(Boolean);
                    if (parts.length) setTags((prev) => [...new Set([...prev, ...parts])]);
                    setTagDraft(rest);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const value = tagDraft.trim();
                      if (value) setTags((prev) => [...new Set([...prev, value])]);
                      setTagDraft("");
                    } else if (e.key === "Backspace" && !tagDraft && tags.length) {
                      setTags((prev) => prev.slice(0, -1));
                    }
                  }}
                  onBlur={() => {
                    const value = tagDraft.trim();
                    if (value) setTags((prev) => [...new Set([...prev, value])]);
                    setTagDraft("");
                  }}
                  placeholder={tags.length ? "" : t("posts-tags")}
                  className="min-w-[60px] flex-1 border-0 bg-transparent text-xs outline-none"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("posts-show-meta")}</label>
              <MetaSwitch
                label={t("posts-show-tags")}
                checked={effectiveDisplay(showTags, theme ? theme.showPostTags !== "false" : true)}
                onChange={(v) => setShowTags(v ? "show" : "hide")}
              />
              <MetaSwitch
                label={t("posts-show-category")}
                checked={effectiveDisplay(showCategory, theme ? theme.showPostCategory !== "false" : true)}
                onChange={(v) => setShowCategory(v ? "show" : "hide")}
              />
              <MetaSwitch
                label={t("posts-show-author")}
                checked={effectiveDisplay(showAuthor, theme ? theme.showPostAuthor !== "false" : true)}
                onChange={(v) => setShowAuthor(v ? "show" : "hide")}
              />
              <MetaSwitch
                label={t("posts-show-date")}
                checked={effectiveDisplay(showPublishedDate, theme ? theme.showPostDate !== "false" : true)}
                onChange={(v) => setShowPublishedDate(v ? "show" : "hide")}
              />
            </div>
            {status === "published" && (<button onClick={() => void share()} className={`${btnGhost} w-full`}>{t("posts-share")}</button>)}
            {(post.authorEmail as string | null) && (<p className="text-[11px] text-sub">{t("posts-author")}: {post.authorEmail as string}</p>)}
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-sub hover:bg-canvas">
              <History className="h-3.5 w-3.5" /> {t("posts-history")}
            </button>
            {showHistory && (
              <PostHistory
                tenantHost={tenantHost}
                token={token}
                postId={post.id as string}
                onRestored={(restoredPost) => {
                  setPosts((prev) => prev?.map((p) => (p.id === restoredPost.id ? restoredPost : p)) ?? prev);
                  setBodyVersion((v) => v + 1);
                }}
              />
            )}
          </aside>
        )}
      </div>
      {showMediaPicker && (<MediaPickerModal tenantHost={tenantHost} token={token} onSelect={(url) => { setBannerImageUrl(url); setShowMediaPicker(false); }} onClose={() => setShowMediaPicker(false)} />)}
      {resyncPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { resyncPrompt.resolve([]); setResyncPrompt(null); }}>
          <div className="w-80 space-y-3 rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-ink">{t("posts-resync-title")}</p>
            <p className="text-xs text-sub">{t("posts-resync-desc")}</p>
            <div className="space-y-1.5">
              {resyncPrompt.langs.map((code) => (
                <label key={code} className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={resyncChecked.has(code)}
                    onChange={(e) => setResyncChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(code); else next.delete(code);
                      return next;
                    })}
                  />
                  {siteLanguages.find((l) => l.code === code)?.label ?? code}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { resyncPrompt.resolve([]); setResyncPrompt(null); }} className={btnGhost}>{t("posts-resync-skip-btn")}</button>
              <button type="button" onClick={() => { resyncPrompt.resolve(Array.from(resyncChecked)); setResyncPrompt(null); }} className={btnPrimary}>{t("posts-resync-save-btn")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
