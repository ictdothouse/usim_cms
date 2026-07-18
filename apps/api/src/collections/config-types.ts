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
}
