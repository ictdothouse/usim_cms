import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { verifySuperadmin } from "../plugins/auth.js";
import {
  listTenants,
  createTenant,
  deleteTenant,
  getTenantDbSizeBytes,
  getProxyAutomationEnabled,
  setProxyAutomationEnabled,
  setTenantCertInfo,
  insertAuditLog,
} from "../db/tenant-pool.js";
import {
  syncCaddy,
  pingCaddy,
  parseCertExpiry,
  loadCaddyCert,
  unloadCaddyCert,
  isValidDialTargets,
  type CaddyUpstreams,
} from "../proxy-sync.js";
import { localUploadsDir, isLocalDriver, dirSizeBytes } from "../storage.js";

// Blue-green deploy promotion (scripts/deploy.sh): once the just-started
// color's own containers report healthy, the deploy script calls this on
// one of them, telling Caddy to route admin/api/tenant traffic at THIS
// color's containers instead of whichever was live before. Deliberately
// bypasses getProxyAutomationEnabled() — that switch only ever gated
// automatic DNS/cert provisioning for a tenant's own CUSTOM domain, a
// separate concern from which color of container is currently live. A
// blue-green deploy only works at all if Caddy's base routing is driven
// dynamically on every deploy, switch or no switch — see CLAUDE.md. Guarded
// by a shared secret rather than a session token, since this is called
// container-to-container over the docker-internal network by deploy
// tooling, never by a browser.
const DEPLOY_SECRET = process.env.DEPLOY_SECRET;

