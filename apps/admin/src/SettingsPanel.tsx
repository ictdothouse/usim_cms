import { useEffect, useState } from "react";
import { Check, Globe, ShieldCheck, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import type { Key } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT, inputCls, btnPrimary, btnGhost, card } from "./App";

// Common languages for the "add language" typeahead below — picking a
// suggestion fills both code and label at once so an author never has to
// hand-type an ISO code. Freeform code/label still works for anything not
// in this list (mirrors Designer.tsx's FontPickerInput: a curated list is a
// narrowing filter, not a closed enum).
const COMMON_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "zh", label: "Chinese" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "fil", label: "Filipino" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pa", label: "Punjabi" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "ur", label: "Urdu" },
  { code: "vi", label: "Vietnamese" },
];

// Upload quota card — reused for both the Global tab (tenantHost=null, edits
// the instance-wide default) and the Site tab (tenantHost=the selected
// site's host, edits that site's override only — blank fields there mean
// "inherit global", not zero). Superadmin-only either way (SettingsPanel's
// whole route is), so no permission check needed here beyond that.
function StorageLimitsCard({ token, tenantHost }: { token: string; tenantHost: string | null }) {
  const { t } = useT();
  const [limits, setLimits] = useState<api.StorageLimits>({ maxUploadFileSizeMb: null, maxTotalStorageMb: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    setMsg(null);
    const load = tenantHost === null ? api.getGlobalStorageLimits(token) : api.getTenantStorageLimitsOverride(token, tenantHost);
    void load.then(setLimits).catch((e) => setErr((e as Error).message));
  }, [token, tenantHost]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (tenantHost === null) await api.putGlobalStorageLimits(token, limits);
      else await api.putTenantStorageLimitsOverride(token, tenantHost, limits);
      setMsg(t("settings-storage-saved"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const numField = (key: keyof api.StorageLimits, label: string) => (
    <label className="block space-y-1">
      <span className="text-xs text-sub">{label}</span>
      <input
        type="number"
        min={1}
        className={inputCls}
        value={limits[key] ?? ""}
        onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value === "" ? null : Number(e.target.value) }))}
      />
    </label>
  );

  return (
    <div className={`${card} space-y-3 p-5`}>
      <h3 className="text-xs font-bold text-ink">{t("settings-storage-title")}</h3>
      <p className="text-xs text-sub">{t(tenantHost === null ? "settings-storage-desc-global" : "settings-storage-desc-site")}</p>
      <p className="text-[11px] italic text-sub">{t("settings-storage-blank-hint")}</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      <div className="grid grid-cols-2 gap-3">
        {numField("maxUploadFileSizeMb", t("settings-storage-max-file"))}
        {numField("maxTotalStorageMb", t("settings-storage-max-total"))}
      </div>
      <button onClick={() => void save()} disabled={busy} className={btnPrimary}>
        {busy ? t("settings-busy") : t("settings-storage-save-btn")}
      </button>
    </div>
  );
}

