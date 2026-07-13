import { createContext, useContext, useEffect, useState } from "react";
import {
  ChevronRight,
  FileText,
  Globe,
  Languages,
  Layers,
  LayoutDashboard,
  LogOut,
  Palette,
  Rss,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import * as api from "@/lib/api";
import type { Session } from "@/lib/api";
import { dict, type Key, type Lang } from "@/i18n";

const SESSION_KEY = "usim_cms_session";

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

// ---------- i18n ----------
const I18nCtx = createContext<{ lang: Lang; t: (k: Key) => string }>({
  lang: "ms",
  t: (k) => dict.ms[k],
});
const useT = () => useContext(I18nCtx);

// ---------- shared styles (prototype look) ----------
const inputCls =
  "w-full rounded-lg border border-line/30 bg-canvas px-3 py-2 text-xs text-ink outline-none transition-all focus:border-line focus:bg-white";
const btnPrimary =
  "rounded-full bg-accent px-5 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-full bg-canvas px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-[#e8e8ed]";
const card = "rounded-xl border border-line/40 bg-white";

// ---------- Login ----------
function LoginForm({ onLogin }: { onLogin: (s: Session) => void }) {
  const { t } = useT();
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
    <div className="flex min-h-screen items-center justify-center bg-canvas font-sans text-ink antialiased">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line/30 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
            U
          </div>
          <div>
            <h1 className="font-display text-sm font-bold tracking-tight">{t("login-title")}</h1>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
          </div>
        </div>
        <p className="text-xs text-sub">{t("login-desc")}</p>
        <input
          className={inputCls}
          type="email"
          placeholder={t("login-email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder={t("login-password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? t("login-busy") : t("login-submit")}
        </button>
      </form>
    </div>
  );
}

// ---------- Block builder (MVP: hero/text/image, up/down reorder) ----------
// ponytail: reorder via up/down buttons, not a drag lib — dnd-kit is the
// upgrade path if drag UX is actually wanted later.
interface Block {
  type: string;
  props: Record<string, string>;
}

const BLOCK_TYPES: Record<string, { label: string; fields: Array<{ key: string; label: string }> }> = {
  hero: {
    label: "Hero",
    fields: [
      { key: "title", label: "Title" },
      { key: "subtitle", label: "Subtitle" },
      { key: "imageUrl", label: "Image URL" },
    ],
  },
  text: {
    label: "Text",
    fields: [{ key: "content", label: "Content" }],
  },
  image: {
    label: "Image",
    fields: [
      { key: "imageUrl", label: "Image URL" },
      { key: "alt", label: "Alt text" },
    ],
  },
};

function BlockBuilder({
  page,
  tenantHost,
  token,
  onClose,
  onSaved,
}: {
  page: Record<string, unknown>;
  tenantHost: string;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [blocks, setBlocks] = useState<Block[]>(() => (page.layout as Block[] | undefined) ?? []);
  const [addType, setAddType] = useState("hero");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addBlock() {
    setBlocks([...blocks, { type: addType, props: {} }]);
  }

  function removeBlock(i: number) {
    setBlocks(blocks.filter((_, idx) => idx !== i));
  }

  function moveBlock(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  }

  function setField(i: number, key: string, value: string) {
    const next = [...blocks];
    next[i] = { ...next[i], props: { ...next[i].props, [key]: value } };
    setBlocks(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updatePage(tenantHost, token, page.id as string, { layout: blocks });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line/20 bg-canvas/60 p-4">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {blocks.length === 0 && <p className="text-xs text-sub">{t("blocks-empty")}</p>}
      {blocks.map((block, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line/30 bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">{BLOCK_TYPES[block.type]?.label ?? block.type}</span>
            <div className="flex gap-2 text-[11px]">
              <button onClick={() => moveBlock(i, -1)} disabled={i === 0} className="font-semibold text-accent disabled:opacity-30">
                {t("blocks-up")}
              </button>
              <button
                onClick={() => moveBlock(i, 1)}
                disabled={i === blocks.length - 1}
                className="font-semibold text-accent disabled:opacity-30"
              >
                {t("blocks-down")}
              </button>
              <button onClick={() => removeBlock(i)} className="font-semibold text-red-500">
                {t("blocks-remove")}
              </button>
            </div>
          </div>
          {(BLOCK_TYPES[block.type]?.fields ?? []).map((f) => (
            <label key={f.key} className="block text-[11px] font-medium text-body">
              {f.label}
              <input
                className={`${inputCls} mt-1`}
                value={block.props[f.key] ?? ""}
                onChange={(e) => setField(i, f.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border border-line/30 bg-white px-2 py-1.5 text-xs outline-none"
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
        >
          {Object.entries(BLOCK_TYPES).map(([key, bt]) => (
            <option key={key} value={key}>
              {bt.label}
            </option>
          ))}
        </select>
        <button onClick={addBlock} className={btnGhost}>
          {t("blocks-add")}
        </button>
        <span className="flex-1" />
        <button onClick={onClose} className="px-2 py-1 text-xs text-body">
          {t("blocks-close")}
        </button>
        <button onClick={save} disabled={saving} className={btnPrimary}>
          {saving ? t("blocks-saving") : t("blocks-save")}
        </button>
      </div>
    </div>
  );
}

// ---------- Pages ----------
function PagesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [pages, setPages] = useState<Array<Record<string, unknown>>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
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
      alert(t("pages-published"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("pages-delete-confirm"))) return;
    try {
      await api.deletePage(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <FileText className="h-4 w-4 text-accent" /> {t("pages-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className={`${card} space-y-3 p-4`}>
        <div className="flex gap-2">
          <input className={inputCls} placeholder={t("pages-slug")} value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <input className={inputCls} placeholder={t("pages-name")} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <label className="block text-xs font-medium text-body">
          {t("pages-banner")}
          <input type="file" accept="image/*" onChange={onFileChosen} className="mt-1 block text-xs" />
        </label>
        {uploading && <p className="text-[11px] text-sub">{t("uploading")}</p>}
        {bannerImageUrl && <img src={api.API_URL + bannerImageUrl} alt="banner preview" className="h-20 rounded-lg" />}
        <button type="submit" className={btnPrimary}>
          {t("pages-create")}
        </button>
      </form>
      <ul className={`${card} divide-y divide-line/20`}>
        {pages.map((p) => (
          <li key={p.id as string} className="px-4 py-3 text-xs">
            <div className="flex items-center justify-between">
              <span>
                <span className="font-semibold text-ink">{p.title as string}</span>{" "}
                <span className="font-mono text-sub">/{p.slug as string}</span>
              </span>
              <span className="flex items-center gap-3">
                <button
                  onClick={() => setEditingId(editingId === (p.id as string) ? null : (p.id as string))}
                  className="font-semibold text-accent hover:underline"
                >
                  {editingId === p.id ? t("pages-close") : t("pages-edit")}
                </button>
                <button onClick={() => publish(p.id as string)} className="font-semibold text-body hover:underline">
                  {t("pages-publish")}
                </button>
                <button
                  onClick={() => remove(p.id as string)}
                  className="rounded p-1 text-red-500 hover:bg-red-50"
                  title={t("pages-delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
            {editingId === p.id && (
              <div className="mt-3">
                <BlockBuilder
                  page={p}
                  tenantHost={tenantHost}
                  token={token}
                  onClose={() => setEditingId(null)}
                  onSaved={async () => {
                    setEditingId(null);
                    await refresh();
                  }}
                />
              </div>
            )}
          </li>
        ))}
        {pages.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("pages-empty")}</li>}
      </ul>
    </section>
  );
}

// ---------- Theme (shared form for per-site and global) ----------
function ThemeForm({
  title,
  desc,
  load,
  save,
}: {
  title: string;
  desc?: string;
  load: () => Promise<Record<string, string>>;
  save: (settings: Record<string, string>) => Promise<unknown>;
}) {
  const { t } = useT();
  const [primaryColor, setPrimaryColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void load().then((th) => {
      setPrimaryColor(th.primaryColor ?? "");
      setLogoUrl(th.logoUrl ?? "");
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await save({ primaryColor, logoUrl });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Palette className="h-4 w-4 text-accent" /> {title}
      </h2>
      {desc && <p className="text-xs text-sub">{desc}</p>}
      <form onSubmit={submit} className={`${card} max-w-sm space-y-3 p-4`}>
        <label className="block text-xs font-medium text-body">
          {t("theme-primary")}
          <input
            className={`${inputCls} mt-1`}
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#0a5c36"
          />
        </label>
        <label className="block text-xs font-medium text-body">
          {t("theme-logo")}
          <input className={`${inputCls} mt-1`} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
        </label>
        <button type="submit" className={btnPrimary}>
          {t("theme-save")}
        </button>
        {saved && <span className="ml-2 text-xs font-semibold text-ok">{t("theme-saved")}</span>}
      </form>
    </section>
  );
}

// ---------- Tenants (Multisite) ----------
function TenantsPanel({ token }: { token: string }) {
  const { t } = useT();
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
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Globe className="h-4 w-4 text-accent" /> {t("tenants-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
        <input className={inputCls} placeholder={t("tenants-host")} value={host} onChange={(e) => setHost(e.target.value)} required />
        <input
          className={inputCls}
          placeholder={t("tenants-name")}
          value={departmentName}
          onChange={(e) => setDepartmentName(e.target.value)}
          required
        />
        <button type="submit" className={`${btnPrimary} shrink-0`}>
          {t("tenants-register")}
        </button>
      </form>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tenants.map((tn) => (
          <div key={tn.id as string} className={`${card} p-5`}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="rounded-lg bg-accent/5 p-2 text-accent">
                <Globe className="h-5 w-5" />
              </div>
              {tn.active ? (
                <span className="flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-bold text-ok">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Aktif
                </span>
              ) : (
                <span className="rounded-full bg-sub/10 px-2 py-0.5 text-[10px] font-bold text-sub">{t("tenants-suspended")}</span>
              )}
            </div>
            <h3 className="text-sm font-semibold leading-snug text-ink">{tn.departmentName as string}</h3>
            <p className="mt-1 truncate font-mono text-xs text-sub">{tn.host as string}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Users ----------
function UsersPanel({ token }: { token: string }) {
  const { t } = useT();
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
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <UsersIcon className="h-4 w-4 text-accent" /> {t("users-title")}
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
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
        />
        <select
          className="rounded-lg border border-line/30 bg-white px-2 py-2 text-xs outline-none"
          value={role}
          onChange={(e) => setRole(e.target.value as "webmaster" | "superadmin")}
        >
          <option value="webmaster">webmaster</option>
          <option value="superadmin">superadmin</option>
        </select>
        {role === "webmaster" && (
          <input
            className={`${inputCls} w-auto`}
            placeholder={t("users-tenant")}
            value={tenantHost}
            onChange={(e) => setTenantHost(e.target.value)}
            required
          />
        )}
        <button type="submit" className={btnPrimary}>
          {t("users-create")}
        </button>
      </form>
      <div className={`${card} overflow-hidden`}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line/30 bg-canvas text-[10px] font-bold uppercase tracking-wider text-sub">
              <th className="px-4 py-3">{t("users-email")}</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Tenant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/20 text-xs text-ink">
            {users.map((u) => (
              <tr key={u.id as string} className="transition-colors hover:bg-canvas/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold uppercase text-accent">
                      {(u.email as string)[0]}
                    </div>
                    <span className="font-medium">{u.email as string}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-accent">
                    {u.role as string}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-sub">{(u.tenantHost as string) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Portal feed ----------
function PortalFeedPanel({ token }: { token: string }) {
  const { t } = useT();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    void api.listPortalSharedContent(token).then(setItems);
  }, []);
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <Rss className="h-4 w-4 text-accent" /> {t("feed-title")}
      </h2>
      <ul className={`${card} divide-y divide-line/20`}>
        {items.map((i) => (
          <li key={i.id as string} className="px-4 py-3 text-xs">
            <a href={i.link as string} className="font-semibold text-accent hover:underline" target="_blank" rel="noreferrer">
              {i.title as string}
            </a>
            <span className="ml-2 text-sub">
              {t("feed-from")} {i.sourceHost as string}
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("feed-empty")}</li>}
      </ul>
    </section>
  );
}

// ---------- Dashboard ----------
function MetricCard({ label, value, unit, icon }: { label: string; value: number | string; unit: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-canvas p-6 transition-transform duration-150 hover:scale-[1.01]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-sub">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">{icon}</div>
      </div>
      <div className="mt-4">
        <span className="text-3xl font-semibold tracking-tight text-ink">{value}</span>
        <span className="ml-2 text-xs text-sub">{unit}</span>
      </div>
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const { t } = useT();
  const [counts, setCounts] = useState<{ tenants?: number; users?: number; feed?: number; pages?: number }>({});

  useEffect(() => {
    if (session.role === "superadmin") {
      void api.listPortalTenants(session.token).then((x) => setCounts((c) => ({ ...c, tenants: x.length })));
      void api.listPortalUsers(session.token).then((x) => setCounts((c) => ({ ...c, users: x.length })));
      void api.listPortalSharedContent(session.token).then((x) => setCounts((c) => ({ ...c, feed: x.length })));
    } else if (session.tenantHost) {
      void api.getPages(session.tenantHost, session.token).then((x) => setCounts((c) => ({ ...c, pages: x.length })));
    }
  }, [session]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-canvas p-8">
        <div className="relative z-10 max-w-2xl">
          <span className="rounded-full bg-accent/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
            USIM CMS v1.0
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold leading-tight tracking-tight text-ink">{t("welcome-title")}</h2>
          <p className="mt-2 text-xs leading-relaxed text-sub">{t("welcome-desc")}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {session.role === "superadmin" ? (
          <>
            <MetricCard label={t("m-portals")} value={counts.tenants ?? "…"} unit={t("m-portals-unit")} icon={<Globe className="h-4 w-4 text-ok" />} />
            <MetricCard label={t("m-users")} value={counts.users ?? "…"} unit={t("m-users-unit")} icon={<UsersIcon className="h-4 w-4 text-accent" />} />
            <MetricCard label={t("m-feed")} value={counts.feed ?? "…"} unit={t("m-feed-unit")} icon={<Rss className="h-4 w-4 text-warn" />} />
          </>
        ) : (
          <MetricCard label={t("m-pages")} value={counts.pages ?? "…"} unit={t("m-pages-unit")} icon={<FileText className="h-4 w-4 text-accent" />} />
        )}
      </div>
    </div>
  );
}

// ---------- Shell (sidebar + header, prototype layout) ----------
type Tab = "dashboard" | "multisite" | "users" | "content" | "theme" | "global-theme" | "feed";

const TAB_META: Record<Tab, { labelKey: Key; icon: React.ComponentType<{ className?: string }> }> = {
  dashboard: { labelKey: "tab-dashboard", icon: LayoutDashboard },
  multisite: { labelKey: "tab-multisite", icon: Layers },
  users: { labelKey: "tab-users", icon: UsersIcon },
  content: { labelKey: "tab-content", icon: FileText },
  theme: { labelKey: "tab-theme", icon: Palette },
  "global-theme": { labelKey: "tab-global-theme", icon: Palette },
  feed: { labelKey: "tab-feed", icon: Rss },
};

function NavButton({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
  const { t } = useT();
  const { labelKey, icon: Icon } = TAB_META[tab];
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        active ? "bg-canvas text-accent" : "text-body hover:bg-canvas/60 hover:text-ink"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{t(labelKey)}</span>
    </button>
  );
}

function Shell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [lang, setLang] = useState<Lang>("ms");
  const t = (k: Key) => dict[lang][k];
  const isSuper = session.role === "superadmin";
  const [tab, setTab] = useState<Tab>("dashboard");
  // superadmin picks which site to manage in the content tab; webmaster is locked to theirs
  const [tenants, setTenants] = useState<Array<Record<string, unknown>>>([]);
  const [siteHost, setSiteHost] = useState<string>(session.tenantHost ?? "");

  useEffect(() => {
    if (isSuper) void api.listPortalTenants(session.token).then(setTenants);
  }, [isSuper, session.token]);

  const mainTabs: Tab[] = isSuper ? ["dashboard", "multisite", "users"] : ["dashboard"];
  const contentTabs: Tab[] = isSuper ? ["content", "global-theme", "feed"] : ["content", "theme"];

  return (
    <I18nCtx.Provider value={{ lang, t }}>
      <div className="flex h-screen overflow-hidden bg-canvas font-sans text-ink antialiased">
        {/* Sidebar */}
        <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line/50 bg-white">
          <div className="flex items-center gap-3 border-b border-line/30 p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-[#00c6ff] text-sm font-bold text-white shadow-sm">
              U
            </div>
            <div>
              <h1 className="font-display text-sm font-bold tracking-tight text-ink">USIM CMS</h1>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sub">{t("brand-sub")}</p>
            </div>
          </div>
          <nav className="flex-1 space-y-1.5 overflow-y-auto p-4">
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-main")}</div>
            {mainTabs.map((tb) => (
              <NavButton key={tb} tab={tb} active={tab === tb} onClick={() => setTab(tb)} />
            ))}
            <div className="mb-2 px-3 pt-4 text-[10px] font-bold uppercase tracking-wider text-sub">{t("nav-content")}</div>
            {contentTabs.map((tb) => (
              <NavButton key={tb} tab={tb} active={tab === tb} onClick={() => setTab(tb)} />
            ))}
          </nav>
          <div className="flex items-center gap-3 border-t border-line/30 bg-canvas/30 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold uppercase text-white">
              {session.role[0]}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-xs font-semibold capitalize text-ink">{session.role}</h4>
              {session.tenantHost && <p className="truncate text-[10px] text-sub">{session.tenantHost}</p>}
            </div>
            <button
              onClick={onLogout}
              className="rounded-full p-1.5 text-sub transition-colors hover:bg-canvas hover:text-ink"
              title={t("logout")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex h-screen flex-1 flex-col overflow-hidden bg-white">
          <header className="flex shrink-0 items-center justify-between border-b border-line/40 bg-white px-8 py-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-sub">{t("header-workspace")}</span>
              <ChevronRight className="h-3.5 w-3.5 text-line" />
              <span className="flex items-center gap-1.5 rounded-full border border-line/30 bg-canvas px-2.5 py-0.5 text-xs font-bold text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {t(TAB_META[tab].labelKey)}
              </span>
              <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
                {session.role}
              </span>
            </div>
            <div className="flex shrink-0 rounded-lg border border-line/50 bg-canvas p-0.5">
              {(["ms", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`flex items-center gap-1 rounded px-3 py-1 text-[10px] transition-all ${
                    lang === l ? "bg-white font-semibold text-ink shadow-sm" : "font-medium text-sub hover:text-ink"
                  }`}
                >
                  <Languages className="h-3 w-3 text-accent" /> {l.toUpperCase()}
                </button>
              ))}
            </div>
          </header>

          <main className="flex-1 overflow-y-auto bg-white p-8">
            <div className="mx-auto max-w-7xl space-y-6 pb-10">
              {tab === "dashboard" && <Dashboard session={session} />}
              {tab === "multisite" && isSuper && <TenantsPanel token={session.token} />}
              {tab === "users" && isSuper && <UsersPanel token={session.token} />}
              {tab === "content" && (
                <div className="space-y-6">
                  {isSuper && (
                    <div className="max-w-sm space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-sub">{t("content-site")}</label>
                      <select
                        className="w-full rounded-lg border border-line/30 bg-white px-3 py-2 text-xs outline-none"
                        value={siteHost}
                        onChange={(e) => setSiteHost(e.target.value)}
                      >
                        <option value="">{t("content-pick")}</option>
                        {tenants.map((tn) => (
                          <option key={tn.id as string} value={tn.host as string}>
                            {tn.departmentName as string} — {tn.host as string}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {siteHost && (
                    <>
                      <PagesPanel tenantHost={siteHost} token={session.token} />
                      {isSuper && (
                        <ThemeForm
                          key={siteHost}
                          title={t("theme-title")}
                          desc={t("theme-desc")}
                          load={() => api.getTheme(siteHost, session.token)}
                          save={(s) => api.putTheme(siteHost, session.token, s)}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
              {tab === "theme" && !isSuper && session.tenantHost && (
                <ThemeForm
                  title={t("theme-title")}
                  desc={t("theme-desc")}
                  load={() => api.getTheme(session.tenantHost!, session.token)}
                  save={(s) => api.putTheme(session.tenantHost!, session.token, s)}
                />
              )}
              {tab === "global-theme" && isSuper && (
                <ThemeForm title={t("gtheme-title")} load={() => api.getGlobalTheme(session.token)} save={(s) => api.putGlobalTheme(session.token, s)} />
              )}
              {tab === "feed" && isSuper && <PortalFeedPanel token={session.token} />}
            </div>
          </main>
        </div>
      </div>
    </I18nCtx.Provider>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  if (!session) return <LoginForm onLogin={setSession} />;
  return <Shell session={session} onLogout={logout} />;
}