// Multisite tenant CRUD, proxy-automation settings, SSL/cert management, and
// the blue-green promote endpoint — moved out of index.ts verbatim (god-file
// breakup, part 5/9). maybeSyncCaddy/maybeSyncCaddyAtBoot stay exported:
// index.ts still calls maybeSyncCaddy() from the (not-yet-extracted)
// clone/backup routes, and maybeSyncCaddyAtBoot() once at server boot.
export function registerTenantRoutes(app: FastifyInstance) {
  app.get("/api/portal/tenants", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return { tenants: await listTenants() };
  });

  // Multisite panel's resource-usage column (disk + DB size per tenant) — a
  // glance metric, not billing-grade metering. Sequential, not Promise.all:
  // this is a superadmin dashboard refresh, not a hot path, and running ~100
  // tenants' worth of queries concurrently against the control-plane pool has
  // no benefit worth the extra connection pressure.
  app.get("/api/portal/tenants/usage", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const tenants = await listTenants();
    const usage = [];
    for (const t of tenants) {
      const dbSizeBytes = await getTenantDbSizeBytes(t.host);
      let diskSizeBytes: number | null = null;
      if (isLocalDriver) {
        const tenantFolder = t.host.toLowerCase().replace(/[^a-z0-9]/g, "_");
        diskSizeBytes = await dirSizeBytes(path.join(localUploadsDir, tenantFolder));
      }
      usage.push({ host: t.host, dbSizeBytes, diskSizeBytes });
    }
    return { usage };
  });

  app.post("/api/portal/tenants", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host, departmentName, dbUrl } = req.body as {
      host?: string;
      departmentName?: string;
      dbUrl?: string;
    };
    if (!host || !departmentName) {
      reply.code(400);
      return { error: "host and departmentName required" };
    }
    await createTenant(host, departmentName, dbUrl || null);
    await maybeSyncCaddy(app);
    return { created: true };
  });

  // Danger Zone: irreversible. Requires the caller to echo the host back
  // exactly (the admin's type-to-confirm box) — a second, server-side check
  // of the same confirmation, not just client-side UX.
  app.delete("/api/portal/tenants/:host", async (req, reply) => {
    const session = verifySuperadmin(req, reply);
    if (!session) return;
    const { host } = req.params as { host: string };
    const { confirm } = req.body as { confirm?: string };
    if (confirm !== host) {
      reply.code(400);
      return { error: "confirm must match the site's host exactly" };
    }
    await deleteTenant(host);
    if (isLocalDriver) {
      const tenantFolder = host.toLowerCase().replace(/[^a-z0-9]/g, "_");
      await rm(path.join(localUploadsDir, tenantFolder), { recursive: true, force: true });
    }
    await maybeSyncCaddy(app);
    await insertAuditLog({
      actorUserId: session.userId,
      actorEmail: session.email,
      action: "tenant.delete",
      target: host,
      ip: req.ip,
    });
    return { deleted: true };
  });

  app.get("/api/portal/proxy-settings", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const enabled = await getProxyAutomationEnabled();
    const connected = enabled ? await pingCaddy() : false;
    return { enabled, connected };
  });

  app.put("/api/portal/proxy-settings", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      reply.code(400);
      return { error: "enabled must be a boolean" };
    }
    await setProxyAutomationEnabled(enabled);
    if (enabled) await maybeSyncCaddy(app);
    return { enabled };
  });

  app.post("/api/portal/proxy-settings/resync", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    if (!(await getProxyAutomationEnabled())) {
      reply.code(400);
      return { error: "proxy automation is not enabled" };
    }
    try {
      await syncCaddy(await listTenants());
      return { synced: true };
    } catch (err) {
      reply.code(502);
      return { synced: false, error: (err as Error).message };
    }
  });

  // Sibling of the Caddy-based automation above, for the nginx-as-edge
  // enterprise pattern instead (see CLAUDE.md's "nginx-as-edge" section) —
  // forwards to the monitor process's own POST /api/ssl/issue, which is the
  // one that actually has host-level shell access to run certbot against
  // nginx. MONITOR_URL is only set by install.sh's install_monitor when it
  // wrote MONITOR_USER/MONITOR_PASSWORD alongside it, so an unconfigured
  // deployment (Caddy-only, or nginx set up by hand before this feature
  // existed) gets a clear 501 instead of a confusing network error.
  app.post("/api/portal/ssl/issue", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { domain, email } = req.body as { domain?: string; email?: string };
    if (typeof domain !== "string" || !domain || typeof email !== "string" || !email) {
      reply.code(400);
      return { error: "domain and email are required" };
    }
    const monitorUrl = process.env.MONITOR_URL;
    if (!monitorUrl) {
      reply.code(501);
      return { error: "MONITOR_URL is not configured — this deployment has no monitor to run certbot on" };
    }
    const auth = Buffer.from(`${process.env.MONITOR_USER ?? "admin"}:${process.env.MONITOR_PASSWORD ?? ""}`).toString(
      "base64",
    );
    try {
      const res = await fetch(`${monitorUrl}/api/ssl/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify({ domain, email }),
      });
      const body = (await res.json()) as { error?: string; stdout?: string; stderr?: string };
      if (!res.ok) {
        reply.code(502);
        return { error: body.error ?? "certbot request failed", stderr: body.stderr };
      }
      return body;
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  app.post("/internal/deploy/promote", async (req, reply) => {
    if (!DEPLOY_SECRET) {
      reply.code(503);
      return { error: "DEPLOY_SECRET not configured — blue-green promote is disabled" };
    }
    const provided = Buffer.from((req.headers["x-deploy-secret"] as string | undefined) ?? "");
    const expected = Buffer.from(DEPLOY_SECRET);
    // Compare against a length that's always the same regardless of `provided`
    // so a mismatched length doesn't short-circuit the timing check faster
    // than a near-miss of the right length.
    const matches = provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!matches) {
      reply.code(401);
      return { error: "invalid deploy secret" };
    }
    const { admin, api, frontend } = (req.body as CaddyUpstreams) ?? {};
    for (const [name, value] of [
      ["admin", admin],
      ["api", api],
      ["frontend", frontend],
    ] as const) {
      if (value !== undefined && !isValidDialTargets(value)) {
        reply.code(400);
        return { error: `invalid ${name} dial target(s) — expected host:port strings` };
      }
    }
    try {
      await syncCaddy(await listTenants(), { admin, api, frontend });
      return { promoted: true };
    } catch (err) {
      reply.code(502);
      return { promoted: false, error: (err as Error).message };
    }
  });

  // Uploads USIM's own paid certificate for `host`, forwarded straight to
  // Caddy — never written to this API's own disk or DB (see proxy-sync.ts's
  // loadCaddyCert). Caddy is the one real validator of the cert/key pair.
  app.post("/api/portal/tenants/:host/cert", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    if (!(await getProxyAutomationEnabled())) {
      reply.code(400);
      return { error: "proxy automation is not enabled" };
    }
    const { host } = req.params as { host: string };
    if (!(await listTenants()).some((t) => t.host === host)) {
      reply.code(404);
      return { error: "tenant not found" };
    }
    let certPem: string | null = null;
    let keyPem: string | null = null;
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      const buf = await part.toBuffer();
      if (part.fieldname === "cert") certPem = buf.toString("utf8");
      if (part.fieldname === "key") keyPem = buf.toString("utf8");
    }
    if (!certPem || !keyPem) {
      reply.code(400);
      return { error: "cert and key files required (multipart/form-data, fields 'cert' and 'key')" };
    }
    let expiresAt: Date;
    try {
      expiresAt = parseCertExpiry(certPem);
    } catch {
      reply.code(400);
      return { error: "certificate could not be parsed (expected PEM)" };
    }
    try {
      await loadCaddyCert(host, certPem, keyPem);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
    await setTenantCertInfo(host, expiresAt);
    await maybeSyncCaddy(app);
    return { hasCustomCert: true, certExpiresAt: expiresAt.toISOString() };
  });

  // Reverts `host` to Caddy's automatic Let's Encrypt HTTPS.
  app.delete("/api/portal/tenants/:host/cert", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    if (!(await getProxyAutomationEnabled())) {
      reply.code(400);
      return { error: "proxy automation is not enabled" };
    }
    const { host } = req.params as { host: string };
    if (!(await listTenants()).some((t) => t.host === host)) {
      reply.code(404);
      return { error: "tenant not found" };
    }
    try {
      await unloadCaddyCert(host);
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
    await setTenantCertInfo(host, null);
    await maybeSyncCaddy(app);
    return { hasCustomCert: false };
  });
}

// Boot-only variant: docker-compose starts `proxy` only after api/admin/
// frontend have merely STARTED (not become healthy), so on a fresh
// `docker compose up` this process's own boot can fire before Caddy inside
// the proxy container is actually accepting connections yet — a bare
// single-shot maybeSyncCaddy() would reliably fail here. Retries a few
// times with a short delay instead of giving up on the very first race.
// Exported standalone (not nested in registerTenantRoutes) since index.ts
// calls it once at server boot, outside any route handler.
export async function maybeSyncCaddyAtBoot(app: FastifyInstance): Promise<void> {
  if (!(await getProxyAutomationEnabled())) return;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await syncCaddy(await listTenants());
      return;
    } catch (err) {
      if (attempt === 5) {
        app.log.warn({ err }, "Caddy proxy sync failed after retries");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// Standalone export of the same "sync if enabled, swallow errors" helper
// used by index.ts's own not-yet-extracted clone/backup routes.
export async function maybeSyncCaddy(app: FastifyInstance): Promise<void> {
  try {
    if (!(await getProxyAutomationEnabled())) return;
    await syncCaddy(await listTenants());
  } catch (err) {
    app.log.warn({ err }, "Caddy proxy sync failed");
  }
}
