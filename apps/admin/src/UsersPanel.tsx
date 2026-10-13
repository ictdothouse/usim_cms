import { Fragment, useCallback, useEffect, useState } from "react";
import { Users as UsersIcon, Pencil, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import type { Session } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT, inputCls, btnPrimary, btnGhost, card, FormError, PERMISSIONS, PERMISSION_LABEL_KEY } from "./App";

export default function UsersPanel({ token, onImpersonate }: { token: string; onImpersonate: (s: Session) => void }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<Record<string, unknown>>>([]);
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [entraObjectId, setEntraObjectId] = useState("");
  const [role, setRole] = useState<"webmaster" | "superadmin">("webmaster");
  const [tenantHosts, setTenantHosts] = useState<string[]>([]);
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPerms, setEditingPerms] = useState<string[]>([]);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editEntraObjectId, setEditEntraObjectId] = useState("");
  const [mfaResetReason, setMfaResetReason] = useState("");
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

  const refresh = useCallback(async () => {
    setUsers(await api.listPortalUsers(token));
    setRoles(await api.listPortalRoles(token));
    setTenants(await api.listPortalTenants(token));
  }, [token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPortalUser(token, {
        email,
        password,
        entraObjectId: entraObjectId.trim() || undefined,
        role,
        tenantHosts: tenantHosts.length ? tenantHosts : undefined,
        roleId: roleId || null,
      });
      setEmail("");
      setPassword("");
      setEntraObjectId("");
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
    setEditEntraObjectId((u.entraObjectId as string | null) ?? "");
    setMfaResetReason("");
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

  async function saveEditEntraObjectId(u: Record<string, unknown>) {
    try {
      await api.updatePortalUserEntraObjectId(token, u.id as string, editEntraObjectId.trim() || null);
      await refresh();
    } catch (err) {
      setEditError((err as Error).message);
    }
  }

  async function resetUserMfa(u: Record<string, unknown>) {
    if (mfaResetReason.trim().length < 10) return;
    if (!(await confirm(t("users-mfa-reset-confirm")))) return;
    try {
      await api.resetPortalUserMfa(token, u.id as string, mfaResetReason.trim());
      setMfaResetReason("");
      await refresh();
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
    if (!(await confirm(t("users-delete-confirm")))) return;
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
      <FormError>{error}</FormError>
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
          minLength={15}
        />
        <div className="flex min-w-56 flex-col gap-0.5">
          <label className="text-sm font-bold uppercase tracking-wider text-sub">{t("users-entra-object-id")}</label>
          <input
            className={`${inputCls} w-auto`}
            placeholder="00000000-0000-0000-0000-000000000000"
            value={entraObjectId}
            onChange={(e) => setEntraObjectId(e.target.value)}
            maxLength={36}
            aria-label={t("users-entra-object-id")}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-sm font-bold uppercase tracking-wider text-sub">{t("users-account-type")}</label>
          <Select value={role} onValueChange={(v) => setRole(v as "webmaster" | "superadmin")}>
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="webmaster">{t("role-webmaster-label")}</SelectItem>
              <SelectItem value="superadmin">{t("role-superadmin-label")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {role === "webmaster" && (
          <div className="flex flex-col gap-0.5">
            <label className="text-sm font-bold uppercase tracking-wider text-sub">{t("users-role")}</label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder={t("users-role-none")} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id as string} value={r.id as string}>
                    {r.name as string}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {role === "webmaster" && canMultiSite && (
          <div className="flex max-w-xs flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line/30 bg-white px-3 py-2 text-sm text-body">
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
          <Select
            value={tenantHosts[0] ?? ""}
            onValueChange={(v) => setTenantHosts(v ? [v] : [])}
          >
            <SelectTrigger className="w-auto">
              <SelectValue placeholder={t("content-pick")} />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((tn) => (
                <SelectItem key={tn.id as string} value={tn.host as string}>
                  {tn.departmentName as string} — {tn.host as string}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <button type="submit" className={btnPrimary}>
          {t("users-create")}
        </button>
      </form>
      <div className={`${card} overflow-x-auto`}>
        <table className="min-w-[50rem] w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line/30 bg-canvas text-sm font-bold uppercase tracking-wider text-sub">
              <th className="px-4 py-3">{t("users-email")}</th>
              <th className="px-4 py-3">{t("users-account-type")}</th>
              <th className="px-4 py-3">{t("users-tenant")}</th>
              <th className="px-4 py-3">{t("users-role")}</th>
              <th className="px-4 py-3">{t("users-extra-perms")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/20 text-sm text-ink">
            {users.map((u) => (
              <Fragment key={u.id as string}>
              <tr className="transition-colors hover:bg-canvas/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold uppercase text-accent">
                      {(u.email as string)[0]}
                    </div>
                    <span className="font-medium">{u.email as string}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-accent/10 px-2.5 py-1 text-sm font-bold uppercase tracking-wide text-accent">
                    {u.role as string}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-sm text-sub">
                  {((u.tenantHosts as string[] | null) ?? []).join(", ") || (u.tenantHost as string) || "—"}
                </td>
                <td className="px-4 py-3">
                  {u.role === "superadmin" ? (
                    <span className="text-sm text-sub">{t("cap-all")}</span>
                  ) : (
                    <Select value={(u.roleId as string | null) ?? "__none"} onValueChange={(v) => assignRole(u, v === "__none" ? "" : v)}>
                      <SelectTrigger className="text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t("users-role-none")}</SelectItem>
                        {roles.map((r) => (
                          <SelectItem key={r.id as string} value={r.id as string}>
                            {r.name as string}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.role === "webmaster" &&
                    (editingId === (u.id as string) ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {PERMISSIONS.map((perm) => (
                            <label key={perm} className="flex items-center gap-1 text-sm">
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
                            className="text-sm font-semibold text-accent hover:underline"
                          >
                            {t("media-save")}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-sm font-semibold text-sub hover:underline"
                          >
                            {t("media-cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-sub">
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
                          aria-label={t("media-edit")}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {u.role === "webmaster" && (
                      <button onClick={() => impersonate(u)} className="text-sm font-semibold text-accent hover:underline">
                        {t("users-impersonate")}
                      </button>
                    )}
                    <button
                      onClick={() => (editUserId === (u.id as string) ? setEditUserId(null) : openEditUser(u))}
                      className="text-sub hover:text-ink"
                      title={t("users-edit")}
                      aria-label={t("users-edit")}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
              {editUserId === (u.id as string) && (
                <tr key={`${u.id as string}-edit`} className="bg-canvas/40">
                  <td colSpan={6} className="space-y-3 px-4 py-4">
                    {editError && <p className="text-sm text-red-600">{editError}</p>}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-0.5">
                        <label className="text-sm font-bold uppercase tracking-wider text-sub">
                          {t("users-edit-password-label")}
                        </label>
                        <input
                          type="password"
                          className={`${inputCls} w-auto`}
                          placeholder={t("users-edit-password-placeholder")}
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          minLength={15}
                        />
                      </div>
                      <button
                        disabled={!editPassword.trim()}
                        onClick={() => void saveEditPassword(u)}
                        className={`${btnGhost} px-3 py-1.5 text-sm`}
                      >
                        {t("users-edit-save-password")}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-0.5">
                        <label className="text-sm font-bold uppercase tracking-wider text-sub">
                          {t("users-mfa-reset-reason")}
                        </label>
                        <input
                          className={`${inputCls} w-72`}
                          value={mfaResetReason}
                          onChange={(e) => setMfaResetReason(e.target.value)}
                          minLength={10}
                          maxLength={500}
                        />
                      </div>
                      <button
                        disabled={mfaResetReason.trim().length < 10}
                        onClick={() => void resetUserMfa(u)}
                        className={`${btnGhost} px-3 py-1.5 text-sm`}
                      >
                        {t("users-mfa-reset")}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-0.5">
                        <label className="text-sm font-bold uppercase tracking-wider text-sub">
                          {t("users-entra-object-id")}
                        </label>
                        <input
                          className={`${inputCls} w-auto`}
                          placeholder="00000000-0000-0000-0000-000000000000"
                          value={editEntraObjectId}
                          onChange={(e) => setEditEntraObjectId(e.target.value)}
                          maxLength={36}
                        />
                      </div>
                      <button onClick={() => void saveEditEntraObjectId(u)} className={`${btnGhost} px-3 py-1.5 text-sm`}>
                        {t("media-save")}
                      </button>
                    </div>
                    {u.role === "webmaster" && (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-sm font-bold uppercase tracking-wider text-sub">
                            {t("users-edit-sites-label")}
                          </label>
                          <div className="flex max-w-md flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line/30 bg-white px-3 py-2 text-sm text-body">
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
                        <button onClick={() => void saveEditTenantHosts(u)} className={`${btnGhost} px-3 py-1.5 text-sm`}>
                          {t("users-edit-save-sites")}
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => void removeUser(u)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
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
