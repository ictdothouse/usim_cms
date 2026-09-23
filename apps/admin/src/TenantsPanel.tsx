import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Settings as SettingsIcon,
  Trash2,
  UploadCloud,
  Wrench,
} from "lucide-react";
import * as api from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT, inputCls, btnPrimary, btnGhost, card, FormError } from "./App";

// Staging tenants are createTenant'd with this exact department-name suffix
// (see CloneBox's stage action) — no separate DB column, so this is the one
// place that decides "is this a staging preview, not a real site".
const isStagingTenant = (tn: Record<string, unknown>) => (tn.departmentName as string).endsWith("(Staging)");

const tenantCreateSchema = z.object({
  host: z.string().trim().min(1, { message: "Required" }),
  departmentName: z.string().trim().min(1, { message: "Required" }),
});
type TenantCreateForm = z.infer<typeof tenantCreateSchema>;

export default function TenantsPanel({ token, setSiteHost }: { token: string; setSiteHost: (host: string) => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [usage, setUsage] = useState<Record<string, api.TenantUsage>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg] = useState<string | null>(null);
  const [manageHost, setManageHost] = useState<string | null>(null);
  const form = useForm<TenantCreateForm>({
    resolver: zodResolver(tenantCreateSchema),
    defaultValues: { host: "", departmentName: "" },
  });

  async function refresh() {
    setTenants(await api.listPortalTenants(token));
    // Best-effort, separate from the tenant list itself — a slow/failed
    // disk-size scan on one tenant shouldn't block the rest of the panel
    // from rendering.
    try {
      const rows = await api.getTenantsUsage(token);
      setUsage(Object.fromEntries(rows.map((r) => [r.host, r])));
    } catch {
      setUsage({});
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(values: TenantCreateForm) {
    try {
      await api.createPortalTenant(token, values.host, values.departmentName);
      form.reset();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const managed = tenants.find((tn) => tn.host === manageHost);
  if (managed) {
    const staging = isStagingTenant(managed);
    return (
      <section className="space-y-4">
        <button onClick={() => setManageHost(null)} className="flex items-center gap-1 text-xs font-semibold text-sub hover:text-ink">
          <ChevronRight className="h-3.5 w-3.5 rotate-180" /> {t("tenants-back")}
        </button>
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
          <Globe className="h-4 w-4 text-accent" /> {t("tenants-manage-title")}: {managed.departmentName as string}
        </h2>
        <FormError>{error}</FormError>
        {msg && <p className="text-xs text-green-700">{msg}</p>}
        <div className={`${card} space-y-2 p-5`}>
          <p className="font-mono text-xs text-sub">{managed.host as string}</p>
          <p className="text-xs text-sub">
            {staging ? (
              <span className="font-semibold text-amber-700">{t("tenants-clone-staging-tag")} · {t("tenants-preview-only")}</span>
            ) : managed.active ? (
              <span className="text-ok">Aktif</span>
            ) : (
              <span className="text-sub">{t("tenants-suspended")}</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {managed.maintenanceMode ? (
              // Same "window.open then async-mint then redirect" shape as
              // Designer's own draft preview (see preview() above) — the
              // bypass token has to come back from apps/api before the real
              // URL is known, so a plain <a href> can't be used here.
              <button
                onClick={async () => {
                  const win = window.open("", "_blank", "noreferrer");
                  if (!win) {
                    setError(t("designer-preview-blocked"));
                    return;
                  }
                  try {
                    const bypassToken = await api.getMaintenanceBypassToken(token, managed.host as string);
                    win.location.href = api.previewUrl(managed.host as string, "home", undefined, undefined, bypassToken);
                  } catch (err) {
                    win.close();
                    setError((err as Error).message);
                  }
                }}
                className={`${btnGhost} inline-flex items-center gap-1.5`}
              >
                <ExternalLink className="h-3.5 w-3.5" /> {t("tenants-view")}
              </button>
            ) : (
              <a
                href={api.previewUrl(managed.host as string, "home")}
                target="_blank"
                rel="noopener noreferrer"
                className={`${btnGhost} inline-flex items-center gap-1.5`}
              >
                <ExternalLink className="h-3.5 w-3.5" /> {t("tenants-view")}
              </a>
            )}
            <button
              onClick={() => {
                setSiteHost(managed.host as string);
                navigate("/content/pages");
              }}
              className={`${btnGhost} inline-flex items-center gap-1.5`}
            >
              <FileText className="h-3.5 w-3.5" /> {t("tenants-manage-content")}
            </button>
          </div>
        </div>
        {!staging && (
          <SiteOpsPanel
            token={token}
            host={managed.host as string}
            maintenanceMode={Boolean(managed.maintenanceMode)}
            onMaintenanceModeChange={(v) =>
              setTenants((prev) => prev.map((tn) => (tn.host === managed.host ? { ...tn, maintenanceMode: v } : tn)))
            }
          />
        )}
        {!staging && <CloneBox token={token} sourceHost={managed.host as string} onNewSite={refresh} />}
        <DangerZone
          token={token}
          host={managed.host as string}
          onDeleted={() => {
            setManageHost(null);
            void refresh();
          }}
        />
      </section>
    );
  }

  const stagingTenants = tenants.filter(isStagingTenant);
  const liveTenants = tenants.filter((tn) => !isStagingTenant(tn));

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Globe className="h-4 w-4 text-accent" /> {t("tenants-title")}
      </h2>
      <FormError>{error}</FormError>
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onCreate)} className="flex flex-col gap-2 sm:flex-row">
          <FormField
            control={form.control}
            name="host"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormControl>
                  <Input required placeholder={t("tenants-host")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="departmentName"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormControl>
                  <Input required placeholder={t("tenants-name")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
            {form.formState.isSubmitting ? t("settings-busy") : t("tenants-register")}
          </Button>
        </form>
      </Form>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {liveTenants.map((tn) => (
          <TenantCard
            key={tn.id as string}
            tn={tn}
            staging={false}
            usage={usage[tn.host as string]}
            onManage={() => setManageHost(tn.host as string)}
          />
        ))}
      </div>
      {stagingTenants.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {t("tenants-staging-section")}
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stagingTenants.map((tn) => (
              <TenantCard
                key={tn.id as string}
                tn={tn}
                staging
                usage={usage[tn.host as string]}
                onManage={() => setManageHost(tn.host as string)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// cPanel-style rough quota display — a glance metric, not billing-grade
// precision, so 3 significant figures is plenty.
function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

function TenantCard({
  tn,
  staging,
  usage,
  onManage,
}: {
  tn: Record<string, unknown>;
  staging: boolean;
  usage?: api.TenantUsage;
  onManage: () => void;
}) {
  const { t } = useT();
  return (
    <div className={`${card} p-5 ${staging ? "border-amber-300 bg-amber-50/60" : ""}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className={`rounded-lg p-2 ${staging ? "bg-amber-500/10 text-amber-600" : "bg-accent/5 text-accent"}`}>
          <Globe className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-1.5">
          {staging ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              {t("tenants-clone-staging-tag")} · {t("tenants-preview-only")}
            </span>
          ) : tn.active ? (
            <span className="flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-bold text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Aktif
            </span>
          ) : (
            <span className="rounded-full bg-sub/10 px-2 py-0.5 text-[10px] font-bold text-sub">{t("tenants-suspended")}</span>
          )}
        </div>
      </div>
      <h3 className="text-sm font-semibold leading-snug text-ink">{tn.departmentName as string}</h3>
      <p className="mt-1 truncate font-mono text-xs text-sub">{tn.host as string}</p>
      <p className="mt-1 text-[11px] text-sub">
        DB {formatBytes(usage?.dbSizeBytes ?? null)} · Storan {formatBytes(usage?.diskSizeBytes ?? null)}
      </p>
      <div className="mt-4 flex items-center gap-2">
        <a
          href={api.previewUrl(tn.host as string, "home")}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btnGhost} flex-1 justify-center inline-flex items-center gap-1.5 py-1.5`}
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t("tenants-view")}
        </a>
        <button
          onClick={onManage}
          className={`${btnPrimary} flex-1 justify-center inline-flex items-center gap-1.5 px-3 py-1.5`}
        >
          <SettingsIcon className="h-3.5 w-3.5" /> {t("tenants-manage")}
        </button>
      </div>
    </div>
  );
}

// ---------- Site ops (backup / restore / maintenance mode) ----------
function SiteOpsPanel({
  token,
  host,
  maintenanceMode,
  onMaintenanceModeChange,
}: {
  token: string;
  host: string;
  maintenanceMode: boolean;
  onMaintenanceModeChange: (v: boolean) => void;
}) {
  const { t } = useT();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(busyKey: string, fn: () => Promise<void>) {
    setError(null);
    setMsg(null);
    setBusyId(busyKey);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onRestoreFile(file: File) {
    if (!(await confirm(t("tenants-restore-confirm")))) return;
    await run("restore", async () => {
      const restored = await api.restoreTenantBackup(token, host, file);
      setMsg(`${t("tenants-restore-done")} (${restored})`);
    });
  }

  async function toggleMaintenance() {
    const next = !maintenanceMode;
    if (next && !(await confirm(t("tenants-maintenance-confirm")))) return;
    await run("maintenance", async () => {
      await api.setTenantMaintenanceMode(token, host, next);
      onMaintenanceModeChange(next);
    });
  }

  return (
    <div className={`${card} space-y-4 p-5`}>
      <FormError>{error}</FormError>
      {msg && <p className="text-xs text-green-700">{msg}</p>}

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-ink">{t("tenants-backup-title")}</h3>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busyId !== null}
            onClick={() => void run("db", () => api.downloadTenantBackup(token, host))}
            className={`${btnGhost} inline-flex items-center gap-1.5`}
          >
            <Download className="h-3.5 w-3.5" /> {busyId === "db" ? t("settings-busy") : t("tenants-backup-download-db")}
          </button>
          <button
            disabled={busyId !== null}
            onClick={() => void run("web", () => api.downloadStaticExport(token, host))}
            className={`${btnGhost} inline-flex items-center gap-1.5`}
          >
            <Download className="h-3.5 w-3.5" /> {busyId === "web" ? t("settings-busy") : t("tenants-backup-download-web")}
          </button>
        </div>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="text-xs font-bold text-ink">{t("tenants-restore-title")}</h3>
        <p className="text-xs text-sub">{t("tenants-restore-desc")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onRestoreFile(file);
          }}
        />
        <button
          disabled={busyId !== null}
          onClick={() => fileInputRef.current?.click()}
          className={`${btnGhost} inline-flex items-center gap-1.5`}
        >
          <UploadCloud className="h-3.5 w-3.5" /> {busyId === "restore" ? t("settings-busy") : t("tenants-restore-btn")}
        </button>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <Wrench className="h-3.5 w-3.5" /> {t("tenants-maintenance-title")}
        </h3>
        <p className="text-xs text-sub">{t("tenants-maintenance-desc")}</p>
        <button
          disabled={busyId !== null}
          onClick={() => void toggleMaintenance()}
          className={
            maintenanceMode
              ? "inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
              : `${btnGhost} inline-flex items-center gap-1.5`
          }
        >
          <Wrench className="h-3.5 w-3.5" />
          {busyId === "maintenance" ? t("settings-busy") : maintenanceMode ? t("tenants-maintenance-on") : t("tenants-maintenance-off")}
        </button>
      </div>
    </div>
  );
}

// ---------- Danger Zone (delete site, type-to-confirm) ----------
function DangerZone({ token, host, onDeleted }: { token: string; host: string; onDeleted: () => void }) {
  const { t } = useT();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setError(null);
    setBusy(true);
    try {
      await api.deletePortalTenant(token, host, confirmText);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-300 bg-red-50/60 p-5">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-700">
        <Trash2 className="h-3.5 w-3.5" /> {t("tenants-danger-zone")}
      </h3>
      <p className="text-xs text-red-700/80">{t("tenants-danger-desc")}</p>
      <p className="text-xs text-red-700">
        {t("tenants-danger-confirm-label")} <code className="rounded bg-red-100 px-1 font-mono">{host}</code>
      </p>
      <input
        className={`${inputCls} border-red-300`}
        placeholder={host}
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
      />
      <FormError>{error}</FormError>
      <button
        disabled={confirmText !== host || busy}
        onClick={() => void del()}
        className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" /> {busy ? t("settings-busy") : t("tenants-danger-delete-btn")}
      </button>
    </div>
  );
}

// ---------- Clone box (full / design-only clone, staging, promote) ----------
function CloneBox({ token, sourceHost, onNewSite }: { token: string; sourceHost: string; onNewSite: () => void }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [clones, setClones] = useState<api.CloneMeta[]>([]);
  const [type, setType] = useState<"full" | "design">("full");
  const [label, setLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setClones(await api.listClones(token, sourceHost));
  }
  useEffect(() => {
    void refresh();
  }, [sourceHost]);

  async function run(busyKey: string | null, fn: () => Promise<void>) {
    setError(null);
    setMsg(null);
    setBusyId(busyKey);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function stage(id: string) {
    await run(id, async () => {
      const { stagingHost } = await api.stageClone(token, id);
      setMsg(`${t("tenants-clone-staging-label")} ${stagingHost}`);
      await refresh();
    });
  }

  async function replace(stagingHost: string) {
    if (!(await confirm(t("tenants-clone-replace-confirm")))) return;
    await run(stagingHost, async () => {
      await api.replaceFromStaging(token, sourceHost, stagingHost);
      setMsg(t("tenants-clone-replace-done"));
    });
  }

  async function promote(id: string, suggestedHost?: string) {
    const newHost = window.prompt(t("tenants-clone-host-prompt"), suggestedHost ?? "");
    if (!newHost) return;
    const departmentName = window.prompt(t("tenants-clone-dept-prompt"));
    if (!departmentName) return;
    await run(id, async () => {
      const created = await api.promoteClone(token, id, newHost, departmentName);
      setMsg(`${t("tenants-clone-done")} ${created.host}`);
      onNewSite();
    });
  }

  async function remove(c: api.CloneMeta) {
    if (!(await confirm(c.stagingHost ? t("tenants-clone-delete-staged-confirm") : t("tenants-clone-delete-confirm")))) return;
    await run(c.id, async () => {
      await api.deletePortalClone(token, c.id);
      await refresh();
    });
  }

  return (
    <div className={`${card} space-y-3 p-5`}>
      <h3 className="text-xs font-bold text-ink">{t("tenants-clone-box-title")}</h3>
      <FormError>{error}</FormError>
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={type} onValueChange={(v) => setType(v as "full" | "design")}>
          <SelectTrigger className="sm:w-64 sm:shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">{t("tenants-clone-type-full")}</SelectItem>
            <SelectItem value="design">{t("tenants-clone-type-design")}</SelectItem>
          </SelectContent>
        </Select>
        <input
          className={inputCls}
          placeholder={t("tenants-clone-label-placeholder")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          disabled={busyId === "prepare"}
          onClick={() =>
            void run("prepare", async () => {
              await api.prepareClone(token, sourceHost, type, label || undefined);
              setLabel("");
              await refresh();
            })
          }
          className={`${btnPrimary} shrink-0 inline-flex items-center justify-center gap-1.5`}
        >
          <Copy className="h-3.5 w-3.5" /> {busyId === "prepare" ? t("settings-busy") : t("tenants-clone")}
        </button>
      </div>
      {clones.length === 0 && <p className="text-xs text-sub">{t("tenants-clone-empty")}</p>}
      <div className="space-y-2">
        {clones.map((c) => (
          <div
            key={c.id}
            className={`rounded-lg border p-3 text-xs ${
              c.stagingHost ? "border-amber-300 bg-amber-50" : "border-line/30"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">{c.label || (c.type === "full" ? t("tenants-clone-type-full") : t("tenants-clone-type-design"))}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    c.type === "full" ? "bg-accent/10 text-accent" : "bg-sub/10 text-sub"
                  }`}
                >
                  {c.type === "full" ? t("tenants-clone-type-full") : t("tenants-clone-type-design")}
                </span>
                {c.stagingHost && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    {t("tenants-clone-staging-tag")}
                  </span>
                )}
              </div>
              <span className="text-sub">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
            {c.stagingHost && <p className="mt-1 font-mono text-[11px] text-amber-700">{c.stagingHost}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                disabled={busyId === c.id}
                onClick={() => void run(c.id, () => api.downloadClone(token, c.id))}
                className={`${btnGhost} px-2.5 py-1`}
              >
                {t("tenants-clone-download")}
              </button>
              {c.stagingHost ? (
                <>
                  <a
                    href={api.previewUrl(c.stagingHost, "home")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${btnGhost} px-2.5 py-1`}
                  >
                    {t("tenants-view")}
                  </a>
                  <button
                    disabled={busyId === c.stagingHost}
                    onClick={() => void replace(c.stagingHost!)}
                    className={`${btnPrimary} px-2.5 py-1`}
                  >
                    {t("tenants-clone-replace")}
                  </button>
                </>
              ) : (
                <button disabled={busyId === c.id} onClick={() => void stage(c.id)} className={`${btnGhost} px-2.5 py-1`}>
                  {t("tenants-clone-stage")}
                </button>
              )}
              <button
                disabled={busyId === c.id}
                onClick={() => void promote(c.id, c.label)}
                className={`${btnGhost} px-2.5 py-1`}
              >
                {t("tenants-clone-newsite")}
              </button>
              <button
                disabled={busyId === c.id}
                onClick={() => void remove(c)}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" /> {t("tenants-clone-delete")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
