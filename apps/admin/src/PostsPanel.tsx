import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Search, Newspaper, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import { slugify } from "@/lib/utils";
import { useConfirm } from "@/hooks/useConfirm";
import type { Key } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT, inputCls, btnGhost, card, FormError, ListLoading, ListEmpty, PAGE_SIZE } from "./App";

type PostStatus = "draft" | "published" | "private";

const postsCreateSchema = z.object({ title: z.string().trim().min(1, { message: "Required" }) });
type PostsCreateForm = z.infer<typeof postsCreateSchema>;

export default function PostsPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | PostStatus>("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const form = useForm<PostsCreateForm>({ resolver: zodResolver(postsCreateSchema), defaultValues: { title: "" } });
  const [categories, setCategories] = useState<api.Category[]>([]);
  useEffect(() => { void api.listCategories(tenantHost, token).then(setCategories); }, [tenantHost]);
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name;

  async function refresh() {
    try {
      const { items, total: t2 } = await api.listPostsPage(tenantHost, token, {
        search, status: statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
      });
      setPosts(items);
      setTotal(t2);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void refresh(), search ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost, search, statusFilter, page]);

  useEffect(() => {
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  // Quick-create: title only, straight into the writing view — slug is
  // auto-derived (de-duplicated against existing slugs), same pattern as
  // PagesPanel's quick-create (slug stays editable later via the same
  // pattern, if ever needed — not exposed yet since posts have no
  // Designer-equivalent slug-rename field today).
  async function onCreate(values: PostsCreateForm) {
    const base = slugify(values.title) || "post";
    const existing = new Set(posts.map((p) => p.slug as string));
    let candidate = base;
    for (let n = 2; existing.has(candidate); n++) candidate = `${base}-${n}`;
    try {
      const item = await api.createPost(tenantHost, token, { slug: candidate, title: values.title });
      form.reset();
      await refresh();
      navigate(item.id as string);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function share(id: string) {
    try {
      await api.sharePost(tenantHost, token, id);
      toast(t("posts-shared"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("posts-delete-confirm")))) return;
    try {
      await api.deletePost(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
          <Newspaper className="h-4 w-4 text-accent" /> {t("posts-title")}
        </h2>
        <Link to="categories" className="text-xs font-semibold text-accent hover:underline">{t("categories-title")}</Link>
      </div>
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
                {form.formState.isSubmitting ? t("pages-creating") : t("posts-create")}
              </Button>
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
            placeholder={t("posts-search-placeholder")}
            className={`${inputCls} py-1.5 pl-8`}
          />
        </div>
        <Select value={statusFilter || "__all"} onValueChange={(v) => setStatusFilter(v === "__all" ? "" : (v as PostStatus))}>
          <SelectTrigger className="w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("status-filter-all")}</SelectItem>
            <SelectItem value="draft">{t("posts-draft")}</SelectItem>
            <SelectItem value="published">{t("posts-published")}</SelectItem>
            <SelectItem value="private">{t("posts-private")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <ListLoading />
      ) : posts.length === 0 ? (
        <ListEmpty>{t("posts-empty")}</ListEmpty>
      ) : (
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
                  {categoryName(p.categoryId as string | null) && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                      {categoryName(p.categoryId as string | null)}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <button onClick={() => navigate(p.id as string)} className="font-semibold text-accent hover:underline">
                    {t("posts-edit")}
                  </button>
                  {status === "published" && (
                    <button onClick={() => share(p.id as string)} className="font-semibold text-body hover:underline">
                      {t("posts-share")}
                    </button>
                  )}
                  <button onClick={() => remove(p.id as string)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("pages-delete")} aria-label={t("pages-delete")}>
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
  );
}
