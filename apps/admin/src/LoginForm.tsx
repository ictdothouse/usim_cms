import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { Session } from "@/lib/api";
import { QrCode } from "@/components/QrCode";
import { useT, inputCls, btnPrimary, FormError, SESSION_KEY } from "./App";

// ---------- Login ----------
export default function LoginForm({ onLogin, entraError }: { onLogin: (s: Session) => void; entraError?: string | null }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once step 1 (password) succeeds but the account has TOTP enabled —
  // switches the form to the code-entry step instead of a second page/route.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Set instead of pendingToken when platformSettings.mfaRequired forced this
  // account into enrollment (no TOTP yet) — same pre-session login page, but
  // shows the QR/manual-key step first. Still just this one page: the
  // dashboard genuinely never loads until totpSetupVerify succeeds below.
  const [setupEnrollment, setSetupEnrollment] = useState<{ pendingToken: string; secret: string; otpauthUri: string } | null>(null);
  // Entra ID mode — fetched before anyone signs in (public route), so the
  // page knows which buttons/forms to show. entraOnly starts the password
  // form collapsed behind a disclosure link (superadmin break-glass path,
  // see apps/api/CLAUDE.md's Auth hardening section) rather than removing
  // it — the login page has no idea yet who's about to type into it.
  const [loginMethods, setLoginMethods] = useState<{ entraEnabled: boolean; entraOnly: boolean } | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(true);
  useEffect(() => {
    void api
      .getLoginMethods()
      .then((m) => {
        setLoginMethods(m);
        if (m.entraOnly) setShowPasswordForm(false);
      })
      .catch(() => setLoginMethods({ entraEnabled: false, entraOnly: false }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(email, password);
      if (result.mfaSetupRequired && result.pendingToken && result.secret && result.otpauthUri) {
        setSetupEnrollment({ pendingToken: result.pendingToken, secret: result.secret, otpauthUri: result.otpauthUri });
        return;
      }
      if (result.mfaRequired && result.pendingToken) {
        setPendingToken(result.pendingToken);
        return;
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(result.session));
      onLogin(result.session!);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.verifyTotp(pendingToken!, code);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onLogin(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitSetupCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.totpSetupVerify(setupEnrollment!.pendingToken, code);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onLogin(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const passwordFormVisible = !loginMethods?.entraOnly || pendingToken || setupEnrollment || showPasswordForm;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas font-sans text-ink antialiased">
      <div className="w-full max-w-sm space-y-3">
        {entraError && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {entraError === "account_not_found" ? t("login-entra-error-account-not-found") : t("login-entra-error-generic")}
          </p>
        )}
        {loginMethods?.entraEnabled && !pendingToken && !setupEnrollment && (
          <a href={api.entraLoginUrl()} className={`${btnPrimary} block w-full text-center`}>
            {t("login-entra-button")}
          </a>
        )}
        {loginMethods?.entraOnly && !pendingToken && !setupEnrollment && !showPasswordForm && (
          <button
            type="button"
            className="w-full text-center text-xs text-sub underline"
            onClick={() => setShowPasswordForm(true)}
          >
            {t("login-password-toggle")}
          </button>
        )}
        {passwordFormVisible && (
      <form
        onSubmit={setupEnrollment ? submitSetupCode : pendingToken ? submitCode : submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line/30 bg-white p-8 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
            U
          </div>
          <div>
            <h1 className="font-display text-sm font-bold tracking-tight">{t("login-title")}</h1>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
          </div>
        </div>
        {setupEnrollment ? (
          <>
            <p className="text-xs text-sub">{t("login-mfa-setup-desc")}</p>
            <div className="flex justify-center">
              <QrCode value={setupEnrollment.otpauthUri} />
            </div>
            <p className="text-xs text-sub">{t("security-mfa-scan-hint")}</p>
            <p className="rounded-lg border border-line/40 bg-canvas p-2 font-mono text-[11px] break-all">
              {setupEnrollment.secret}
            </p>
            <label className="sr-only" htmlFor="login-mfa-setup-code">{t("login-mfa-code")}</label>
            <input
              id="login-mfa-setup-code"
              className={inputCls}
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
              required
            />
            <FormError>{error}</FormError>
            <button type="submit" disabled={busy || code.length !== 6} className={`${btnPrimary} w-full`}>
              {busy ? t("login-busy") : t("login-mfa-setup-submit")}
            </button>
          </>
        ) : pendingToken ? (
          <>
            <p className="text-xs text-sub">{t("login-mfa-desc")}</p>
            <label className="sr-only" htmlFor="login-mfa-code">{t("login-mfa-code")}</label>
            <input
              id="login-mfa-code"
              className={inputCls}
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
              required
            />
            <FormError>{error}</FormError>
            <button type="submit" disabled={busy || code.length !== 6} className={`${btnPrimary} w-full`}>
              {busy ? t("login-busy") : t("login-mfa-submit")}
            </button>
            <button
              type="button"
              className="w-full text-center text-xs text-sub underline"
              onClick={() => {
                setPendingToken(null);
                setCode("");
                setError(null);
              }}
            >
              {t("login-mfa-back")}
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-sub">{t("login-desc")}</p>
            <label className="sr-only" htmlFor="login-email">{t("login-email")}</label>
            <input
              id="login-email"
              className={inputCls}
              type="email"
              autoComplete="email"
              placeholder={t("login-email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label className="sr-only" htmlFor="login-password">{t("login-password")}</label>
            <input
              id="login-password"
              className={inputCls}
              type="password"
              autoComplete="current-password"
              placeholder={t("login-password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <FormError>{error}</FormError>
            <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
              {busy ? t("login-busy") : t("login-submit")}
            </button>
          </>
        )}
      </form>
        )}
      </div>
    </div>
  );
}
