import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Globe, Pencil, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as api from "@/lib/api";
import { useT, inputCls, card } from "./App";
import { slugify } from "@/lib/utils";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const createSchema = z.object({ name: z.string().trim().min(1, { message: "Required" }) });
type CreateForm = z.infer<typeof createSchema>;

export default function CategoriesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // i18n follow-up — same site-wide master switch posts/pages already gate
  // their own translation UI behind (Settings ▸ Languages).
  const [siteLanguages, setSiteLanguages] = useState<api.SiteLanguage[]>([]);
  const [siteMultilangEnabled, setSiteMultilangEnabled] = useState(false);
  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { name: "" } });

  async function refresh() {
    try {
      setCategories(await api.listCategories(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    void api.getTenantLanguages(tenantHost, token).then((d) => {
      setSiteLanguages(d.allEnabled);
      setSiteMultilangEnabled(d.multilangEnabled);
    });
  }, [tenantHost]);

  async function toggleMultilang(c: api.Category) {
    try {
      await api.updateCategory(tenantHost, token, c.id, { multilangEnabled: !c.multilangEnabled });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCreate(values: CreateForm) {
    try {
      await api.createCategory(tenantHost, token, values.name, slugify(values.name));
      form.reset();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    try {
      await api.updateCategory(tenantHost, token, id, { name: trimmed });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("categories-delete-confirm")))) return;
    try {
      await api.deleteCategory(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/content/posts" className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("posts-title")}
      </Link>
      <h2 className="font-display text-sm font-semibold text-ink">{t("categories-title")}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Card>
        <CardContent className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreate)} className="flex gap-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input required placeholder={t("categories-name")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
                {form.formState.isSubmitting ? t("categories-creating") : t("categories-create")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <ul className={`${card} divide-y divide-line/20`}>
        {categories.map((c) => (
          <Fragment key={c.id}>
            <li className="flex items-center justify-between px-4 py-3 text-xs">
              {editingId === c.id ? (
                <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void rename(c.id)} autoFocus />
              ) : (
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="font-mono text-sub">/{c.slug}</span>
                </span>
              )}
              <span className="flex items-center gap-3">
                {siteMultilangEnabled && (
                  <button
                    onClick={() => void toggleMultilang(c)}
                    className={`rounded p-1 hover:bg-canvas ${c.multilangEnabled ? "text-accent" : "text-sub"}`}
                    title={t("categories-multilang-toggle")}
                  >
                    <Globe className="h-4 w-4" />
                  </button>
                )}
                {editingId === c.id ? (
                  <>
                    <Button size="sm" onClick={() => void rename(c.id)}>{t("categories-save")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t("categories-cancel")}</Button>
                  </>
                ) : (
                  <button onClick={() => { setEditingId(c.id); setEditName(c.name); }} className="rounded p-1 text-body hover:bg-canvas" title={t("categories-rename")}>
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => void remove(c.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("categories-delete")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </li>
            {siteMultilangEnabled && c.multilangEnabled && (
              <CategoryTranslations cat={c} tenantHost={tenantHost} token={token} siteLanguages={siteLanguages} onUpdated={refresh} />
            )}
          </Fragment>
        ))}
        {categories.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("categories-empty")}</li>}
      </ul>
    </section>
  );
}

// Per-category language pills: click an empty one to auto-translate `name`
// via /api/translate, click a filled one to edit it in place. Mirrors
// PostEditorPage's pill pattern, minus the base-language slot — a category
// has no separate "base" content, `name` itself always is the base.
function CategoryTranslations({
  cat,
  tenantHost,
  token,
  siteLanguages,
  onUpdated,
}: {
  cat: api.Category;
  tenantHost: string;
  token: string;
  siteLanguages: api.SiteLanguage[];
  onUpdated: () => Promise<void>;
}) {
  const { t } = useT();
  const [translating, setTranslating] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function ensureTranslation(code: string) {
    const existing = cat.translations[code];
    if (existing) {
      setEditingCode(code);
      setEditVal(existing.name);
      return;
    }
    setTranslating(code);
    setError(null);
    try {
      const translated = await api.translateText(tenantHost, token, cat.name, code);
      await api.updateCategory(tenantHost, token, cat.id, { translations: { ...cat.translations, [code]: { name: translated } } });
      await onUpdated();
      setEditingCode(code);
      setEditVal(translated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTranslating(null);
    }
  }

  async function saveEdit(code: string) {
    const trimmed = editVal.trim();
    if (!trimmed) return;
    try {
      await api.updateCategory(tenantHost, token, cat.id, { translations: { ...cat.translations, [code]: { name: trimmed } } });
      setEditingCode(null);
      await onUpdated();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-1.5 bg-canvas/60 px-4 py-2">
      {error && <span className="text-[11px] text-red-600">{error}</span>}
      {siteLanguages.map((l) => {
        const entry = cat.translations[l.code];
        if (editingCode === l.code) {
          return (
            <span key={l.code} className="flex items-center gap-1">
              <input
                className={`${inputCls} h-6 w-28 py-0 text-[11px]`}
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void saveEdit(l.code)}
                autoFocus
              />
              <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => void saveEdit(l.code)}>{t("categories-save")}</Button>
            </span>
          );
        }
        return (
          <button
            key={l.code}
            type="button"
            disabled={translating === l.code}
            onClick={() => void ensureTranslation(l.code)}
            title={entry ? t("categories-rename") : t("categories-translate-btn")}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50 ${
              entry ? "bg-canvas text-ink hover:bg-[#e8e8ed]" : "border border-dashed border-line/50 text-sub hover:border-accent hover:text-accent"
            }`}
          >
            {l.label}: {entry ? entry.name : translating === l.code ? "…" : "+"}
          </button>
        );
      })}
    </li>
  );
}
