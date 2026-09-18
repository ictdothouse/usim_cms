import type { FastifyInstance } from "fastify";
import { verifyAnyUser } from "../plugins/auth.js";
import { signSession, verifySession } from "../db/auth.js";
import { getLivePreview } from "../live-preview-store.js";
import { listThemePresets, createThemePreset, deleteThemePreset } from "../db/tenant-pool.js";
import { validateThemeSettings } from "./portal-settings.js";

// Personal theme-preset CRUD, theme preview tokens, and the live-preview
// read-back route — moved out of index.ts verbatim (god-file breakup, part
// 4/9).
export function registerThemePresetRoutes(app: FastifyInstance) {
  // Personal "my collection" of saved theme presets (admin's Theme panel) —
  // any logged-in user (superadmin or webmaster), scoped to their own userId,
  // not tenant-gated at all (see verifyAnyUser's comment).
  app.get("/api/theme-presets", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    return { items: await listThemePresets(session.userId) };
  });

  app.post("/api/theme-presets", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    const { name, settings } = req.body as { name?: string; settings?: Record<string, unknown> };
    if (!name?.trim()) {
      reply.code(400);
      return { error: "name is required" };
    }
    const error = validateThemeSettings(settings ?? {});
    if (error) {
      reply.code(400);
      return { error };
    }
    const item = await createThemePreset(session.userId, name.trim(), settings ?? {});
    reply.code(201);
    return { item };
  });

  app.delete("/api/theme-presets/:id", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    const { id } = req.params as { id: string };
    const deleted = await deleteThemePreset(session.userId, id);
    if (!deleted) {
      reply.code(404);
      return { error: "not found" };
    }
    return { deleted: true, id };
  });

  // Mints a short-lived, read-only token that lets GET /api/theme render
  // not-yet-saved settings (ThemeForm's "Test" button, either a saved preset
  // or whatever's currently in the form) for one request, without writing to
  // site_theme — same previewOnly/exp pattern as a page's preview-token.
  app.post("/api/theme-preview-token", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    const settings = (req.body as { settings?: Record<string, unknown> })?.settings ?? {};
    const error = validateThemeSettings(settings);
    if (error) {
      reply.code(400);
      return { error };
    }
    const token = signSession({
      ...session,
      previewOnly: true,
      exp: Date.now() + 5 * 60 * 1000,
      themePreview: settings as Record<string, string>,
    });
    return { token };
  });

  // Reads back the not-yet-saved draft a page/blueprint/siteChrome
  // preview-token route stashed in the ephemeral live-preview-store (see
  // live-preview-store.ts) — the token itself only carries a livePreviewId
  // claim, never the draft content (too large for a token that ends up in a
  // URL query string). No tenant/DB lookup at all: the signed token's own
  // previewOnly+exp is the entire access check, same trust boundary as every
  // other preview token here. A missing/expired/foreign token, or a draft
  // that already aged out of the store, both resolve to `{ item: null }`
  // rather than an error — apps/frontend's callers all already fall back to
  // the real saved row when there's no override to apply.
  app.get("/api/live-preview", async (req) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return { item: null };
    const session = verifySession(auth.slice("Bearer ".length));
    if (!session?.previewOnly || !session.livePreviewId) return { item: null };
    const item = (await getLivePreview(session.livePreviewId)) ?? null;
    return { item };
  });
}
