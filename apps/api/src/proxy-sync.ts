import { X509Certificate } from "node:crypto";
import http from "node:http";

// Bundled Caddy proxy's Admin API — reachable only on the docker-internal
// network (never published to the host, see docker-compose.yml's proxy
// service) or a bare-metal Caddy's own localhost listener. Unset means this
// deployment has no Caddy to talk to; every network function below fails
// closed in that case, which is the expected state for local dev and
// bare-metal installs (see CLAUDE.md's Non-goals for this feature).
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL;
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? "admin.localhost";
const API_DOMAIN = process.env.API_DOMAIN ?? "api.localhost";
// 5s was too tight for /load specifically — pushing a full config makes Caddy
// synchronously validate/apply it (and reload TLS state for every tenant
// domain), which can legitimately run past 5s under load; deploy.sh's own
// promote() now also retries on top of this, but a config push shouldn't
// fail on ordinary momentary slowness in the first place.
const TIMEOUT_MS = 15000;

// Fallback dial targets for the plain single-stack setup (no blue-green
// deploy in use) — one container each, matching docker-compose.yml's
// service names. A blue-green deploy (scripts/deploy.sh) always passes its
// own CaddyUpstreams explicitly instead of relying on these.
const DEFAULT_ADMIN_UPSTREAM = process.env.ADMIN_UPSTREAM ?? "admin:80";
const DEFAULT_API_UPSTREAM = process.env.API_UPSTREAM ?? "api:3000";
const DEFAULT_FRONTEND_UPSTREAM = process.env.FRONTEND_UPSTREAM ?? "frontend:4321";

export interface TenantRouteInfo {
  host: string;
  active: boolean;
}

// One dial target per live replica of that service — lets buildCaddyConfig
// express "route to N containers" (Caddy load-balances/health-checks across
// whatever's listed) instead of exactly one, which is what a scaled or
// blue-green deploy needs. An empty/omitted array falls back to the single
// default dial target above (the plain non-blue-green setup).
export interface CaddyUpstreams {
  admin?: string[];
  api?: string[];
  frontend?: string[];
}

// These strings land straight in Caddy's reverse_proxy `dial` config — the
// one real trust boundary CaddyUpstreams crosses, since /internal/deploy/
// promote (index.ts) accepts them over the network (shared-secret
// authenticated, but authentication isn't authorization: an unvalidated
// value here would let anyone holding DEPLOY_SECRET redirect all admin/api/
// tenant traffic to a host of their choosing). Only the plain `host:port`
// shape scripts/deploy.sh ever actually constructs
// (`<project>-<service>-<index>:<port>`) is allowed — no scheme, path, or
// query.
// No dot: deploy.sh only ever constructs plain Docker container names
// (letters/digits/hyphen/underscore, no domain suffix) — allowing `.` here
// would also accept an arbitrary external hostname like evil.example.com.
const DIAL_TARGET_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*:[0-9]{1,5}$/;
export function isValidDialTargets(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && DIAL_TARGET_RE.test(v));
}

function dials(hosts: string[] | undefined, fallback: string): { dial: string }[] {
  if (!hosts?.length) return [{ dial: fallback }];
  if (!isValidDialTargets(hosts)) throw new Error("invalid dial target(s) — expected host:port strings");
  return hosts.map((dial) => ({ dial }));
}

// Pure — the whole desired Caddy config for the bundled proxy: static
// admin/API routes (always present) + one route per ACTIVE tenant, each
// reverse-proxied to the frontend container(s). No DB/network access, so
// this is unit-testable without a live Postgres or Caddy. A tenant with a
// custom certificate needs no special-casing here — loadCaddyCert (below)
// loads the certificate into Caddy separately, and Caddy automatically
// prefers an already-loaded certificate over requesting one via automatic
// HTTPS for a matching hostname.
export function buildCaddyConfig(
  tenants: TenantRouteInfo[],
  upstreams: CaddyUpstreams = {},
): Record<string, unknown> {
  const adminUpstreams = dials(upstreams.admin, DEFAULT_ADMIN_UPSTREAM);
  const apiUpstreams = dials(upstreams.api, DEFAULT_API_UPSTREAM);
  const frontendUpstreams = dials(upstreams.frontend, DEFAULT_FRONTEND_UPSTREAM);

  const tenantRoutes = tenants
    .filter((t) => t.active)
    .map((t) => ({
      match: [{ host: [t.host] }],
      handle: [{ handler: "reverse_proxy", upstreams: frontendUpstreams }],
    }));

  const staticRoutes = [
    {
      match: [{ host: [ADMIN_DOMAIN] }],
      handle: [{ handler: "reverse_proxy", upstreams: adminUpstreams }],
    },
    {
      match: [{ host: [API_DOMAIN] }],
      handle: [{ handler: "reverse_proxy", upstreams: apiUpstreams }],
    },
  ];

  return {
    // Must be repeated on every /load push: POSTing a config replaces the
    // ENTIRE active config, so omitting `admin` here would reset Caddy's
    // admin listener to its loopback-only default and cut this api
    // container off from it permanently. Keep in sync with Caddyfile's own
    // top-level `admin 0.0.0.0:2019` block.
    admin: { listen: "0.0.0.0:2019" },
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":443", ":80"],
            routes: [...staticRoutes, ...tenantRoutes],
          },
        },
      },
    },
  };
}

