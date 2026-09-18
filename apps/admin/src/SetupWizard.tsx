import { useState } from "react";
import * as api from "@/lib/api";
import type { Session } from "@/lib/api";
import { useT, inputCls, btnPrimary, FormError, SESSION_KEY } from "./App";

// ---------- Setup wizard (first-run only, see /api/setup) ----------
export default function SetupWizard({ onDone }: { onDone: (s: Session) => void }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.setup({
        email,
        password,
        host: host || undefined,
        departmentName: host ? departmentName : undefined,
      });
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onDone(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas font-sans text-ink antialiased">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line/30 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
            U
          </div>
          <div>
            <h1 className="font-display text-sm font-bold tracking-tight">{t("setup-title")}</h1>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
          </div>
        </div>
        <p className="text-xs text-sub">{t("setup-desc")}</p>
        <label className="sr-only" htmlFor="setup-email">{t("login-email")}</label>
        <input
          id="setup-email"
          className={inputCls}
          type="email"
          autoComplete="email"
          placeholder={t("login-email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label className="sr-only" htmlFor="setup-password">{t("login-password")}</label>
        <input
          id="setup-password"
          className={inputCls}
          type="password"
          autoComplete="new-password"
          placeholder={t("login-password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <label className="sr-only" htmlFor="setup-host">{t("setup-host")}</label>
        <input
          id="setup-host"
          className={inputCls}
          type="text"
          autoComplete="off"
          placeholder={t("setup-host")}
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        {host && (
          <>
            <label className="sr-only" htmlFor="setup-department">{t("setup-department")}</label>
            <input
              id="setup-department"
              className={inputCls}
              type="text"
              autoComplete="organization"
              placeholder={t("setup-department")}
              value={departmentName}
              onChange={(e) => setDepartmentName(e.target.value)}
              required
            />
          </>
        )}
        <FormError>{error}</FormError>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? t("setup-busy") : t("setup-submit")}
        </button>
      </form>
    </div>
  );
}
