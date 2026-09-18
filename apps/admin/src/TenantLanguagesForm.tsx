import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import { useT, card, btnPrimary } from "./App";

// i18n Phase 2 — per-tenant enabled-language subset. Checking every box
// stores an empty override (inherit all globally-enabled languages
// dynamically); unchecking any box stores that explicit subset. Read-only
// for anyone without languages.write — Save just surfaces the server's 403
// rather than hiding the form (this codebase never hides UI based on a
// granted permission, only based on role — see theme.write's identical
// asymmetry above).
export default function TenantLanguagesForm({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [allEnabled, setAllEnabled] = useState<api.SiteLanguage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSwitcher, setShowSwitcher] = useState(false);
  // i18n Phase 5 — site-wide master switch, ticked first before any post/page
  // on this tenant may turn on its own multilangEnabled.
  const [multilangEnabled, setMultilangEnabled] = useState(false);
  // The language new posts/pages fall back to when their own Language field
  // is unset — "" = no default, matches the old "None" behavior.
  const [defaultLanguage, setDefaultLanguage] = useState("");
  const [switcherPosition, setSwitcherPosition] = useState<api.SwitcherPosition>("header");
  const [switcherStyle, setSwitcherStyle] = useState<api.SwitcherStyle>("text");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    void api
      .getTenantLanguages(tenantHost, token)
      .then((d) => {
        setAllEnabled(d.allEnabled);
        setSelected(new Set(d.selectedCodes ?? d.allEnabled.map((l) => l.code)));
        setShowSwitcher(d.showHeaderSwitcher);
        setMultilangEnabled(d.multilangEnabled);
        setDefaultLanguage(d.defaultLanguage ?? "");
        setSwitcherPosition(d.switcherPosition);
        setSwitcherStyle(d.switcherStyle);
      })
      .catch((e) => setErr((e as Error).message));
  }, [tenantHost, token]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function save() {
    if (selected.size === 0) {
      setErr(t("tenant-languages-need-one"));
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const codes = selected.size === allEnabled.length ? [] : Array.from(selected);
      // A default outside the persisted subset is dropped rather than sent —
      // avoids the server rejecting an otherwise-valid save over a stale pick.
      const effectiveDefault = defaultLanguage && selected.has(defaultLanguage) ? defaultLanguage : null;
      await api.putTenantLanguages(tenantHost, token, codes, showSwitcher, multilangEnabled, effectiveDefault, switcherPosition, switcherStyle);
      setMsg(t("tenant-languages-saved"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} max-w-md space-y-3 p-5`}>
      <h3 className="text-xs font-bold text-ink">{t("tenant-languages-title")}</h3>
      <p className="text-xs text-sub">{t("tenant-languages-desc")}</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <label className="flex items-center gap-2 rounded-md border border-line/30 bg-canvas/40 p-2 text-xs font-semibold text-ink">
        <input type="checkbox" checked={multilangEnabled} onChange={(e) => setMultilangEnabled(e.target.checked)} />
        {t("tenant-languages-multilang-enable")}
      </label>
      <div className={`space-y-1.5 ${multilangEnabled ? "" : "pointer-events-none opacity-40"}`}>
        {allEnabled.map((l) => (
          <label key={l.code} className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={selected.has(l.code)} onChange={() => toggle(l.code)} disabled={!multilangEnabled} />
            {l.label} <span className="font-mono text-[10px] text-sub">{l.code}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" checked={showSwitcher} onChange={(e) => setShowSwitcher(e.target.checked)} disabled={!multilangEnabled} />
          {t("tenant-languages-show-switcher")}
        </label>
        <label className="block pt-1 text-xs text-ink">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-languages-default-language")}</span>
          <select
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value)}
            disabled={!multilangEnabled}
            className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          >
            <option value="">{t("posts-language-none")}</option>
            {allEnabled.filter((l) => selected.has(l.code)).map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="block pt-1 text-xs text-ink">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-languages-switcher-position")}</span>
          <select
            value={switcherPosition}
            onChange={(e) => setSwitcherPosition(e.target.value as api.SwitcherPosition)}
            disabled={!multilangEnabled}
            className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          >
            <option value="header">{t("switcher-pos-header")}</option>
            <option value="topbar">{t("switcher-pos-topbar")}</option>
            <option value="float">{t("switcher-pos-float")}</option>
            <option value="footer">{t("switcher-pos-footer")}</option>
          </select>
        </label>
        <label className="block pt-1 text-xs text-ink">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-languages-switcher-style")}</span>
          <select
            value={switcherStyle}
            onChange={(e) => setSwitcherStyle(e.target.value as api.SwitcherStyle)}
            disabled={!multilangEnabled}
            className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
          >
            <option value="text">{t("switcher-style-text")}</option>
            <option value="flag">{t("switcher-style-flag")}</option>
            <option value="shortform">{t("switcher-style-shortform")}</option>
          </select>
        </label>
      </div>
      <button onClick={() => void save()} disabled={busy} className={btnPrimary}>
        {busy ? t("settings-busy") : t("tenant-languages-save-btn")}
      </button>
    </div>
  );
}
