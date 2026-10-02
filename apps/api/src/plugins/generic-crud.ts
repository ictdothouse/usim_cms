import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, getTableColumns, ilike, sql, type SQL } from "drizzle-orm";
import type { AccessArgs, CollectionConfig } from "../collections/config-types.js";
import { publishSharedContent } from "../db/tenant-pool.js";
import { verifySession, signSession } from "../db/auth.js";
import { getSessionCookie } from "../lib/cookies.js";
import { cacheGet, cacheInvalidate, cacheSet } from "../cache.js";
import { newLivePreviewId, setLivePreview } from "../live-preview-store.js";

// Registers generic CRUD routes for a collection under /api/:collectionSlug,
// so individual collections don't need hand-written route handlers.

const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;

// Inserts a revisions.snapshot() row for this write when revisions.shouldSnapshot(req)
// says so — called right after config.hooks?.afterChange in both POST and PATCH below,
// same spot the old hand-rolled pagesAfterChange/postsAfterChange hooks used to snapshot.
async function maybeSnapshotRevision(config: CollectionConfig, item: Record<string, unknown>, req: FastifyRequest) {
  const revisions = config.revisions;
  if (!revisions || !revisions.shouldSnapshot(req)) return;
  const fields = await revisions.snapshot(item, req);
  await req.db.insert(revisions.table).values({ [revisions.foreignKey]: item.id, ...fields } as never);
}

function accessArgs(req: FastifyRequest): AccessArgs {
  return { role: req.user?.role, department: req.tenantHost, permissions: req.user?.permissions };
}

// Undefined access fn = allowed (matches pagesCollection, which never
// defines write access checks) — only a defined fn that returns false blocks.
async function checkAccess(
  fn: ((args: AccessArgs) => boolean | Promise<boolean>) | undefined,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!fn) return true;
  if (await fn(accessArgs(req))) return true;
  reply.code(403);
  reply.send({ error: "forbidden" });
  return false;
}

async function applyBeforeChange(config: CollectionConfig, req: FastifyRequest): Promise<unknown> {
  if (!config.hooks?.beforeChange) return req.body;
  return config.hooks.beforeChange(req.body, accessArgs(req), req);
}
//
// Split public (read, anonymous website visitors) from protected (write,
// logged-in webmaster/superadmin) — register each on the matching scope in
// index.ts. A public website has no login session, so GET must never sit
// behind requireTenantAuth.
// Both anonymous website visitors and the logged-in admin panel read
// through this same GET (registerProtectedCollectionRoutes has no GET of
// its own — see the RLS comment on posts_select in
// migrations/0003_create_posts.sql: one shared read path, draft visibility
// keyed off whether the request carries a valid matching bearer token).
// A Bearer header carries a one-off preview token forwarded server-to-server
// by apps/frontend (see auth.ts's previewOnly); the admin panel's own real
// session travels as an httpOnly cookie instead (see plugins/auth.ts) — both
// are checked here since either may elevate this same public read route.
function elevatingCredential(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return getSessionCookie(req);
}

// Same credential check elevateIfAuthenticated runs — exported so an
// afterRead hook can decide what an anonymous visitor may see beyond RLS's
// row-level gate (e.g. pagesAfterRead stripping a page's unpublished `draft`
// column, which RLS can't hide since the row itself is published).
export function isElevatedRequest(req: FastifyRequest): boolean {
  const credential = elevatingCredential(req);
  if (!credential) return false;
  const session = verifySession(credential);
  if (!session || session.pendingMfa) return false;
  if (session.role === "webmaster" && session.tenantHost !== req.tenantHost) return false;
  return true;
}

async function elevateIfAuthenticated(req: FastifyRequest): Promise<void> {
  if (!isElevatedRequest(req)) return;
  await req.db.execute(sql`SET SESSION app.authenticated = 'true'`);
}