// ---------- Settings (superadmin: backup / restore / static export) ----------
export default function SettingsPanel({ token, tenants }: { token: string; tenants: Array<Record<string, unknown>> }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [settingsTab, setSettingsTab] = useState<"global" | "site">("global");
  const [host, setHost] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [langs, setLangs] = useState<api.SiteLanguage[]>([]);
  const [langErr, setLangErr] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [langSuggestOpen, setLangSuggestOpen] = useState(false);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyConnected, setProxyConnected] = useState(false);
  const [proxyErr, setProxyErr] = useState<string | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaErr, setMfaErr] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [entraEnabled, setEntraEnabledState] = useState(false);
  const [entraOnly, setEntraOnlyState] = useState(false);
  const [entraTenantId, setEntraTenantIdState] = useState("");
  const [entraClientId, setEntraClientIdState] = useState("");
  const [entraErr, setEntraErr] = useState<string | null>(null);
  const [entraBusy, setEntraBusy] = useState(false);
  const [switcherPosition, setSwitcherPosition] = useState<api.SwitcherPosition>("header");
  const [switcherStyle, setSwitcherStyle] = useState<api.SwitcherStyle>("text");
  const [switcherErr, setSwitcherErr] = useState<string | null>(null);
  const [switcherBusy, setSwitcherBusy] = useState(false);
  const [switcherMsg, setSwitcherMsg] = useState<string | null>(null);
  const [proxyTenants, setProxyTenants] = useState<Array<Record<string, unknown>>>(tenants);
  const [certUploadHost, setCertUploadHost] = useState<string | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [sslDomain, setSslDomain] = useState("");
  const [sslEmail, setSslEmail] = useState("");
  const [sslBusy, setSslBusy] = useState(false);
  const [sslErr, setSslErr] = useState<string | null>(null);
  const [sslMsg, setSslMsg] = useState<string | null>(null);
  const existingCodes = new Set(langs.map((l) => l.code));
  const langSuggestions = newLabel.trim()
    ? COMMON_LANGUAGES.filter(
        (l) => l.label.toLowerCase().includes(newLabel.trim().toLowerCase()) && !existingCodes.has(l.code),
      ).slice(0, 8)
    : [];

  function pickLanguageSuggestion(l: { code: string; label: string }) {
    setNewLabel(l.label);
    setNewCode(l.code);
    setCodeTouched(false);
    setLangSuggestOpen(false);
  }

  function onNewLabelChange(value: string) {
    setNewLabel(value);
    setLangSuggestOpen(true);
    if (codeTouched) return;
    const trimmed = value.trim().toLowerCase();
    const match =
      COMMON_LANGUAGES.find((l) => l.label.toLowerCase() === trimmed) ??
      COMMON_LANGUAGES.find((l) => l.label.toLowerCase().startsWith(trimmed));
    setNewCode(trimmed && match ? match.code : "");
  }

  function reloadLanguages() {
    void api.listPortalLanguages(token).then(setLangs).catch((e) => setLangErr((e as Error).message));
  }
  useEffect(reloadLanguages, [token]);

  function reloadProxySettings() {
    void api.getProxySettings(token).then((s) => {
      setProxyEnabled(s.enabled);
      setProxyConnected(s.connected);
    }).catch((e) => setProxyErr((e as Error).message));
  }
  useEffect(reloadProxySettings, [token]);
  useEffect(() => setProxyTenants(tenants), [tenants]);

  function reloadProxyTenants() {
    void api.listPortalTenants(token).then(setProxyTenants);
  }
  // Cert status (hasCustomCert/certExpiresAt) can change from another admin's
  // session or a previous one of this admin's own — refresh whenever this
  // panel becomes visible or the selected site changes, not only right after
  // this session's own upload/revert.
  useEffect(() => {
    if (settingsTab === "site") reloadProxyTenants();
  }, [settingsTab, host, token]);

  async function toggleProxyEnabled(enabled: boolean) {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.setProxyAutomationEnabled(token, enabled);
      reloadProxySettings();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  function reloadLoginSettings() {
    void api
      .getLoginSettings(token)
      .then((s) => {
        setMfaEnabled(s.mfaEnabled);
        setMfaRequired(s.mfaRequired);
        setEntraEnabledState(s.entraEnabled);
        setEntraOnlyState(s.entraOnly);
        setEntraTenantIdState(s.entraTenantId ?? "");
        setEntraClientIdState(s.entraClientId ?? "");
      })
      .catch((e) => setMfaErr((e as Error).message));
  }
  useEffect(reloadLoginSettings, [token]);

  async function toggleMfaEnabled(enabled: boolean) {
    setMfaErr(null);
    setMfaBusy(true);
    try {
      await api.setLoginSettings(token, { mfaEnabled: enabled });
      reloadLoginSettings();
    } catch (e) {
      setMfaErr((e as Error).message);
    } finally {
      setMfaBusy(false);
    }
  }

  async function toggleMfaRequired(required: boolean) {
    setMfaErr(null);
    setMfaBusy(true);
    try {
      await api.setLoginSettings(token, { mfaRequired: required });
      reloadLoginSettings();
    } catch (e) {
      setMfaErr((e as Error).message);
    } finally {
      setMfaBusy(false);
    }
  }

  async function toggleEntraEnabled(enabled: boolean) {
    setEntraErr(null);
    setEntraBusy(true);
    try {
      await api.setLoginSettings(token, { entraEnabled: enabled });
      reloadLoginSettings();
    } catch (e) {
      setEntraErr((e as Error).message);
    } finally {
      setEntraBusy(false);
    }
  }

  async function toggleEntraOnly(only: boolean) {
    setEntraErr(null);
    setEntraBusy(true);
    try {
      await api.setLoginSettings(token, { entraOnly: only });
      reloadLoginSettings();
    } catch (e) {
      setEntraErr((e as Error).message);
    } finally {
      setEntraBusy(false);
    }
  }

  async function saveEntraConfig() {
    setEntraErr(null);
    setEntraBusy(true);
    try {
      await api.setLoginSettings(token, {
        entraTenantId: entraTenantId.trim() || null,
        entraClientId: entraClientId.trim() || null,
      });
      reloadLoginSettings();
    } catch (e) {
      setEntraErr((e as Error).message);
    } finally {
      setEntraBusy(false);
    }
  }

  function reloadSwitcherSettings() {
    void api
      .getLanguageSwitcherSettings(token)
      .then((s) => {
        setSwitcherPosition(s.switcherPosition);
        setSwitcherStyle(s.switcherStyle);
      })
      .catch((e) => setSwitcherErr((e as Error).message));
  }
  useEffect(reloadSwitcherSettings, [token]);

  async function saveSwitcherSettings() {
    setSwitcherErr(null);
    setSwitcherMsg(null);
    setSwitcherBusy(true);
    try {
      await api.setLanguageSwitcherSettings(token, switcherPosition, switcherStyle);
      setSwitcherMsg(t("tenant-languages-saved"));
    } catch (e) {
      setSwitcherErr((e as Error).message);
    } finally {
      setSwitcherBusy(false);
    }
  }

  async function resyncProxy() {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      const res = await api.resyncProxy(token);
      if (!res.synced) setProxyErr(res.error ?? "Resync failed");
      reloadProxySettings();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function submitCertUpload() {
    if (!certUploadHost || !certFile || !keyFile) return;
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.uploadTenantCert(token, certUploadHost, certFile, keyFile);
      setCertUploadHost(null);
      setCertFile(null);
      setKeyFile(null);
      reloadProxyTenants();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function revertCert(host: string) {
    setProxyErr(null);
    setProxyBusy(true);
    try {
      await api.revertTenantCert(token, host);
      reloadProxyTenants();
    } catch (e) {
      setProxyErr((e as Error).message);
    } finally {
      setProxyBusy(false);
    }
  }

  async function issueSsl() {
    setSslErr(null);
    setSslMsg(null);
    setSslBusy(true);
    try {
      await api.issueSslCert(token, sslDomain.trim(), sslEmail.trim());
      setSslMsg(t("settings-ssl-success"));
    } catch (e) {
      setSslErr((e as Error).message);
    } finally {
      setSslBusy(false);
    }
  }

  async function addLanguage() {
    setLangErr(null);
    try {
      await api.createPortalLanguage(token, newCode.trim(), newLabel.trim());
      setNewCode("");
      setNewLabel("");
      setCodeTouched(false);
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function saveLanguageLabel(id: string, label: string) {
    if (!label.trim()) return;
    setLangErr(null);
    try {
      await api.updatePortalLanguage(token, id, { label: label.trim() });
      setLabelDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function toggleLanguageEnabled(id: string, enabled: boolean) {
    setLangErr(null);
    try {
      await api.updatePortalLanguage(token, id, { enabled });
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function removeLanguage(id: string) {
    if (!(await confirm(t("settings-languages-delete-confirm")))) return;
    setLangErr(null);
    try {
      await api.deletePortalLanguage(token, id);
      reloadLanguages();
    } catch (e) {
      setLangErr((e as Error).message);
    }
  }

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setMsg(null);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const sections: Array<{ key: string; title: Key; desc: Key; btn: Key; onClick: () => void }> = [
    {
      key: "backup",
      title: "settings-backup-title",
      desc: "settings-backup-desc",
      btn: "settings-backup-btn",
      onClick: () => void run("backup", () => api.downloadTenantBackup(token, host)),
    },
    {
      key: "static",
      title: "settings-static-title",
      desc: "settings-static-desc",
      btn: "settings-static-btn",
      onClick: () => void run("static", () => api.downloadStaticExport(token, host)),
    },
  ];

  function pickRestoreFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!(await confirm(t("settings-restore-confirm")))) return;
      void run("restore", async () => {
        await api.restoreTenantBackup(token, host, file);
        setMsg(t("settings-restore-done"));
      });
    };
    input.click();
  }

  const selectedTenant = proxyTenants.find((tn) => (tn.host as string) === host);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex w-fit gap-1 rounded-full bg-canvas p-0.5">
        {(["global", "site"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSettingsTab(tab)}
            className={`rounded-full px-4 py-1 text-[11px] font-semibold ${
              settingsTab === tab ? "bg-white text-ink shadow-sm" : "text-sub hover:text-ink"
            }`}
          >
            {t(tab === "global" ? "settings-tab-global" : "settings-tab-site")}
          </button>
        ))}
      </div>

      {settingsTab === "global" && (
        <>
          <StorageLimitsCard token={token} tenantHost={null} />
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="text-xs font-bold text-ink">{t("settings-languages-title")}</h3>
            <p className="text-xs text-sub">{t("settings-languages-desc")}</p>
            {langErr && <p className="text-xs text-red-600">{langErr}</p>}
            <div className="space-y-1.5">
              {langs.map((l) => {
                const isLastEnabled = l.enabled && langs.filter((x) => x.enabled).length === 1;
                const draft = labelDrafts[l.id] ?? l.label;
                const dirty = draft !== l.label;
                return (
                  <div key={l.id} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 font-mono text-[11px] text-sub">{l.code}</span>
                    <input
                      className={inputCls}
                      value={draft}
                      onChange={(e) => setLabelDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    />
                    {dirty && (
                      <button
                        onClick={() => void saveLanguageLabel(l.id, draft)}
                        title={t("settings-languages-save-btn")}
                        aria-label={t("settings-languages-save-btn")}
                        className="shrink-0 text-accent hover:text-ink"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-sub">
                      <input
                        type="checkbox"
                        checked={l.enabled}
                        onChange={(e) => void toggleLanguageEnabled(l.id, e.target.checked)}
                      />
                      {t("settings-languages-enabled")}
                    </label>
                    <button
                      onClick={() => void removeLanguage(l.id)}
                      disabled={isLastEnabled}
                      title={isLastEnabled ? t("settings-languages-last-enabled") : undefined}
                      className="shrink-0 text-sub hover:text-red-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-start gap-2 pt-1">
              <div className="relative flex-1">
                <input
                  className={inputCls}
                  placeholder={t("settings-languages-label-placeholder")}
                  value={newLabel}
                  onChange={(e) => onNewLabelChange(e.target.value)}
                  onFocus={() => setLangSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setLangSuggestOpen(false), 150)}
                />
                {langSuggestOpen && langSuggestions.length > 0 && (
                  <div className={`${card} absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-auto shadow-lg`}>
                    {langSuggestions.map((l) => (
                      <button
                        key={l.code}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickLanguageSuggestion(l);
                        }}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-ink hover:bg-canvas"
                      >
                        <span>{l.label}</span>
                        <span className="font-mono text-[10px] text-sub">{l.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className={`${inputCls} !w-20 shrink-0`}
                placeholder={t("settings-languages-code-placeholder")}
                value={newCode}
                onChange={(e) => {
                  setNewCode(e.target.value);
                  setCodeTouched(true);
                }}
              />
              <button
                onClick={() => void addLanguage()}
                disabled={!newCode.trim() || !newLabel.trim()}
                className={`${btnGhost} shrink-0`}
              >
                {t("settings-languages-add-btn")}
              </button>
            </div>
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-proxy-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-proxy-desc")}</p>
            {proxyErr && <p className="text-xs text-red-600">{proxyErr}</p>}
            <label className="flex items-center gap-2 text-xs font-medium text-ink">
              <input
                type="checkbox"
                checked={proxyEnabled}
                disabled={proxyBusy}
                onChange={(e) => void toggleProxyEnabled(e.target.checked)}
              />
              {t("settings-proxy-enable")}
            </label>
            <p className="text-xs text-sub">{t("settings-proxy-dns-reminder")}</p>
            {!proxyEnabled && <p className="text-xs text-sub">{t("settings-proxy-manual-hint")}</p>}
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-ssl-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-ssl-desc")}</p>
            {sslErr && <p className="text-xs text-red-600">{sslErr}</p>}
            {sslMsg && <p className="text-xs text-green-700">{sslMsg}</p>}
            <div className="flex flex-wrap gap-2">
              <input
                className={`${inputCls} !w-56`}
                placeholder={t("settings-ssl-domain-placeholder")}
                value={sslDomain}
                onChange={(e) => setSslDomain(e.target.value)}
              />
              <input
                className={`${inputCls} !w-56`}
                placeholder={t("settings-ssl-email-placeholder")}
                value={sslEmail}
                onChange={(e) => setSslEmail(e.target.value)}
              />
              <button
                onClick={() => void issueSsl()}
                disabled={sslBusy || !sslDomain.trim() || !sslEmail.trim()}
                className={btnGhost}
              >
                {sslBusy ? t("settings-ssl-busy") : t("settings-ssl-issue-btn")}
              </button>
            </div>
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-login-methods-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-login-methods-desc")}</p>
            {mfaErr && <p className="text-xs text-red-600">{mfaErr}</p>}
            <div className="space-y-2 rounded-lg border border-line/40 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink">{t("settings-login-password")}</span>
                <span className="text-sub">{t("settings-login-always-on")}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={mfaEnabled}
                    disabled={mfaBusy}
                    onChange={(e) => void toggleMfaEnabled(e.target.checked)}
                  />
                  {t("settings-login-mfa")}
                </label>
              </div>
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={mfaRequired}
                    disabled={mfaBusy || !mfaEnabled}
                    onChange={(e) => void toggleMfaRequired(e.target.checked)}
                  />
                  {t("settings-login-mfa-required")}
                </label>
              </div>
              {mfaRequired && <p className="text-xs text-sub">{t("settings-login-mfa-required-hint")}</p>}
            </div>
            {mfaEnabled && <p className="text-xs text-sub">{t("settings-login-mfa-hint")}</p>}
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-login-entra")}
            </h3>
            <p className="text-xs text-sub">{t("settings-entra-desc")}</p>
            {entraErr && <p className="text-xs text-red-600">{entraErr}</p>}
            <div className="space-y-2 rounded-lg border border-line/40 p-3">
              <label className="flex items-center gap-2 text-xs font-medium text-ink">
                <input
                  type="checkbox"
                  checked={entraEnabled}
                  disabled={entraBusy}
                  onChange={(e) => void toggleEntraEnabled(e.target.checked)}
                />
                {t("settings-entra-enable")}
              </label>
              {entraEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className={inputCls}
                      placeholder={t("settings-entra-tenant-id-placeholder")}
                      value={entraTenantId}
                      onChange={(e) => setEntraTenantIdState(e.target.value)}
                    />
                    <input
                      className={inputCls}
                      placeholder={t("settings-entra-client-id-placeholder")}
                      value={entraClientId}
                      onChange={(e) => setEntraClientIdState(e.target.value)}
                    />
                  </div>
                  <button onClick={() => void saveEntraConfig()} disabled={entraBusy} className={btnGhost}>
                    {t("settings-entra-save")}
                  </button>
                  <p className="text-[11px] text-sub">{t("settings-entra-secret-hint")}</p>
                  <label className="flex items-center gap-2 text-xs font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={entraOnly}
                      disabled={entraBusy}
                      onChange={(e) => void toggleEntraOnly(e.target.checked)}
                    />
                    {t("settings-entra-only")}
                  </label>
                  {entraOnly && <p className="text-[11px] text-amber-700">{t("settings-entra-only-warning")}</p>}
                </>
              )}
            </div>
          </div>
          <div className={`${card} space-y-3 p-5`}>
            <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
              <Globe className="h-3.5 w-3.5 text-accent" /> {t("settings-switcher-title")}
            </h3>
            <p className="text-xs text-sub">{t("settings-switcher-desc")}</p>
            {switcherErr && <p className="text-xs text-red-600">{switcherErr}</p>}
            {switcherMsg && <p className="text-xs text-green-700">{switcherMsg}</p>}
            <label className="block text-xs text-ink">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-languages-switcher-position")}</span>
              <select
                value={switcherPosition}
                onChange={(e) => setSwitcherPosition(e.target.value as api.SwitcherPosition)}
                className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
              >
                <option value="header">{t("switcher-pos-header")}</option>
                <option value="topbar">{t("switcher-pos-topbar")}</option>
                <option value="float">{t("switcher-pos-float")}</option>
                <option value="footer">{t("switcher-pos-footer")}</option>
              </select>
            </label>
            <label className="block text-xs text-ink">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-sub">{t("tenant-languages-switcher-style")}</span>
              <select
                value={switcherStyle}
                onChange={(e) => setSwitcherStyle(e.target.value as api.SwitcherStyle)}
                className="w-full rounded-md border border-line/30 px-2 py-1 text-xs"
              >
                <option value="text">{t("switcher-style-text")}</option>
                <option value="flag">{t("switcher-style-flag")}</option>
                <option value="shortform">{t("switcher-style-shortform")}</option>
              </select>
            </label>
            <button onClick={() => void saveSwitcherSettings()} disabled={switcherBusy} className={btnPrimary}>
              {switcherBusy ? t("settings-busy") : t("tenant-languages-save-btn")}
            </button>
          </div>
        </>
      )}

      {settingsTab === "site" && (
        <>
          <Select value={host} onValueChange={setHost}>
            <SelectTrigger>
              <SelectValue placeholder={t("settings-tenant")} />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((tn) => (
                <SelectItem key={tn.host as string} value={tn.host as string}>
                  {(tn.departmentName as string) || (tn.host as string)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err && <p className="text-xs text-red-600">{err}</p>}
          {msg && <p className="text-xs text-green-700">{msg}</p>}
          {host && <StorageLimitsCard key={host} token={token} tenantHost={host} />}
          {sections.map((s) => (
            <div key={s.key} className={`${card} space-y-2 p-5`}>
              <h3 className="text-xs font-bold text-ink">{t(s.title)}</h3>
              <p className="text-xs text-sub">{t(s.desc)}</p>
              <button disabled={!host || busy !== null} onClick={s.onClick} className={btnPrimary}>
                {busy === s.key ? t("settings-busy") : t(s.btn)}
              </button>
            </div>
          ))}
          <div className={`${card} space-y-2 p-5`}>
            <h3 className="text-xs font-bold text-ink">{t("settings-restore-title")}</h3>
            <p className="text-xs text-sub">{t("settings-restore-desc")}</p>
            <button disabled={!host || busy !== null} onClick={pickRestoreFile} className={btnPrimary}>
              {busy === "restore" ? t("settings-busy") : t("settings-restore-btn")}
            </button>
          </div>
          {proxyEnabled && host && (
            <div className={`${card} space-y-3 p-5`}>
              <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
                <ShieldCheck className="h-3.5 w-3.5 text-accent" /> {t("settings-proxy-title")}
              </h3>
              {proxyErr && <p className="text-xs text-red-600">{proxyErr}</p>}
              <div className="flex items-center gap-2 text-xs">
                <span className={proxyConnected ? "text-ok" : "text-red-600"}>
                  {proxyConnected ? t("settings-proxy-status-connected") : t("settings-proxy-status-disconnected")}
                </span>
                <button onClick={() => void resyncProxy()} disabled={proxyBusy} className={btnGhost}>
                  {proxyBusy ? t("settings-busy") : t("settings-proxy-resync-btn")}
                </button>
              </div>
              {selectedTenant && (
                <div className="space-y-2">
                  {(() => {
                    const tHost = selectedTenant.host as string;
                    const hasCustomCert = Boolean(selectedTenant.hasCustomCert);
                    const certExpiresAt = selectedTenant.certExpiresAt as string | null;
                    const expiringSoon =
                      hasCustomCert && Boolean(certExpiresAt) &&
                      new Date(certExpiresAt as string).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
                    return (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div>
                          <p className="font-mono text-ink">{tHost}</p>
                          <p className={expiringSoon ? "font-semibold text-amber-700" : "text-sub"}>
                            {hasCustomCert && certExpiresAt
                              ? `${t("settings-proxy-cert-custom")} — ${new Date(certExpiresAt).toLocaleDateString()}`
                              : t("settings-proxy-cert-auto")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {hasCustomCert && (
                            <button onClick={() => void revertCert(tHost)} disabled={proxyBusy} className={btnGhost}>
                              {t("settings-proxy-revert-btn")}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setCertUploadHost(certUploadHost === tHost ? null : tHost);
                              setCertFile(null);
                              setKeyFile(null);
                            }}
                            disabled={proxyBusy}
                            className={btnGhost}
                          >
                            {t("settings-proxy-upload-btn")}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              {certUploadHost && (
                <div className={`${card} space-y-2 border border-line p-3`}>
                  <p className="text-xs font-semibold text-ink">{certUploadHost}</p>
                  <label className="block text-xs text-sub">
                    {t("settings-proxy-upload-cert-file")}
                    <input
                      type="file"
                      accept=".crt,.pem,.cer"
                      onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                      className="mt-1 block text-xs"
                    />
                  </label>
                  <label className="block text-xs text-sub">
                    {t("settings-proxy-upload-key-file")}
                    <input
                      type="file"
                      accept=".key,.pem"
                      onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
                      className="mt-1 block text-xs"
                    />
                  </label>
                  <button
                    onClick={() => void submitCertUpload()}
                    disabled={proxyBusy || !certFile || !keyFile}
                    className={btnPrimary}
                  >
                    {proxyBusy ? t("settings-busy") : t("settings-proxy-upload-submit")}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
