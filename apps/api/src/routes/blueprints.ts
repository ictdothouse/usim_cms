import type { FastifyInstance, FastifyRequest } from "fastify";
import { validateLayout } from "../collections/validate-layout.js";
import { hasPermission } from "./permissions.js";
import { signSession, verifySession } from "../db/auth.js";
import { newLivePreviewId, setLivePreview } from "../live-preview-store.js";
import {
  listPageBlueprints,
  getPageBlueprint,
  createPageBlueprint,
  updatePageBlueprint,
  deletePageBlueprint,
} from "../db/tenant-pool.js";

const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;

// Backs apps/frontend's blueprint-preview.astro (Designer's blueprint
// Live Edit iframe) — a blueprint has no real slug/route, so unlike
// pages/posts there is no underlying public row this could "elevate"
// visibility on; the previewOnly token IS the entire access check. Never
// linked from anywhere a real visitor could reach.
export function registerPublicBlueprintRoutes(publicScope: FastifyInstance) {
  publicScope.get("/api/blueprints/:id/preview", async (req, reply) => {
    const auth = req.headers.authorization;
    const session = auth?.startsWith("Bearer ") ? verifySession(auth.slice("Bearer ".length)) : null;
    if (!session || !session.previewOnly || session.pendingMfa) {
      reply.code(401);
      return { error: "preview token required" };
    }
    const { id } = req.params as { id: string };
    const bp = await getPageBlueprint(id);
    if (!bp) {
      reply.code(404);
      return { error: "not found" };
    }
    // A tenant-scoped blueprint is only previewable by a token minted for
    // that same tenant; a system-wide one (tenantHost null) has no tenant to
    // check against, so any valid previewOnly token may render it.
    if (bp.tenantHost !== null && bp.tenantHost !== session.tenantHost) {
      reply.code(403);
      return { error: "forbidden" };
    }
    return { item: bp };
  });
}

// Page Blueprint (Sprint 5 sub-project 2) — control-plane CRUD, hand-
// written for the same reason /api/tenant-languages is (control-plane
// data via tenant-pool.ts, not req.db — generic-crud.ts only ever
// operates on a tenant's own database connection). Moved out of index.ts
// verbatim (god-file breakup, index.ts).
export function registerBlueprintRoutes(protectedScope: FastifyInstance) {
  function canWriteBlueprint(req: FastifyRequest, targetTenantHost: string | null): boolean {
    if (req.user.role === "superadmin") return true;
    if (targetTenantHost === null) return false; // only superadmin may touch a system blueprint
    return targetTenantHost === req.tenantHost && hasPermission({ role: req.user.role, permissions: req.user.permissions }, "blueprints.write");
  }

  protectedScope.get("/api/blueprints", async (req) => {
    const { category } = req.query as { category?: string };
    const items = await listPageBlueprints(req.tenantHost, category || undefined);
    return { items };
  });

  protectedScope.post("/api/blueprints", async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string | null;
      category?: string | null;
      layout?: unknown;
      settings?: unknown;
      scope?: "system" | "tenant";
    };
    if (!body.name || typeof body.name !== "string") {
      reply.code(400);
      return { error: "name is required" };
    }
    const targetTenantHost = body.scope === "system" ? null : req.tenantHost;
    if (!canWriteBlueprint(req, targetTenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    const layoutErr = validateLayout(body.layout ?? []);
    if (layoutErr) {
      reply.code(400);
      return { error: layoutErr };
    }
    const row = await createPageBlueprint({
      tenantHost: targetTenantHost,
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? null,
      layout: body.layout ?? [],
      settings: body.settings ?? {},
      createdBy: req.user.userId,
      createdByEmail: req.user.email,
    });
    return { item: row };
  });

  protectedScope.patch("/api/blueprints/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canWriteBlueprint(req, existing.tenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    const body = req.body as { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown };
    if (body.layout !== undefined) {
      const layoutErr = validateLayout(body.layout);
      if (layoutErr) {
        reply.code(400);
        return { error: layoutErr };
      }
    }
    // Allowlist fields explicitly — body is only TS-cast, not runtime
    // validated, so passing it straight through would let a caller overwrite
    // any column (tenantHost, createdBy, createdByEmail, id, ...) via extra
    // JSON fields, e.g. escalating a tenant-scoped blueprint to system-wide.
    const updates: { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.category !== undefined) updates.category = body.category;
    if (body.layout !== undefined) updates.layout = body.layout;
    if (body.settings !== undefined) updates.settings = body.settings;
    await updatePageBlueprint(id, updates);
    return { saved: true };
  });

  protectedScope.delete("/api/blueprints/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canWriteBlueprint(req, existing.tenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    await deletePageBlueprint(id);
    return { deleted: true };
  });

  // Mints a preview credential for Designer's blueprint "Live Edit" iframe —
  // same previewOnly/exp shape as the pages preview-token route. A
  // blueprint has no live route of its own (no slug), so the counterpart
  // read route above is public (never behind requireTenantAuth) and instead
  // gates purely on this token, mirroring how [...slug].astro's own
  // designerEdit bridge only ever activates alongside a valid previewToken.
  protectedScope.post("/api/blueprints/:id/preview-token", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getPageBlueprint(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canWriteBlueprint(req, existing.tenantHost)) {
      reply.code(403);
      return { error: "missing blueprints.write permission" };
    }
    // Same not-yet-saved-content override as the pages preview-token route —
    // see its comment.
    const draft = req.body as { layout?: unknown; settings?: unknown } | undefined;
    let livePreviewId: string | undefined;
    if (draft && (draft.layout !== undefined || draft.settings !== undefined)) {
      livePreviewId = newLivePreviewId();
      await setLivePreview(livePreviewId, draft);
    }
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
      ...(livePreviewId ? { livePreviewId } : {}),
    });
    return { token };
  });
}
