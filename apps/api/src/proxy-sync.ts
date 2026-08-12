import { X509Certificate } from "node:crypto";

// Bundled Caddy proxy's Admin API — reachable only on the docker-internal
// network (never published to the host, see docker-compose.yml's proxy
// service) or a bare-metal Caddy's own localhost listener. Unset means this
// deployment has no Caddy to talk to; every network function below fails
// closed in that case, which is the expected state for local dev and
// bare-metal installs (see CLAUDE.md's Non-goals for this feature).
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL;
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? "admin.localhost";
const API_DOMAIN = process.env.API_DOMAIN ?? "api.localhost";
const TIMEOUT_MS = 5000;

export interface TenantRouteInfo {
  host: string;
  active: boolean;
}

// Pure — the whole desired Caddy config for the bundled proxy: static
// admin/API routes (always present) + one route per ACTIVE tenant, each
// reverse-proxied to the frontend container. No DB/network access, so this
// is unit-testable without a live Postgres or Caddy. A tenant with a custom
// certificate needs no special-casing here — loadCaddyCert (below) loads
// the certificate into Caddy separately, and Caddy automatically prefers an
// already-loaded certificate over requesting one via automatic HTTPS for a
// matching hostname.
export function buildCaddyConfig(tenants: TenantRouteInfo[]): Record<string, unknown> {
  const tenantRoutes = tenants
    .filter((t) => t.active)
    .map((t) => ({
      match: [{ host: [t.host] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "frontend:4321" }] }],
    }));

  const staticRoutes = [
    {
      match: [{ host: [ADMIN_DOMAIN] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "admin:80" }] }],
    },
    {
      match: [{ host: [API_DOMAIN] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "api:3000" }] }],
    },
  ];

  return {
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

async function caddyRequest(path: string, init?: RequestInit): Promise<Response> {
  if (!CADDY_ADMIN_URL) throw new Error("CADDY_ADMIN_URL not configured");
  return fetch(`${CADDY_ADMIN_URL}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
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
export async function syncCaddy(tenants: TenantRouteInfo[]): Promise<void> {
  const config = buildCaddyConfig(tenants);
  const res = await caddyRequest("/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Caddy /load failed: ${res.status} ${await res.text()}`);
}

// Loads a certificate+key pair into Caddy; Caddy automatically prefers an
// already-loaded certificate over requesting one via automatic HTTPS for a
// matching hostname — no route-level change needed (see buildCaddyConfig).
// Caddy is the one real validator of the pair (mismatched key, malformed
// PEM, ...); its rejection is thrown verbatim for the caller to surface to
// the admin UI rather than this module reimplementing that validation.
export async function loadCaddyCert(certPem: string, keyPem: string): Promise<void> {
  const res = await caddyRequest("/config/apps/tls/certificates/load_pem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ certificate: certPem, key: keyPem }]),
  });
  if (!res.ok) throw new Error(`Caddy rejected certificate: ${res.status} ${await res.text()}`);
}
