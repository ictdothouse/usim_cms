import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { hasPermission } from "./permissions.js";
import { signSession } from "../db/auth.js";
import { newLivePreviewId, setLivePreview } from "../live-preview-store.js";

const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;

// Preview tokens (pages/posts/siteChrome) + post/page revision history +
// restore, moved out of index.ts verbatim (god-file breakup, index.ts).
export function registerRevisionsRoutes(protectedScope: FastifyInstance) {
  // Mints a short-lived, read-only token for the admin's page "View" link —
  // never the real session bearer (see auth.ts's previewOnly/exp and
  // requireTenantAuth's rejection of it). Scoped to this tenant only, same
  // granularity as every other read check here (no per-row ACL exists).
  // Optional body: { layout?, settings?, translations? } — Designer's
  // Preview/Live Edit now sends the canvas's current in-memory state
  // directly, with no prior Save, mirroring Elementor/Avada's own "preview
  // shows what's on screen, not what's persisted" behavior. Stored in the
  // ephemeral live-preview-store (never pages.layout/settings/translations),
  // referenced from the signed token by id only — see GET /api/live-preview.
  // Omitting the body (or sending {}) keeps the old behavior: a plain
  // draft-visibility token with nothing to override.
  protectedScope.post("/api/pages/:id/preview-token", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "pages.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const draft = req.body as { layout?: unknown; settings?: unknown; translations?: unknown } | undefined;
    let livePreviewId: string | undefined;
    if (draft && (draft.layout !== undefined || draft.settings !== undefined || draft.translations !== undefined)) {
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

  // Same shape as the pages preview-token route above — posts had none,
  // which made a Preview button dead for Draft/Private posts.
  protectedScope.post("/api/posts/:id/preview-token", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "posts.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const token = signSession({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      tenantHost: req.tenantHost,
      permissions: [],
      previewOnly: true,
      exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
    });
    return { token };
  });

  // siteChrome's own GET is already publicly readable regardless of draft/
  // published status (see chrome-preview.astro's own comment), so unlike the
  // pages/blueprints preview-token routes, this one exists purely to
  // carry not-yet-saved canvas content for Designer's Header/Footer device
  // preview — same ephemeral-store/livePreviewId mechanism, no draft-
  // visibility elevation needed.
  protectedScope.post("/api/siteChrome/:id/preview-token", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "headerFooter.write")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const draft = req.body as { layout?: unknown } | undefined;
    let livePreviewId: string | undefined;
    if (draft && draft.layout !== undefined) {
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

  // History/restore — a post-specific feature the generic CRUD mechanism
  // doesn't cover, so hand-rolled rather than forced into
  // registerProtectedCollectionRoutes.
  protectedScope.get("/api/posts/:id/revisions", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "posts.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id } = req.params as { id: string };
    const items = await req.db
      .select()
      .from(schema.postRevisions)
      .where(eq(schema.postRevisions.postId, id))
      .orderBy(desc(schema.postRevisions.createdAt))
      // Audit finding: unbounded — a frequently-republished post accumulates
      // one snapshot per publish forever. History UI only ever shows a
      // scrollable list to restore from, not a full archive, so the most
      // recent 50 is plenty; older snapshots stay in the DB, just unlisted.
      .limit(50);
    return { items };
  });

  // Copies a snapshot's content fields back onto the live post as a new
  // draft — never auto-republishes it, so restoring an old version always
  // goes through a deliberate re-publish click, same as any other edit.
  protectedScope.post("/api/posts/:id/revisions/:revisionId/restore", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "posts.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const [revision] = await req.db
      .select()
      .from(schema.postRevisions)
      .where(and(eq(schema.postRevisions.id, revisionId), eq(schema.postRevisions.postId, id)));
    if (!revision) {
      reply.code(404);
      return { error: "not found" };
    }
    // Revision's category is a name snapshot — if a category with that exact
    // name still exists, restore points at it; if renamed/deleted since,
    // this goes to uncategorized rather than guessing (same known-ceiling
    // tradeoff as the bookmark card snapshot in Phase 4).
    let categoryId: string | null = null;
    if (revision.category) {
      const [cat] = await req.db.select().from(schema.categories).where(eq(schema.categories.name, revision.category));
      categoryId = cat?.id ?? null;
    }
    const [item] = await req.db
      .update(schema.posts)
      .set({
        title: revision.title,
        body: revision.body,
        excerpt: revision.excerpt,
        bannerImageUrl: revision.bannerImageUrl,
        categoryId,
        tags: revision.tags,
        status: "draft",
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.posts.id, id))
      .returning();
    return { item };
  });

  // History/restore for pages — same reasoning as the posts revision routes
  // above (a page-specific feature the generic CRUD mechanism doesn't cover),
  // mirrored exactly minus the category-name resolution posts' restore does
  // (pages have no category concept).
  protectedScope.get("/api/pages/:id/revisions", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "pages.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id } = req.params as { id: string };
    const items = await req.db
      .select()
      .from(schema.pageRevisions)
      .where(eq(schema.pageRevisions.pageId, id))
      .orderBy(desc(schema.pageRevisions.createdAt))
      // Same unbounded-history cap as the posts revisions route above.
      .limit(50);
    return { items };
  });

  // Copies a snapshot's content fields back onto the live page as a new
  // draft — never auto-republishes it, so restoring an old version always
  // goes through a deliberate re-publish click, same as any other edit.
  protectedScope.post("/api/pages/:id/revisions/:revisionId/restore", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, department: req.tenantHost, permissions: req.user.permissions }, "pages.update")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const [revision] = await req.db
      .select()
      .from(schema.pageRevisions)
      .where(and(eq(schema.pageRevisions.id, revisionId), eq(schema.pageRevisions.pageId, id)));
    if (!revision) {
      reply.code(404);
      return { error: "not found" };
    }
    const [item] = await req.db
      .update(schema.pages)
      .set({
        title: revision.title,
        layout: revision.layout,
        settings: revision.settings,
        bannerImageUrl: revision.bannerImageUrl,
        status: "draft",
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, id))
      .returning();
    return { item };
  });
}
