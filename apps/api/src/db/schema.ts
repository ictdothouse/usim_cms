import { pgTable, uuid, text, jsonb, timestamp, boolean, unique, integer } from "drizzle-orm/pg-core";

export const pages = pgTable("pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  // Dynamic block layout for the page, e.g. [{ type: "hero", props: {...} }, ...]
  layout: jsonb("layout").notNull().default([]),
  bannerImageUrl: text("banner_image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// News/article content per tenant. body is sanitized HTML from the admin
// rich-text editor (see the posts collection's beforeChange hook). Public
// visibility is enforced by RLS: anonymous SELECT only sees status='published'
// (migrations/0003_create_posts.sql).
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  excerpt: text("excerpt"),
  bannerImageUrl: text("banner_image_url"),
  status: text("status").notNull().default("draft"), // "draft" | "published"
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Upload registry per tenant (tenant schema): one row per file stored via
// storage.ts. The file itself lives on disk/S3; this table is what the admin
// media manager lists and deletes. Only ever queried from the protected
// scope, so RLS requires app.authenticated even for SELECT
// (migrations/0004_create_media.sql).
export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(), // stored name inside the tenant folder
  originalName: text("original_name").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Control-plane registry of known tenant hosts, always in the "public"
// schema. Resolved via search_path (tenant schema first, "public" fallback
// after) rather than an explicit qualifier, since Drizzle disallows
// pgSchema("public") — see tenant-pool.ts's SET search_path calls.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  host: text("host").notNull().unique(),
  departmentName: text("department_name").notNull(),
  active: boolean("active").notNull().default(true),
  // Where this tenant's own database lives. Null = same Postgres server as
  // the control-plane DATABASE_URL, database name tenant_<host> (derived in
  // tenant-pool.ts). Set explicitly to move a tenant to another DB server —
  // topology is data here, never code.
  dbUrl: text("db_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Explicit "publish to portal" copy of shareable content, also "public"
// schema. Departments stay fully isolated (webmasters never query another
// tenant's schema); this is the one deliberate, one-way opt-in path out.
export const sharedContent = pgTable(
  "shared_content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceHost: text("source_host").notNull(),
    sourceCollection: text("source_collection").notNull(),
    sourceId: uuid("source_id").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    link: text("link").notNull(),
    publishedAt: timestamp("published_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.sourceCollection, table.sourceId)],
);

// Design/theme settings, also "public" schema. tenantHost = "" is the
// global/default row (superadmin-owned); any other value is one tenant's
// override, shallow-merged on top of global at read time (tenant wins).
export const siteTheme = pgTable("site_theme", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantHost: text("tenant_host").notNull().unique(),
  settings: jsonb("settings").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Named permission sets a superadmin defines and assigns to webmaster users
// (public schema, like tenants/users). `permissions` is a fixed set of
// "resource.action" strings (see PERMISSIONS in index.ts) — superadmin role
// always bypasses these checks (see hasPermission in index.ts), so a role's
// permissions are only ever consulted for webmaster sessions.
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  permissions: text("permissions").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Local (non-SSO) login for v1, also "public" schema. tenantHost is null for
// superadmin (access to every tenant); required for webmaster (locked to
// exactly that one tenant). Entra ID SSO can be added later as a second way
// to arrive at the same { userId, role, tenantHost } session shape.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(), // "superadmin" | "webmaster"
  tenantHost: text("tenant_host"),
  // Null = no permissions yet (webmaster) / irrelevant (superadmin, which
  // always bypasses role checks). Set null on delete: losing a role means
  // losing its permissions, not losing the account.
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
