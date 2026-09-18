import { useEffect, useState } from "react";
import { ShieldCheck, Pencil, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { useT, inputCls, btnPrimary, card, FormError, PERMISSIONS, PERMISSION_LABEL_KEY } from "./App";

export default function RolesPanel({ token }: { token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
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
    if (!(await confirm(t("roles-delete-confirm")))) return;
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
      <FormError>{error}</FormError>
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
                    aria-label={t("media-edit")}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
              <button
                onClick={() => remove(r.id as string)}
                className="rounded p-1 text-red-500 hover:bg-red-50"
                title={t("roles-delete")}
                aria-label={t("roles-delete")}
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
