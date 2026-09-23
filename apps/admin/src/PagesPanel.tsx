import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { FileText, Search, ExternalLink, Palette, Trash2, X } from "lucide-react";
import * as api from "@/lib/api";
import { slugify } from "@/lib/utils";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT, inputCls, btnGhost, card, FormError, ListLoading, ListEmpty, PAGE_SIZE, BlueprintGallery } from "./App";

const pagesCreateSchema = z.object({ title: z.string().trim().min(1, { message: "Required" }) });
type PagesCreateForm = z.infer<typeof pagesCreateSchema>;

// Sprint 4 UX audit: cheap pre-publish check — true once at least one
// element exists anywhere in the section/row/column tree.
function pageHasContent(p: Record<string, unknown>): boolean {
  const layout = (p.layout as Array<{ rows?: Array<{ columns?: Array<{ elements?: unknown[] }> }> }>) ?? [];
  return layout.some((s) => s.rows?.some((r) => r.columns?.some((c) => (c.elements?.length ?? 0) > 0)));
}

// Same one-liner id generator Designer.tsx/MenuItemsEditor.tsx already each
// have their own copy of (not importing Designer.tsx's module-private one).
const uid = () => Math.random().toString(36).slice(2, 10);

// A blueprint's layout (system-seeded via bootstrap-public.sql, or
// tenant-saved from a real page) carries its own element ids — cloning it
// verbatim onto a brand new page risks id collisions with Designer's
// id-keyed edit state (editingText/sliderSlideIdx/sliderInnerSel) the moment two pages
// sourced from the same blueprint are open at once. Deep-clones the layout
// and assigns every element a fresh id first. Section rows are checked in
// both places they appear across this codebase's blueprint data (nested
// under `props`, the shape Designer.tsx itself reads/writes, and as a
// sibling of `props`, the shape the seed SQL/BlueprintGallery's own preview
// already assume) so either source gets its ids refreshed correctly.
function refreshBlueprintIds(layout: unknown[]): unknown[] {
  const cloned = JSON.parse(JSON.stringify(layout ?? [])) as Array<Record<string, unknown>>;
  for (const section of cloned) {
    const props = section.props as Record<string, unknown> | undefined;
    const rows = (section.rows ?? props?.rows ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (typeof row.id === "string") row.id = uid();
      const columns = (row.columns ?? []) as Array<Record<string, unknown>>;
      for (const col of columns) {
        if (typeof col.id === "string") col.id = uid();
        const elements = (col.elements ?? []) as Array<Record<string, unknown>>;
        for (const el of elements) el.id = uid();
      }
    }
  }
  return cloned;
}

export default function PagesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [pages, setPages] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "published">("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showBlueprintPicker, setShowBlueprintPicker] = useState(false);
  const navigate = useNavigate();
  const form = useForm<PagesCreateForm>({ resolver: zodResolver(pagesCreateSchema), defaultValues: { title: "" } });

  async function refresh() {
    try {
      const { items, total: t2 } = await api.listPagesPage(tenantHost, token, {
        search, status: statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
      });
      setPages(items);
      setTotal(t2);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Debounced: a search keystroke shouldn't fire a request per character.
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void refresh(), search ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost, search, statusFilter, page]);

  // A new search/filter invalidates the current page offset.
  useEffect(() => {
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  // Quick-create: title only, straight into Designer — slug is auto-derived
  // (de-duplicated against existing slugs) and stays editable there
  // afterwards (see Designer.tsx's slug-rename field), not up front here.
  async function onCreate(values: PagesCreateForm) {
    const base = slugify(values.title) || "page";
    const existing = new Set(pages.map((p) => p.slug as string));
    let candidate = base;
    for (let n = 2; existing.has(candidate); n++) candidate = `${base}-${n}`;
    try {
      const item = await api.createPage(tenantHost, token, { slug: candidate, title: values.title });
      form.reset();
      await refresh();
      navigate(item.id as string);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // `window.prompt` is fine here: a single plain-text "what's the new page
  // called" step, not the repeated-JS-dialog pattern the "don't use
  // window.prompt" lesson elsewhere in this codebase actually concerns.
  async function applyBlueprint(bp: api.PageBlueprint) {
    const title = window.prompt(t("blueprints-name-prompt"));
    if (!title) return;
    const base = slugify(title) || "page";
    const existing = new Set(pages.map((p) => p.slug as string));
    let candidate = base;
    for (let n = 2; existing.has(candidate); n++) candidate = `${base}-${n}`;
    try {
      const item = await api.createPage(tenantHost, token, {
        slug: candidate,
        title,
        layout: refreshBlueprintIds(bp.layout),
        settings: bp.settings,
      });
      setShowBlueprintPicker(false);
      await refresh();
      navigate(item.id as string);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Draft/published visibility toggle (RLS-enforced, see
  // migrations/0007_pages_status.sql) — distinct from share(), which copies
  // the page into the cross-department portal pool.
  async function setStatus(p: Record<string, unknown>, status: "draft" | "published") {
    if (status === "published" && !pageHasContent(p)) {
      if (!(await confirm(t("prepublish-empty-page")))) return;
    }
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
      toast(t("pages-shared"));
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
    if (!(await confirm(t("pages-delete-confirm")))) return;
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
    <>
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <FileText className="h-4 w-4 text-accent" /> {t("pages-title")}
      </h2>
      <FormError>{error}</FormError>
      <Card>
        <CardContent className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreate)} className="flex gap-2">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input required placeholder={t("pages-name")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
                {form.formState.isSubmitting ? t("pages-creating") : t("pages-create")}
              </Button>
              <button
                type="button"
                onClick={() => setShowBlueprintPicker(true)}
                className="rounded-full border border-line/40 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
              >
                {t("blueprints-choose")}
              </button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sub" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("pages-search-placeholder")}
            className={`${inputCls} py-1.5 pl-8`}
          />
        </div>
        <Select value={statusFilter || "__all"} onValueChange={(v) => setStatusFilter(v === "__all" ? "" : (v as "draft" | "published"))}>
          <SelectTrigger className="w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("status-filter-all")}</SelectItem>
            <SelectItem value="draft">{t("pages-draft")}</SelectItem>
            <SelectItem value="published">{t("pages-published")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <ListLoading />
      ) : pages.length === 0 ? (
        <ListEmpty>{t("pages-empty")}</ListEmpty>
      ) : (
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
                  onClick={() => navigate(p.id as string)}
                  className="flex items-center gap-1 font-semibold text-accent hover:underline"
                >
                  <Palette className="h-3.5 w-3.5" /> {t("pages-design")}
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
                  aria-label={t("pages-delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
          </li>
          );
        })}
      </ul>
      )}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-sub">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={`${btnGhost} disabled:opacity-40`}>
            {t("pagination-prev")}
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            onClick={() => setPage((p) => (p + 1) * PAGE_SIZE < total ? p + 1 : p)}
            disabled={(page + 1) * PAGE_SIZE >= total}
            className={`${btnGhost} disabled:opacity-40`}
          >
            {t("pagination-next")}
          </button>
        </div>
      )}
    </section>
    {showBlueprintPicker && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBlueprintPicker(false)}>
        <div className="max-h-[85vh] w-[min(90vw,60rem)] overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold text-ink">{t("blueprints-choose")}</p>
            <button onClick={() => setShowBlueprintPicker(false)} aria-label={t("designer-close")}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <BlueprintGallery tenantHost={tenantHost} token={token} mode="picker" onUse={(bp) => void applyBlueprint(bp)} isSuper={false} />
        </div>
      </div>
    )}
    </>
  );
}
