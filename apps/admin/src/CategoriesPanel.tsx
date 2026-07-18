import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import { useT, inputCls, btnPrimary, btnGhost, card } from "./App";
import { slugify } from "@/lib/utils";

export default function CategoriesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCategories(await api.listCategories(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { void refresh(); }, [tenantHost]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await api.createCategory(tenantHost, token, trimmed, slugify(trimmed));
      setName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function rename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    try {
      await api.updateCategory(tenantHost, token, id, trimmed);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("categories-delete-confirm"))) return;
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
      <form onSubmit={create} className={`${card} flex gap-2 p-4`}>
        <input className={inputCls} placeholder={t("categories-name")} value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" disabled={creating} className={`${btnPrimary} shrink-0`}>
          {creating ? t("categories-creating") : t("categories-create")}
        </button>
      </form>
      <ul className={`${card} divide-y divide-line/20`}>
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-xs">
            {editingId === c.id ? (
              <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void rename(c.id)} autoFocus />
            ) : (
              <span className="flex items-center gap-2">
                <span className="font-semibold text-ink">{c.name}</span>
                <span className="font-mono text-sub">/{c.slug}</span>
              </span>
            )}
            <span className="flex items-center gap-3">
              {editingId === c.id ? (
                <>
                  <button onClick={() => void rename(c.id)} className={btnPrimary}>{t("categories-save")}</button>
                  <button onClick={() => setEditingId(null)} className={btnGhost}>{t("categories-cancel")}</button>
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
        ))}
        {categories.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("categories-empty")}</li>}
      </ul>
    </section>
  );
}
