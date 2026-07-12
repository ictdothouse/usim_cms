import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { Session } from "@/lib/api";

const SESSION_KEY = "usim_cms_session";

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

function LoginForm({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(email, password);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onLogin(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">USIM CMS Admin</h1>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Logging in..." : "Log in"}
        </button>
      </form>
    </div>
  );
}

function PagesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const [pages, setPages] = useState<Array<Record<string, unknown>>>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setPages(await api.getPages(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantHost]);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setBannerImageUrl(await api.uploadMedia(tenantHost, token, file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPage(tenantHost, token, { slug, title, ...(bannerImageUrl ? { bannerImageUrl } : {}) });
      setSlug("");
      setTitle("");
      setBannerImageUrl("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function publish(id: string) {
    try {
      await api.publishPage(tenantHost, token, id);
      alert("Published to portal");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Pages</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form onSubmit={create} className="space-y-2 rounded border bg-white p-3">
        <div className="flex gap-2">
          <input
            className="rounded border px-3 py-1.5 text-sm"
            placeholder="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
          <input
            className="flex-1 rounded border px-3 py-1.5 text-sm"
            placeholder="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <label className="block text-sm">
          Banner image
          <input type="file" accept="image/*" onChange={onFileChosen} className="mt-1 block text-sm" />
        </label>
        {uploading && <p className="text-xs text-slate-400">Uploading...</p>}
        {bannerImageUrl && <img src={api.API_URL + bannerImageUrl} alt="banner preview" className="h-20 rounded" />}
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          Create page
        </button>
      </form>
      <ul className="divide-y rounded border bg-white">
        {pages.map((p) => (
          <li key={p.id as string} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{p.title as string}</span>{" "}
              <span className="text-slate-400">/{p.slug as string}</span>
            </span>
            <button onClick={() => publish(p.id as string)} className="text-slate-600 underline">
              Publish to portal
            </button>
          </li>
        ))}
        {pages.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No pages yet.</li>}
      </ul>
    </section>
  );
}

function ThemePanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const [primaryColor, setPrimaryColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.getTheme(tenantHost, token).then((t) => {
      setPrimaryColor(t.primaryColor ?? "");
      setLogoUrl(t.logoUrl ?? "");
    });
  }, [tenantHost]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await api.putTheme(tenantHost, token, { primaryColor, logoUrl });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Design / Theme (this site)</h2>
      <p className="text-sm text-slate-500">
        Inherits superadmin's global defaults; anything set here overrides it for this site only.
      </p>
      <form onSubmit={save} className="max-w-sm space-y-2">
        <label className="block text-sm">
          Primary color
          <input
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#0a5c36"
          />
        </label>
        <label className="block text-sm">
          Logo URL
          <input
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
          />
        </label>
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          Save
        </button>
        {saved && <span className="ml-2 text-sm text-green-600">Saved</span>}
      </form>
    </section>
  );
}

