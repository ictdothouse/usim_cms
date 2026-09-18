import type { FastifyInstance } from "fastify";
import { verifySuperadmin } from "../plugins/auth.js";
import { listTenants, createTenant, deleteTenant } from "../db/tenant-pool.js";
import { maybeSyncCaddy } from "./tenants.js";
import {
  exportTenantBackup,
  importTenantBackup,
  exportStaticSite,
  exportTenantDesignClone,
  prepareClone,
  listClones,
  getClone,
  markCloneStaged,
  deleteClone,
  looksLikeDomain,
} from "../backup.js";

// Backup / restore / clone / static-export routes — superadmin-only, root
// scope like the rest of /api/portal (tenant comes from the URL, not
// x-tenant-host). Moved out of index.ts verbatim (god-file breakup, index.ts).
export function registerBackupCloneRoutes(app: FastifyInstance) {
  app.get("/api/portal/tenants/:host/backup", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    const zip = await exportTenantBackup(host);
    reply
      .type("application/zip")
      .header("Content-Disposition", `attachment; filename="backup-${host}-${new Date().toISOString().slice(0, 10)}.zip"`);
    return reply.send(Buffer.from(zip));
  });

  app.post("/api/portal/tenants/:host/restore", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    // Per-call limit override: backups carry a tenant's whole media library,
    // so the global 5 MB multipart cap is far too small here.
    const file = await req.file({ limits: { fileSize: 500 * 1024 * 1024 } });
    if (!file) {
      reply.code(400);
      return { error: "backup zip required (multipart/form-data, field name 'file')" };
    }
    const buf = await file.toBuffer();
    try {
      const { restored } = await importTenantBackup(host, new Uint8Array(buf));
      return { restored: restored.length, host };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  // Clone flow: "prepare" snapshots the source tenant into an in-memory box
  // (full copy or design/skeleton-only per exportTenantDesignClone), then the
  // admin picks what to do with that snapshot — download it, stage it as a
  // preview tenant, or promote it straight into a new live site.
  app.post("/api/portal/tenants/:host/clone-prepare", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    const { type, label } = req.body as { type?: "full" | "design"; label?: string };
    if (type !== "full" && type !== "design") {
      reply.code(400);
      return { error: "type must be 'full' or 'design'" };
    }
    const zip = type === "design" ? await exportTenantDesignClone(host) : await exportTenantBackup(host);
    return prepareClone(host, type, zip, label);
  });

  app.get("/api/portal/tenants/:host/clones", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    return { clones: listClones(host) };
  });

  // Removes a clone box entry. If it was staged (has a real stagingHost —
  // stageClone's own createTenant already made that a live tenant + Caddy
  // route), that staging tenant is deleted too, since a staged preview only
  // ever exists as a byproduct of this clone and shouldn't outlive it as an
  // orphaned, no-longer-linked site.
  app.delete("/api/portal/clones/:id", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const entry = getClone(id);
    if (!entry) {
      reply.code(404);
      return { error: "clone not found" };
    }
    if (entry.meta.stagingHost) {
      await deleteTenant(entry.meta.stagingHost);
      await maybeSyncCaddy(app);
    }
    deleteClone(id);
    return { deleted: true, id };
  });

  app.get("/api/portal/clones/:id/download", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const entry = getClone(id);
    if (!entry) {
      reply.code(404);
      return { error: "clone not found" };
    }
    reply
      .type("application/zip")
      .header("Content-Disposition", `attachment; filename="clone-${entry.meta.sourceHost}-${entry.meta.type}.zip"`);
    return reply.send(Buffer.from(entry.zip));
  });

  // Staging host uses the clone's label when it looks like a real domain;
  // otherwise it's derived so a one-click preview never needs a domain typed in.
  app.post("/api/portal/clones/:id/stage", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const entry = getClone(id);
    if (!entry) {
      reply.code(404);
      return { error: "clone not found" };
    }
    const usingCustomLabel = Boolean(entry.meta.label && looksLikeDomain(entry.meta.label));
    const stagingHost = usingCustomLabel ? (entry.meta.label as string) : `staging-${id.slice(0, 8)}.${entry.meta.sourceHost}`;
    if ((await listTenants()).some((t) => t.host === stagingHost)) {
      reply.code(409);
      return { error: `tenant ${stagingHost} already exists` };
    }
    const source = (await listTenants()).find((t) => t.host === entry.meta.sourceHost);
    await createTenant(stagingHost, `${(source?.departmentName as string) ?? entry.meta.sourceHost} (Staging)`, null, {
      // The auto-derived staging-<id>.<sourceHost> subdomain has no DNS record
      // of its own (relies on the parent domain's own wildcard/routing, if
      // any) — only require DNS when the operator typed a real custom label.
      skipDnsCheck: !usingCustomLabel,
    });
    await maybeSyncCaddy(app);
    await importTenantBackup(stagingHost, entry.zip);
    markCloneStaged(id, stagingHost);
    return { staged: true, stagingHost };
  });

  app.post("/api/portal/clones/:id/promote", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const entry = getClone(id);
    if (!entry) {
      reply.code(404);
      return { error: "clone not found" };
    }
    const { newHost, departmentName } = req.body as { newHost?: string; departmentName?: string };
    if (!newHost || !departmentName) {
      reply.code(400);
      return { error: "newHost and departmentName required" };
    }
    if ((await listTenants()).some((t) => t.host === newHost)) {
      reply.code(409);
      return { error: `tenant ${newHost} already exists — use restore instead` };
    }
    await createTenant(newHost, departmentName, null);
    await maybeSyncCaddy(app);
    await importTenantBackup(newHost, entry.zip);
    return { promoted: true, host: newHost };
  });

  // Replace = copy a staged preview tenant's current content back into the
  // original tenant it was staged from — the "preview before replace" step.
  app.post("/api/portal/tenants/:host/replace-from-staging", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    const { stagingHost } = req.body as { stagingHost?: string };
    if (!stagingHost) {
      reply.code(400);
      return { error: "stagingHost required" };
    }
    const zip = await exportTenantBackup(stagingHost);
    await importTenantBackup(host, zip);
    return { replaced: true };
  });

  app.get("/api/portal/tenants/:host/static-export", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    const { host } = req.params as { host: string };
    try {
      const zip = await exportStaticSite(host);
      reply
        .type("application/zip")
        .header("Content-Disposition", `attachment; filename="static-${host}-${new Date().toISOString().slice(0, 10)}.zip"`);
      return reply.send(Buffer.from(zip));
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });
}
