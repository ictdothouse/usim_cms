import type { PgTable } from "drizzle-orm/pg-core";
import type { FastifySchema } from "fastify";

export interface AccessArgs {
  role?: string;
  department?: string;
  capabilities?: string[];
}

export type AccessFn = (args: AccessArgs) => boolean | Promise<boolean>;

export interface CollectionHooks<T = unknown> {
  beforeChange?: (data: T, args: AccessArgs) => T | Promise<T>;
  afterChange?: (data: T, args: AccessArgs) => void | Promise<void>;
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
