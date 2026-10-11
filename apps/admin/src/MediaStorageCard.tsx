import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import * as api from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import type { Key } from "@/i18n";
import { useT, inputCls, btnPrimary, btnGhost, card } from "./App";

// Settings > Storage (media-location phases 2-3): where uploads live (this
// server's disk or an S3-compatible bucket) plus the background media job.
// The public /uploads/<yyyy>/<mm>/<file> URL is the same either way, so
// switching never touches page content — the job only moves files.
const STEP_LABEL: Record<api.MediaProbeResult["steps"][number]["step"], Key> = {
  write: "settings-media-step-write",
  "public-read": "settings-media-step-public-read",
  delete: "settings-media-step-delete",
};
const KIND_LABEL: Record<api.MediaMigrationKind, Key> = {
  normalize: "settings-media-normalize-btn",
  "to-s3": "settings-media-to-s3-btn",
  "to-local": "settings-media-to-local-btn",
};
const STATE_LABEL: Record<api.MediaMigration["state"], Key> = {
  running: "settings-media-state-running",
  done: "settings-media-state-done",
  failed: "settings-media-state-failed",
};

export default function MediaStorageCard({ token }: { token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [view, setView] = useState<api.MediaStorageView | null>(null);
  const [driver, setDriver] = useState<"local" | "s3">("local");
  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [publicUrlBase, setPublicUrlBase] = useState("");
  const [forcePathStyle, setForcePathStyle] = useState(true);
  const [deleteSource, setDeleteSource] = useState(false);
  const [probe, setProbe] = useState<api.MediaProbeResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function apply(v: api.MediaStorageView) {
    setView(v);
    setDriver(v.config.driver);
    const s3 = v.config.s3;
    setEndpoint(s3?.endpoint ?? "");
    setBucket(s3?.bucket ?? "");
    setRegion(s3?.region ?? "");
    setAccessKeyId(s3?.accessKeyId ?? "");
    setSecret("");
    setPublicUrlBase(s3?.publicUrlBase ?? "");
    setForcePathStyle(s3?.forcePathStyle ?? true);
  }

  useEffect(() => {
    void api.getMediaStorage(token).then(apply).catch((e) => setErr((e as Error).message));
  }, [token]);

  // Poll only the job progress while it runs — never re-apply the form, that
  // would wipe whatever the user is typing.
  const running = view?.migration?.state === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      void api
        .getMediaStorage(token)
        .then((v) => setView((prev) => (prev ? { ...prev, migration: v.migration } : v)))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [running, token]);

  const s3Patch = (): api.MediaStorageS3Patch => ({
    endpoint: endpoint.trim(),
    bucket: bucket.trim(),
    region: region.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secret,
    publicUrlBase: publicUrlBase.trim(),
    forcePathStyle,
  });

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const test = () =>
    run("test", async () => {
      setProbe(null);
      setProbe(await api.testMediaStorage(token, s3Patch()));
    });

  // The s3 block rides along while "local" too (when filled) — the serve
  // route keeps redirecting to the bucket for files not yet brought back.
  const save = () =>
    run("save", async () => {
      apply(await api.setMediaStorage(token, { driver, s3: bucket.trim() ? s3Patch() : undefined }));
      setMsg(t("settings-media-saved"));
    });

  const migrate = (kind: api.MediaMigrationKind) =>
    run(kind, async () => {
      if (!(await confirm(t("settings-media-migrate-confirm")))) return;
      const { migration } = await api.startMediaMigration(token, kind, deleteSource);
      setView((prev) => (prev ? { ...prev, migration } : prev));
    });

  const hasS3 = Boolean(view?.config.s3);
  const m = view?.migration;

  return (
    <div className={`${card} space-y-3 p-5`}>
      <h3 className="text-xs font-bold text-ink">{t("settings-media-title")}</h3>
      <p className="text-xs text-sub">{t("settings-media-desc")}</p>
      {view?.source === "env" && <p className="text-[11px] italic text-sub">{t("settings-media-env-note")}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <select
        value={driver}
        onChange={(e) => setDriver(e.target.value as "local" | "s3")}
        className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
      >
        <option value="local">{t("settings-media-driver-local")}</option>
        <option value="s3">{t("settings-media-driver-s3")}</option>
      </select>
      {driver === "s3" && (
        <div className="space-y-2">
          <input className={inputCls} placeholder={t("settings-backup-s3-endpoint-placeholder")} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder={t("settings-backup-s3-bucket-placeholder")} value={bucket} onChange={(e) => setBucket(e.target.value)} />
            <input className={inputCls} placeholder={t("settings-backup-s3-region-placeholder")} value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
          <input className={inputCls} placeholder={t("settings-backup-s3-access-key-placeholder")} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
          <input
            type="password"
            className={inputCls}
            placeholder={view?.config.s3?.secretAccessKeySet ? t("settings-backup-s3-secret-key-set-placeholder") : t("settings-backup-s3-secret-key-placeholder")}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <input className={inputCls} placeholder={t("settings-media-public-url-placeholder")} value={publicUrlBase} onChange={(e) => setPublicUrlBase(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={forcePathStyle} onChange={(e) => setForcePathStyle(e.target.checked)} />
            {t("settings-media-path-style")}
          </label>
          <p className="text-[11px] text-sub">{t("settings-media-r2-hint")}</p>
          {probe && (
            <ul className="space-y-1 text-[11px]">
              {probe.steps.map((s) => (
                <li key={s.step} className={s.ok ? "text-green-700" : "text-red-600"}>
                  {s.ok ? <Check className="mr-1 inline h-3 w-3" /> : <X className="mr-1 inline h-3 w-3" />}
                  {t(STEP_LABEL[s.step])}
                  {s.error && <span className="block break-all pl-4 text-sub">{s.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {driver === "s3" && (
          <button onClick={() => void test()} disabled={busy !== null} className={btnGhost}>
            {busy === "test" ? t("settings-busy") : t("settings-media-test-btn")}
          </button>
        )}
        <button onClick={() => void save()} disabled={busy !== null} className={btnPrimary}>
          {busy === "save" ? t("settings-busy") : t("settings-media-save-btn")}
        </button>
      </div>

      <div className="space-y-2 border-t border-line/20 pt-3">
        <h4 className="text-xs font-bold text-ink">{t("settings-media-migrate-title")}</h4>
        <p className="text-xs text-sub">{t("settings-media-migrate-desc")}</p>
        {m && (
          <div className="space-y-1 rounded-md bg-surface p-2 text-[11px] text-ink">
            <p className="font-semibold">
              {t(KIND_LABEL[m.kind])} — {t(STATE_LABEL[m.state])}
            </p>
            <p>
              {t("settings-media-sites")}: {m.tenantsDone}/{m.tenantsTotal}
              {m.currentHost ? ` (${m.currentHost})` : ""}
            </p>
            <p>
              {t("settings-media-count-done")}: {m.done} ({(m.bytes / 1024 / 1024).toFixed(1)} MB) · {t("settings-media-count-skipped")}: {m.skipped} ·{" "}
              {t("settings-media-count-failed")}: {m.failed}
            </p>
            {m.errors.length > 0 && (
              <details>
                <summary className="cursor-pointer text-red-600">{t("settings-media-errors")}</summary>
                <ul className="mt-1 space-y-0.5 break-all text-sub">
                  {m.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="space-y-1">
          <button onClick={() => void migrate("normalize")} disabled={busy !== null || running} className={btnGhost}>
            {t("settings-media-normalize-btn")}
          </button>
          <p className="text-[11px] text-sub">{t("settings-media-normalize-desc")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void migrate("to-s3")} disabled={busy !== null || running || !hasS3} className={btnGhost}>
            {t("settings-media-to-s3-btn")}
          </button>
          <button onClick={() => void migrate("to-local")} disabled={busy !== null || running || !hasS3} className={btnGhost}>
            {t("settings-media-to-local-btn")}
          </button>
        </div>
        {!hasS3 && <p className="text-[11px] italic text-sub">{t("settings-media-no-s3")}</p>}
        <label className="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} />
          {t("settings-media-delete-source")}
        </label>
      </div>
    </div>
  );
}
