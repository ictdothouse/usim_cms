import type { PgTable } from "drizzle-orm/pg-core";
import type { FastifyRequest, FastifySchema } from "fastify";

export interface AccessArgs {
  role?: string;
  department?: string;
  permissions?: string[];
}

export type AccessFn = (args: AccessArgs) => boolean | Promise<boolean>;

export interface CollectionHooks<T = unknown> {
  // req lets a hook tell POST from PATCH (req.method) and read req.user/
  // req.db — e.g. postsCollection stamps authorId only on create, and
  // snapshots a post_revisions row only when the request explicitly
  // published/made it private (req.body.status), not on every edit.
  beforeChange?: (data: T, args: AccessArgs, req: FastifyRequest) => T | Promise<T>;
  afterChange?: (item: T, args: AccessArgs, req: FastifyRequest) => void | Promise<void>;
  // Runs on the public GET list and GET/:id routes (the latter called with a
  // one-item array) right before the response is sent — lets a collection
  // enrich rows with a cross-table value (e.g. postsCollection resolving
  // categoryId -> category name) without generic-crud needing table-specific
  // joins.
  afterRead?: (items: T[], req: FastifyRequest) => T[] | Promise<T[]>;
}

export interface RevisionsConfig<T = unknown> {
  // Table backing this collection's revision history; must have "id"/
  // "createdAt" columns plus the foreign-key column named below.
  table: PgTable;
  // Column name on `table` referencing this collection's own row id (e.g.
  // "postId"/"pageId").
  foreignKey: string;
  // True when THIS write should snapshot — checked against the raw incoming
  // req.body (not the persisted item), so a plain content edit never
  // snapshots, only an explicit publish (pagesCollection) or publish/private
  // (postsCollection).
  shouldSnapshot: (req: FastifyRequest) => boolean;
  // Fields to insert into the revision row (excluding id/createdAt/the FK,
  // which generic-crud.ts fills in itself) — may run its own queries (e.g.
  // postsCollection resolving categoryId -> a denormalized category name).
  snapshot: (row: T, req: FastifyRequest) => Record<string, unknown> | Promise<Record<string, unknown>>;
  // Fields to write back onto the live row when a snapshot is restored.
  // generic-crud.ts additionally always sets status:"draft"/publishedAt:null/
  // updatedAt:now itself, so a restore never auto-republishes.
  restore: (revision: Record<string, unknown>, req: FastifyRequest) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface CollectionConfig<T = unknown> {
  slug: string;
  // Drizzle table backing the generic CRUD routes; must have an "id" column.
  table?: PgTable;
  // JSON-schema for the POST body, validated before it ever reaches the DB.
  createSchema?: FastifySchema["body"];
  // Enables POST /:id/publish — copies a record into the cross-department
  // public.shared_content pool (see tenant-pool.ts). Omit to keep a
  // collection fully private with no share path at all.
  shareable?: {
    title: (row: Record<string, unknown>) => string;
    excerpt?: (row: Record<string, unknown>) => string;
    link: (row: Record<string, unknown>, tenantHost: string) => string;
  };
  access?: {
    read?: AccessFn;
    create?: AccessFn;
    update?: AccessFn;
    delete?: AccessFn;
  };
  hooks?: CollectionHooks<T>;
  // Enables GET /:id/revisions + POST /:id/revisions/:revisionId/restore,
  // both gated on the same `access.update` check as PATCH.
  revisions?: RevisionsConfig<T>;
  // Enables POST /:id/preview-token — mints a short-lived previewOnly session
  // token for Designer's "View"/device-preview button, gated on the same
  // `access.update` check as PATCH. supportsLiveDraft additionally lets the
  // request body carry an in-memory draft (Designer's Preview/Live Edit sends
  // the canvas's current unsaved state) stashed in the ephemeral
  // live-preview-store and referenced by the token's livePreviewId.
  previewToken?: { supportsLiveDraft?: boolean };
}
