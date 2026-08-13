import { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import * as api from "@/lib/api";
import { useT, inputCls } from "./App";
import { Button } from "@/components/ui/button";

const uid = () => Math.random().toString(36).slice(2, 10);

function emptyItem(): api.MenuItem {
  return { id: uid(), label: "", linkType: "custom", url: "", target: "_self" };
}

export default function MenuItemsEditor({
  tenantHost,
  token,
  menu,
  onSaved,
}: {
  tenantHost: string;
  token: string;
  menu: api.Menu;
  onSaved: () => Promise<void>;
}) {
  const { t } = useT();
  const [items, setItems] = useState<api.MenuItem[]>(() => menu.items);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(fn: (draft: api.MenuItem[]) => api.MenuItem[]) {
    setItems((prev) => fn(prev));
    setDirty(true);
  }

  function addItem() {
    update((prev) => [...prev, emptyItem()]);
  }

  function removeItem(id: string) {
    update((prev) => prev.filter((it) => it.id !== id));
  }

  function moveItem(id: string, dir: -1 | 1) {
    update((prev) => {
      const idx = prev.findIndex((it) => it.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  }

  function patchItem(id: string, patch: Partial<api.MenuItem>) {
    update((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateMenu(tenantHost, token, menu.id, { items });
      setDirty(false);
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={item.id} className="space-y-2 rounded-lg border border-line/30 bg-white p-3">
            <div className="flex items-center gap-2">
              <input
                className={inputCls}
                placeholder={t("menus-item-label")}
                value={item.label}
                onChange={(e) => patchItem(item.id, { label: e.target.value })}
              />
              <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0} className="rounded p-1 text-body hover:bg-canvas disabled:opacity-30">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => moveItem(item.id, 1)} disabled={idx === items.length - 1} className="rounded p-1 text-body hover:bg-canvas disabled:opacity-30">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => removeItem(item.id)} className="rounded p-1 text-red-500 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={inputCls}
                value={item.linkType}
                onChange={(e) => patchItem(item.id, { linkType: e.target.value as api.MenuItem["linkType"], refId: undefined, url: "" })}
              >
                <option value="custom">{t("menus-link-custom")}</option>
                <option value="page">{t("menus-link-page")}</option>
                <option value="post">{t("menus-link-post")}</option>
                <option value="category">{t("menus-link-category")}</option>
              </select>
              {item.linkType === "custom" ? (
                <input
                  className={inputCls}
                  placeholder="/about or https://..."
                  value={item.url ?? ""}
                  onChange={(e) => patchItem(item.id, { url: e.target.value })}
                />
              ) : (
                <RefIdPicker
                  tenantHost={tenantHost}
                  token={token}
                  linkType={item.linkType}
                  value={item.refId}
                  onChange={(refId, title) => patchItem(item.id, { refId, label: item.label || title })}
                />
              )}
              <select
                className={inputCls}
                value={item.target ?? "_self"}
                onChange={(e) => patchItem(item.id, { target: e.target.value as "_self" | "_blank" })}
              >
                <option value="_self">{t("menus-target-self")}</option>
                <option value="_blank">{t("menus-target-blank")}</option>
              </select>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addItem}>
          <Plus className="h-3.5 w-3.5" /> {t("menus-add-item")}
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? t("menus-saving") : t("menus-save")}
        </Button>
      </div>
    </div>
  );
}

// Fetches the tenant's pages/posts/categories once and offers them as a
// <select> — reuses the same public list endpoints apps/frontend itself
// reads (no new backend route needed for this admin-only convenience).
function RefIdPicker({
  tenantHost,
  token,
  linkType,
  value,
  onChange,
}: {
  tenantHost: string;
  token: string;
  linkType: "page" | "post" | "category";
  value?: string;
  onChange: (refId: string, title: string) => void;
}) {
  const { t } = useT();
  const [options, setOptions] = useState<Array<{ id: string; title: string }>>([]);

  useState(() => {
    // Explicit per-type branching rather than a dynamic api[methodName] call
    // — keeps each fetch's real return type (Category has `name`, not
    // `title`) instead of erasing everything to a type-unsafe dynamic index.
    const load =
      linkType === "page"
        ? api.getPages(tenantHost, token).then((rows) => rows.map((r) => ({ id: r.id as string, title: r.title as string })))
        : linkType === "post"
          ? api.getPosts(tenantHost, token).then((rows) => rows.map((r) => ({ id: r.id as string, title: r.title as string })))
          : api.listCategories(tenantHost, token).then((rows) => rows.map((r) => ({ id: r.id, title: r.name })));
    void load.then(setOptions);
  });

  return (
    <select
      className={inputCls}
      value={value ?? ""}
      onChange={(e) => {
        const opt = options.find((o) => o.id === e.target.value);
        onChange(e.target.value, opt?.title ?? "");
      }}
    >
      <option value="" disabled>
        {t("menus-pick-item")}
      </option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </select>
  );
}
