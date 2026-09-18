import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import * as api from "@/lib/api";
import { QrCode } from "@/components/QrCode";
import { useT, card, inputCls, btnPrimary, btnGhost } from "./App";

// Personal MFA enrollment — reachable by any logged-in user regardless of
// role (a webmaster has no site-picker to reach SettingsPanel, but still
// needs to manage their own MFA), unlike the instance-wide switch in
// SettingsPanel's "Login Methods" card.
export default function SecurityPanel({ token }: { token: string }) {
  const { t } = useT();
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [enrolling, setEnrolling] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    void api.getMe(token).then((s) => setTotpEnabled(s.totpEnabled));
  }
  useEffect(reload, [token]);

  async function startEnroll() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      setEnrolling(await api.totpSetup(token));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.totpConfirm(token, code);
      setEnrolling(null);
      setCode("");
      setMsg(t("security-mfa-enabled-msg"));
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.totpDisable(token, code);
      setDisabling(false);
      setCode("");
      setMsg(t("security-mfa-disabled-msg"));
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-lg font-bold text-ink">{t("tab-security")}</h2>
      <div className={`${card} space-y-3 p-5`}>
        <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
          <KeyRound className="h-3.5 w-3.5 text-accent" /> {t("security-mfa-title")}
        </h3>
        <p className="text-xs text-sub">{t("security-mfa-desc")}</p>
        {err && <p className="text-xs text-red-600">{err}</p>}
        {msg && <p className="text-xs text-green-700">{msg}</p>}
        {totpEnabled ? (
          disabling ? (
            <form onSubmit={confirmDisable} className="space-y-2">
              <p className="text-xs text-sub">{t("security-mfa-disable-code-hint")}</p>
              <input
                className={inputCls}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
                required
              />
              <div className="flex gap-2">
                <button type="submit" disabled={busy || code.length !== 6} className={btnPrimary}>
                  {t("security-mfa-disable-btn")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDisabling(false);
                    setCode("");
                    setErr(null);
                  }}
                  className={btnGhost}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ok">{t("security-mfa-status-on")}</span>
              <button onClick={() => setDisabling(true)} disabled={busy} className={btnGhost}>
                {t("security-mfa-disable-btn")}
              </button>
            </div>
          )
        ) : enrolling ? (
          <form onSubmit={confirmEnroll} className="space-y-2">
            <div className="flex justify-center">
              <QrCode value={enrolling.otpauthUri} />
            </div>
            <p className="text-xs text-sub">{t("security-mfa-scan-hint")}</p>
            <p className="rounded-lg border border-line/40 bg-canvas p-2 font-mono text-[11px] break-all">
              {enrolling.secret}
            </p>
            <input
              className={inputCls}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy || code.length !== 6} className={btnPrimary}>
                {t("security-mfa-confirm-btn")}
              </button>
              <button type="button" onClick={() => setEnrolling(null)} className={btnGhost}>
                {t("cancel")}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-sub">{t("security-mfa-status-off")}</span>
            <button onClick={() => void startEnroll()} disabled={busy} className={btnPrimary}>
              {t("security-mfa-setup-btn")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