// Generic query-string filtering for the list GET below — keyed off
// whichever columns a collection's table actually has, not hand-written per
// collection (e.g. postsCollection gets ?category=/?authorId=/?authorEmail=
// /?status= exact-match, ?tag= array-contains against a `tags` column, and
// ?from=/?to= range against a `publishedAt` column, for free, just by having
// those columns — a collection without them simply ignores those params).
// RLS is still the real visibility gate (elevateIfAuthenticated above,
// posts_select's status='published' branch) — these filters only narrow
// within whatever rows RLS already allows this request to see.
function buildListFilters(table: CollectionConfig["table"], query: Record<string, unknown>): SQL | undefined {
  if (!table) return undefined;
  const columns = getTableColumns(table);
  const conditions: SQL[] = [];
  for (const [key, raw] of Object.entries(query)) {
    if (typeof raw !== "string" || !raw) continue;
    if (key === "search" && "title" in columns) {
      conditions.push(ilike(columns.title as never, `%${raw}%`));
    } else if (key === "tag" && "tags" in columns) {
      conditions.push(sql`${columns.tags} @> ARRAY[${raw}]::text[]`);
    } else if (key === "from" && "publishedAt" in columns) {
      conditions.push(sql`${columns.publishedAt} >= ${raw}`);
    } else if (key === "to" && "publishedAt" in columns) {
      conditions.push(sql`${columns.publishedAt} <= ${raw}`);
    } else if (key in columns) {
      conditions.push(sql`${columns[key as keyof typeof columns]} = ${raw}`);
    }
  }
  return conditions.length ? and(...conditions) : undefined;
}

export function registerPublicCollectionRoutes(app: FastifyInstance, config: CollectionConfig) {
  const base = `/api/${config.slug}`;
  const { table } = config;

  app.get(base, async (req) => {
    if (!table) return { collection: config.slug, items: [] };
    // A Bearer header or session cookie (even an invalid one) may elevate
    // visibility below — never cache/serve that response to a different,
    // anonymous caller. Same token-bearing exclusion apps/frontend's own
    // cache already uses.
    const cacheKey = elevatingCredential(req)
      ? undefined
      : `ucms:cache:${req.tenantHost}:${config.slug}:list:${JSON.stringify(req.query)}`;
    if (cacheKey) {
      const cached = await cacheGet<{ collection: string; items: unknown[] }>(cacheKey);
      if (cached) return cached;
    }
    await elevateIfAuthenticated(req);
    const filters = buildListFilters(table, req.query as Record<string, unknown>);
    // Opt-in: omitting ?limit= keeps the existing unbounded-list behavior
    // every current caller (admin panels, listPosts, etc.) already relies
    // on — this only caps a request that explicitly asks for a page.
    const { limit: limitParam, offset: offsetParam } = req.query as Record<string, unknown>;
    const limit = typeof limitParam === "string" ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 200) : undefined;
    const offset = typeof offsetParam === "string" ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;
    let query = filters ? req.db.select().from(table).where(filters) : req.db.select().from(table);
    if (limit !== undefined) query = query.limit(limit).offset(offset) as typeof query;
    let items: unknown[] = await query;
    if (config.hooks?.afterRead) items = await config.hooks.afterRead(items, req);
    // total is only worth a second query for a caller doing real pagination
    // (one that already sent ?limit=) — every existing unbounded caller
    // (admin panels pre-Sprint-4, apps/frontend) skips this extra query.
    let total: number | undefined;
    if (limit !== undefined) {
      const countQuery = filters
        ? req.db.select({ count: sql<number>`count(*)::int` }).from(table).where(filters)
        : req.db.select({ count: sql<number>`count(*)::int` }).from(table);
      const [row] = await countQuery;
      total = row?.count ?? 0;
    }
    const result = { collection: config.slug, items, ...(total !== undefined ? { total } : {}) };
    if (cacheKey) await cacheSet(cacheKey, result);
    return result;
  });

  app.get(`${base}/:id`, async (req) => {
    const { id } = req.params as { id: string };
    if (!table) return { collection: config.slug, id, item: null };
    const cacheKey = elevatingCredential(req) ? undefined : `ucms:cache:${req.tenantHost}:${config.slug}:item:${id}`;
    if (cacheKey) {
      const cached = await cacheGet<{ collection: string; id: string; item: unknown }>(cacheKey);
      if (cached) return cached;
    }
    await elevateIfAuthenticated(req);
    const [row] = await req.db.select().from(table).where(sql`id = ${id}`);
    let item: unknown = row ?? null;
    if (item && config.hooks?.afterRead) {
      const [resolved] = await config.hooks.afterRead([item], req);
      item = resolved ?? item;
    }
    const result = { collection: config.slug, id, item };
    if (cacheKey) await cacheSet(cacheKey, result);
    return result;
  });
}

