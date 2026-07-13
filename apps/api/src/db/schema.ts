import { pgTable, uuid, text, jsonb, timestamp, boolean, unique } from "drizzle-orm/pg-core";

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

// Control-plane registry of known tenant hosts, always in the "public"
// schema. Resolved via search_path (tenant schema first, "public" fallback
// after) rather than an explicit qualifier, since Drizzle disallows
// pgSchema("public") — see tenant-pool.ts's SET search_path calls.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  host: text("host").notNull().unique(),
  departmentName: text("department_name").notNull(),
  active: boolean("active").notNull().default(true),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