// Parses a PEM certificate's expiry — stdlib only (Node's X509Certificate),
// no new dependency. Throws on malformed PEM; callers (Task 4's cert-upload
// route) surface that as a 400 to the admin rather than silently accepting
// a bad certificate.
export function parseCertExpiry(certPem: string): Date {
  const cert = new X509Certificate(certPem);
  return new Date(cert.validTo);
}

interface CaddyResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

// Deliberately node:http, not the global fetch(): fetch's undici
// implementation sends an empty `Origin` header on every request (a Fetch-
// spec artifact of running outside a browser), which Caddy's admin API
// treats as a present-but-unrecognized origin and rejects with 403 "client
// is not allowed to access from origin ''" — regardless of any
// origins/enforce_origin setting on the Caddy side, since this container-to-
// container call has no real browser origin to declare. node:http never
// sends that header at all, so the admin API's default same-network trust
// applies.
function caddyRequest(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<CaddyResponse> {
  if (!CADDY_ADMIN_URL) return Promise.reject(new Error("CADDY_ADMIN_URL not configured"));
  const url = new URL(`${CADDY_ADMIN_URL}${path}`);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? "GET",
        headers: init?.headers,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, text: async () => body });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Caddy admin request timed out")));
    req.on("error", reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
}

// Cheap connectivity probe for the Settings card's Connected/Not connected
// status — never pushes any config.
export async function pingCaddy(): Promise<boolean> {
  try {
    const res = await caddyRequest("/config/");
    return res.ok;
  } catch {
    return false;
  }
}

// Pushes the FULL desired config in one atomic swap — Caddy diffs
// internally, so routes that didn't change keep serving live connections
// uninterrupted. The single source of truth is always the tenants table
// (passed in by the caller), never whatever Caddy happened to have before —
// safe to call repeatedly, and safe as a self-heal after the proxy
// container is recreated or loses its volume.
export async function syncCaddy(tenants: TenantRouteInfo[], upstreams: CaddyUpstreams = {}): Promise<void> {
  const config = buildCaddyConfig(tenants, upstreams);
  const res = await caddyRequest("/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Caddy /load failed: ${res.status} ${await res.text()}`);
}

// Tags a host's loaded cert with a stable Caddy `@id` so it can be found
// and removed again later — Caddy's config API has no "delete the cert for
// this hostname" concept otherwise (load_pem is just an array; a bare POST
// can only append to it, never target one entry by hostname).
function certId(host: string): string {
  return `tenant-cert-${host}`;
}

// Loads a certificate+key pair into Caddy; Caddy automatically prefers an
// already-loaded certificate over requesting one via automatic HTTPS for a
// matching hostname — no route-level change needed (see buildCaddyConfig).
// Caddy is the one real validator of the pair (mismatched key, malformed
// PEM, ...); its rejection is thrown verbatim for the caller to surface to
// the admin UI rather than this module reimplementing that validation.
// Removes any cert previously loaded for this exact host first — Caddy
// rejects a duplicate `@id`, and re-uploading for the same host should
// replace, not stack on top of, whatever was there before.
export async function loadCaddyCert(host: string, certPem: string, keyPem: string): Promise<void> {
  await unloadCaddyCert(host);
  const res = await caddyRequest("/config/apps/tls/certificates/load_pem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ "@id": certId(host), certificate: certPem, key: keyPem }]),
  });
  if (!res.ok) throw new Error(`Caddy rejected certificate: ${res.status} ${await res.text()}`);
}

// Removes host's previously loaded certificate, if any. A 404 means nothing
// was ever loaded for this host — the expected, harmless case for a plain
// revert on a host that only ever used automatic HTTPS.
export async function unloadCaddyCert(host: string): Promise<void> {
  const res = await caddyRequest(`/id/${encodeURIComponent(certId(host))}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Caddy failed to remove certificate: ${res.status} ${await res.text()}`);
  }
}