export function registerProtectedCollectionRoutes(app: FastifyInstance, config: CollectionConfig) {
  const base = `/api/${config.slug}`;
  const { table } = config;

  app.post(
    base,
    { schema: { body: config.createSchema } },
    async (req, reply) => {
      if (!table) {
        reply.code(501);
        return { error: "not implemented" };
      }
      if (!(await checkAccess(config.access?.create, req, reply))) return;
      const data = await applyBeforeChange(config, req);
      try {
        const [item] = await req.db.insert(table).values(data as never).returning();
        await config.hooks?.afterChange?.(item, accessArgs(req), req);
        await maybeSnapshotRevision(config, item as Record<string, unknown>, req);
        await cacheInvalidate(`ucms:cache:${req.tenantHost}:${config.slug}:`);
        // Same Redis instance, a sibling prefix: apps/frontend's rendered-HTML
        // cache (src/lib/html-cache.ts) has no way to know which pages a
        // write like this one affects (menus/theme/siteChrome writes can
        // change every page's rendered header/footer), so a write to any
        // collection drops the tenant's WHOLE html cache rather than trying
        // to compute the affected page set.
        await cacheInvalidate(`ucms:htmlcache:${req.tenantHost}:`);
        reply.code(201);
        return { collection: config.slug, item };
      } catch (err) {
        // Postgres unique-violation (e.g. categories.name/slug UNIQUE) — a
        // clean, generic 409 for any collection with a unique constraint,
        // mirroring the DELETE handler's 23503 -> 409 handling below.
        if ((err as { code?: string }).code === "23505") {
          reply.code(409);
          return { error: "already exists" };
        }
        throw err;
      }
    },
  );

  app.post(`${base}/:id/publish`, async (req, reply) => {
    if (!table || !config.shareable) {
      reply.code(501);
      return { error: "not implemented" };
    }
    if (!(await checkAccess(config.access?.update, req, reply))) return;
    const { id } = req.params as { id: string };
    const [row] = await req.db.select().from(table).where(sql`id = ${id}`);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    // shared_content is read by an unauthenticated public route (GET
    // /api/portal/shared-content) — a row with any status other than
    // "published" (draft, or a posts-specific "private") must never reach
    // it, whichever collection this is.
    if ("status" in row && row.status !== "published") {
      reply.code(409);
      return { error: "only a published item can be shared to the portal" };
    }
    const { title, excerpt, link } = config.shareable;
    await publishSharedContent({
      sourceHost: req.tenantHost,
      sourceCollection: config.slug,
      sourceId: id,
      title: title(row),
      excerpt: excerpt ? excerpt(row) : null,
      link: link(row, req.tenantHost),
      publishedAt: new Date(),
    });
    return { published: true };
  });

  app.patch(`${base}/:id`, async (req, reply) => {
    if (!table) {
      reply.code(501);
      return { error: "not implemented" };
    }
    if (!(await checkAccess(config.access?.update, req, reply))) return;
    const { id } = req.params as { id: string };
    const data = await applyBeforeChange(config, req);
    let item: Record<string, unknown> | undefined;
    try {
      [item] = await req.db
        .update(table)
        .set(data as never)
        .where(sql`id = ${id}`)
        .returning();
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        reply.code(409);
        return { error: "already exists" };
      }
      throw err;
    }
    if (!item) {
      reply.code(404);
      return { error: "not found" };
    }
    await config.hooks?.afterChange?.(item, accessArgs(req), req);
    await maybeSnapshotRevision(config, item, req);
    await cacheInvalidate(`ucms:cache:${req.tenantHost}:${config.slug}:`);
    await cacheInvalidate(`ucms:htmlcache:${req.tenantHost}:`);
    return { collection: config.slug, item };
  });

  if (config.previewToken) {
    const { supportsLiveDraft } = config.previewToken;
    app.post(`${base}/:id/preview-token`, async (req, reply) => {
      if (!(await checkAccess(config.access?.update, req, reply))) return;
      let livePreviewId: string | undefined;
      if (supportsLiveDraft) {
        const draft = req.body as Record<string, unknown> | undefined;
        if (draft && Object.values(draft).some((v) => v !== undefined)) {
          livePreviewId = newLivePreviewId();
          await setLivePreview(livePreviewId, draft);
        }
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

  if (config.revisions) {
    const { table: revTable, foreignKey, restore } = config.revisions;
    const revColumns = getTableColumns(revTable);

    app.get(`${base}/:id/revisions`, async (req, reply) => {
      if (!(await checkAccess(config.access?.update, req, reply))) return;
      const { id } = req.params as { id: string };
      const items = await req.db
        .select()
        .from(revTable)
        .where(sql`${revColumns[foreignKey]} = ${id}`)
        // Same unbounded-history cap the hand-rolled posts/pages revision
        // routes used — History UI is a scrollable restore list, not a full
        // archive; older snapshots stay in the DB, just unlisted.
        .orderBy(desc(revColumns.createdAt as never))
        .limit(50);
      return { items };
    });

    app.post(`${base}/:id/revisions/:revisionId/restore`, async (req, reply) => {
      if (!table) {
        reply.code(501);
        return { error: "not implemented" };
      }
      if (!(await checkAccess(config.access?.update, req, reply))) return;
      const { id, revisionId } = req.params as { id: string; revisionId: string };
      const [revision] = await req.db
        .select()
        .from(revTable)
        .where(and(sql`${revColumns.id} = ${revisionId}`, sql`${revColumns[foreignKey]} = ${id}`));
      if (!revision) {
        reply.code(404);
        return { error: "not found" };
      }
      const fields = await restore(revision as Record<string, unknown>, req);
      // Never auto-republishes — restoring an old snapshot always goes
      // through a deliberate re-publish click, same as any other edit.
      const [item] = await req.db
        .update(table)
        .set({ ...fields, status: "draft", publishedAt: null, updatedAt: new Date() } as never)
        .where(sql`id = ${id}`)
        .returning();
      return { item };
    });
  }

  app.delete(`${base}/:id`, async (req, reply) => {
    if (!table) {
      reply.code(501);
      return { error: "not implemented" };
    }
    if (!(await checkAccess(config.access?.delete, req, reply))) return;
    const { id } = req.params as { id: string };
    try {
      const [item] = await req.db.delete(table).where(sql`id = ${id}`).returning();
      if (!item) {
        reply.code(404);
        return { error: "not found" };
      }
      await cacheInvalidate(`ucms:cache:${req.tenantHost}:${config.slug}:`);
      await cacheInvalidate(`ucms:htmlcache:${req.tenantHost}:`);
      return { deleted: true, id };
    } catch (err) {
      // Postgres FK-violation (e.g. categories.id RESTRICTed by posts.category_id)
      // — a clean, generic 409 for any collection this applies to.
      if ((err as { code?: string }).code === "23503") {
        reply.code(409);
        return { error: "still referenced by other records" };
      }
      throw err;
    }
  });
}
