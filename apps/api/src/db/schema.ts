import { pgTable, uuid, text, jsonb, timestamp, boolean, unique, integer } from "drizzle-orm/pg-core";

export const pages = pgTable("pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  // Dynamic block layout for the page, e.g. [{ type: "hero", props: {...} }, ...]
  layout: jsonb("layout").notNull().default([]),
  bannerImageUrl: text("banner_image_url"),
  status: text("status").notNull().default("draft"), // "draft" | "published"
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Real taxonomy table (unlike posts.tags, which stays freeform) — a post's
// category is a managed, renameable, FK'd reference, not a repeated string.
// ON DELETE RESTRICT on posts.categoryId (below) is the "can't delete a
// category that's in use" rule — enforced by Postgres, no app-level check.
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Post/Article content per tenant. body is sanitized HTML from the admin
// rich-text editor (see the posts collection's beforeChange hook). Public
// visibility is enforced by RLS: anonymous SELECT only sees status='published'
// (migrations/0003_create_posts.sql) — "private" is deliberately the same
// non-published branch as "draft" (see 0009's comment), just with its own
// publishedAt and a real history snapshot, unlike a draft.
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  excerpt: text("excerpt"),
  bannerImageUrl: text("banner_image_url"),
  status: text("status").notNull().default("draft"), // "draft" | "published" | "private"
  publishedAt: timestamp("published_at"),
  // Category is a real FK into `categories` (a managed taxonomy) — tags stay
  // freeform text, no separate tags table; good enough for a per-tenant blog
  // without inventing a managed-list UI for tags nobody asked for.
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
  tags: text("tags").array().notNull().default([]),
  // Author, within the tenant. No FK: users live in the control-plane
  // database, posts live in the tenant's own database (DB-per-tenant), and
  // Postgres can't FK across databases — same limitation as media.uploadedBy
  // (0006_media_ownership.sql). Stamped once on create (postsCollection's
  // beforeChange hook), never overwritten on update.
  authorId: text("author_id"),
  authorEmail: text("author_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Full content snapshot taken every time a post is explicitly published or
// made private (postsCollection's afterChange hook in index.ts) — not on
// every edit. The admin's "History" panel lists these per post; "Restore"
// copies a snapshot's fields back onto the live post as a new draft (never
// auto-republishes it). Same tenant DB as posts, so a real FK here (unlike
// the cross-database author columns above).
export const postRevisions = pgTable("post_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  excerpt: text("excerpt"),
  bannerImageUrl: text("banner_image_url"),
  category: text("category"),
  tags: text("tags").array().notNull().default([]),
  status: text("status").notNull(), // "published" | "private" — whichever this snapshot was taken for
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Flat, non-nested folders for organizing the media library — a name only,
// membership lives on media.folderId. No parentId: nobody asked for nested
// folders, and flat is one JOIN instead of a recursive query.
export const mediaFolders = pgTable("media_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Upload registry per tenant (tenant schema): one row per file stored via
// storage.ts. The file itself lives on disk/S3; this table is what the admin
// media manager lists and deletes. Only ever queried from the protected
// scope, so RLS requires app.authenticated even for SELECT
// (migrations/0004_create_media.sql, extended by 0005_media_folders.sql).
export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(), // stored name inside the tenant folder
  originalName: text("original_name").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  folderId: uuid("folder_id").references(() => mediaFolders.id, { onDelete: "set null" }),
  altText: text("alt_text"),
  description: text("description"),
  // Who uploaded this file, within the tenant. No FK: users live in the
  // control-plane database, media lives in the tenant's own database (DB-
  // per-tenant), and Postgres can't FK across databases. Nullable so rows
  // from before this column existed don't break; a webmaster never sees
  // those (see index.ts's /api/media ownership filter).
  uploadedBy: text("uploaded_by"),
  uploadedByEmail: text("uploaded_by_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Reusable Designer section blocks, saved by staff and inserted into any
// page on this tenant — like pages/posts/media, per-tenant (own database),
// never publicly exposed (protected-scope routes only, see index.ts).
export const designTemplates = pgTable("design_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // A whole `section` Block ({ type: "section", props: {...} }) — see
  // apps/admin/src/Designer.tsx's Block/SectionProps.
  data: jsonb("data").notNull(),
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

// A user's personal saved theme presets ("my collection" in the admin's
// Theme panel) — same settings shape as site_theme.settings, but owned by a
// user, not a tenant, and never merged/read by the frontend. Purely a
// favourites list the admin picks from to fill the color/font pickers or to
// "Activate" (write into site_theme) again later.
export const themePresets = pgTable("theme_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  // Full list of tenants this webmaster can switch into — always includes
  // tenantHost (kept as the default/first pick). Superadmin ignores this
  // (already unrestricted).
  tenantHosts: text("tenant_hosts").array().notNull().default([]),
  // Null = no permissions yet (webmaster) / irrelevant (superadmin, which
  // always bypasses role checks). Set null on delete: losing a role means
  // losing its permissions, not losing the account.
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
  // Per-user permissions on top of the role's — for one-off grants that
  // don't warrant a whole new named role.
  extraPermissions: text("extra_permissions").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