function TenantsPanel({ token }: { token: string }) {
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [host, setHost] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setTenants(await api.listPortalTenants(token));
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPortalTenant(token, host, departmentName);
      setHost("");
      setDepartmentName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Tenants (Departments)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form onSubmit={create} className="flex gap-2">
        <input
          className="rounded border px-3 py-1.5 text-sm"
          placeholder="host, e.g. dept-c.usim.edu.my"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          required
        />
        <input
          className="flex-1 rounded border px-3 py-1.5 text-sm"
          placeholder="department name"
          value={departmentName}
          onChange={(e) => setDepartmentName(e.target.value)}
          required
        />
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          Register
        </button>
      </form>
      <ul className="divide-y rounded border bg-white">
        {tenants.map((t) => (
          <li key={t.id as string} className="flex justify-between px-3 py-2 text-sm">
            <span>{t.departmentName as string}</span>
            <span className="text-slate-400">
              {t.host as string} {t.active ? "" : "(suspended)"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UsersPanel({ token }: { token: string }) {
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"webmaster" | "superadmin">("webmaster");
  const [tenantHost, setTenantHost] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setUsers(await api.listPortalUsers(token));
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createPortalUser(token, { email, password, role, tenantHost: tenantHost || undefined });
      setEmail("");
      setPassword("");
      setTenantHost("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Users</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input
          className="rounded border px-3 py-1.5 text-sm"
          placeholder="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="rounded border px-3 py-1.5 text-sm"
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <select
          className="rounded border px-3 py-1.5 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value as "webmaster" | "superadmin")}
        >
          <option value="webmaster">webmaster</option>
          <option value="superadmin">superadmin</option>
        </select>
        {role === "webmaster" && (
          <input
            className="rounded border px-3 py-1.5 text-sm"
            placeholder="tenant host"
            value={tenantHost}
            onChange={(e) => setTenantHost(e.target.value)}
            required
          />
        )}
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          Create user
        </button>
      </form>
      <ul className="divide-y rounded border bg-white">
        {users.map((u) => (
          <li key={u.id as string} className="flex justify-between px-3 py-2 text-sm">
            <span>{u.email as string}</span>
            <span className="text-slate-400">
              {u.role as string} {u.tenantHost ? `· ${u.tenantHost as string}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GlobalThemePanel({ token }: { token: string }) {
  const [primaryColor, setPrimaryColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.getGlobalTheme(token).then((t) => {
      setPrimaryColor(t.primaryColor ?? "");
      setLogoUrl(t.logoUrl ?? "");
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await api.putGlobalTheme(token, { primaryColor, logoUrl });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Global Design (standard for all sites)</h2>
      <form onSubmit={save} className="max-w-sm space-y-2">
        <label className="block text-sm">
          Primary color
          <input
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Logo URL
          <input
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
          />
        </label>
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          Save
        </button>
        {saved && <span className="ml-2 text-sm text-green-600">Saved</span>}
      </form>
    </section>
  );
}

function PortalFeedPanel({ token }: { token: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void api.listPortalSharedContent(token).then(setItems);
  }, []);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Portal Feed (published from all departments)</h2>
      <ul className="divide-y rounded border bg-white">
        {items.map((i) => (
          <li key={i.id as string} className="px-3 py-2 text-sm">
            <a href={i.link as string} className="font-medium underline" target="_blank" rel="noreferrer">
              {i.title as string}
            </a>
            <span className="ml-2 text-slate-400">from {i.sourceHost as string}</span>
          </li>
        ))}
        {items.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Nothing published yet.</li>}
      </ul>
    </section>
  );
}

function WebmasterDashboard({ session }: { session: Session }) {
  const tenantHost = session.tenantHost!;
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <p className="text-sm text-slate-400">Managing: {tenantHost}</p>
      <PagesPanel tenantHost={tenantHost} token={session.token} />
      <ThemePanel tenantHost={tenantHost} token={session.token} />
    </div>
  );
}

const SUPERADMIN_TABS = ["Manage a site", "Tenants", "Users", "Global Design", "Portal Feed"] as const;

function SuperadminDashboard({ session }: { session: Session }) {
  const [tab, setTab] = useState<(typeof SUPERADMIN_TABS)[number]>("Manage a site");
  const [tenantHost, setTenantHost] = useState("");

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <nav className="flex gap-2 border-b pb-2 text-sm">
        {SUPERADMIN_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={t === tab ? "font-semibold text-slate-900" : "text-slate-400"}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Manage a site" && (
        <div className="space-y-8">
          <label className="block text-sm">
            Site (x-tenant-host)
            <input
              className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
              value={tenantHost}
              onChange={(e) => setTenantHost(e.target.value)}
              placeholder="dept-a.usim.edu.my"
            />
          </label>
          {tenantHost && (
            <>
              <PagesPanel tenantHost={tenantHost} token={session.token} />
              <ThemePanel tenantHost={tenantHost} token={session.token} />
            </>
          )}
        </div>
      )}
      {tab === "Tenants" && <TenantsPanel token={session.token} />}
      {tab === "Users" && <UsersPanel token={session.token} />}
      {tab === "Global Design" && <GlobalThemePanel token={session.token} />}
      {tab === "Portal Feed" && <PortalFeedPanel token={session.token} />}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  if (!session) return <LoginForm onLogin={setSession} />;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div>
          <span className="font-semibold text-slate-900">USIM CMS Admin</span>{" "}
          <span className="text-sm text-slate-400">({session.role})</span>
        </div>
        <button onClick={logout} className="text-sm text-slate-600 underline">
          Log out
        </button>
      </header>
      {session.role === "superadmin" ? (
        <SuperadminDashboard session={session} />
      ) : (
        <WebmasterDashboard session={session} />
      )}
    </div>
  );
}
