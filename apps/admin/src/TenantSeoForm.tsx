import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import { useT, card, btnPrimary } from "./App";

// Native SEO + AEO — per-site override of the superadmin's global SEO
// defaults (title template / fallback description). GET already returns the
// effective (this site's own override, or the global default) value, and
// Save always writes back whatever's currently shown — same "no separate
// reset-to-inherit" convention TenantLanguagesForm's own switcherPosition/
// switcherStyle fields already use (see apps/api/CLAUDE.md's language-
// switcher-placement/style paragraph).
export default function TenantSeoForm({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [titleTemplate, setTitleTemplate] = useState("");
  const [defaultDescription, setDefaultDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    void api
      .getSeoDefaults(tenantHost, token)
      .then((d) => {
        setTitleTemplate(d.titleTemplate);
        setDefaultDescription(d.defaultDescription);
      })
      .catch((e) => setErr((e as Error).message));
  }, [tenantHost, token]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.putSeoDefaults(tenantHost, token, titleTemplate, defaultDescription);
      setMsg(t("tenant-languages-saved"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} max-w-md space-y-3 p-5`}>
      <h3 className="text-xs font-bold text-ink">{t("tenant-seo-title")}</h3>
      <p className="text-xs text-sub">{t("tenant-seo-desc")}</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <label className="block text-xs text-ink">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-seo-title-template")}</span>
        <input
          type="text"
          value={titleTemplate}
          onChange={(e) => setTitleTemplate(e.target.value)}
          placeholder="%s — Universiti Sains Islam Malaysia"
          className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
        />
        <span className="mt-1 block text-[10px] text-sub">{t("tenant-seo-title-template-hint")}</span>
      </label>
      <label className="block text-xs text-ink">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-seo-default-description")}</span>
        <textarea
          rows={3}
          value={defaultDescription}
          onChange={(e) => setDefaultDescription(e.target.value)}
          className="mt-1 w-full resize-none rounded-md border border-line/30 px-2 py-1 text-xs"
        />
      </label>
      <button onClick={() => void save()} disabled={busy} className={btnPrimary}>
        {busy ? t("settings-busy") : t("tenant-languages-save-btn")}
      </button>
    </div>
  );
}
