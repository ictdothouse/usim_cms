import type { FastifyRequest } from "fastify";
import sanitizeHtml from "sanitize-html";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { AccessArgs, CollectionConfig } from "../collections/config-types.js";
import { validateLayout, validateOverrides, validateElement, isSafeUrl } from "../collections/validate-layout.js";
import { validateMenuItems } from "../collections/validate-menu.js";
import * as schema from "../db/schema.js";
import { getTenantLanguageSelection } from "../db/tenant-pool.js";
import { hasPermission } from "./permissions.js";
import { validateThemeSettings } from "./portal-settings.js";

// pages.settings.gap (and Row.gap inside pages.layout) is interpolated
// directly into a raw CSS string by SectionBlock.astro
// (`gap:${row.gap ?? pageGap ?? "2rem"}`), not set via a safe DOM style API —
// an unconstrained value could break out of that one declaration via `;` and
// inject arbitrary CSS (or worse) into every visitor's page for this tenant.
// Expressed as a JSON-schema pattern so Fastify's AJV validation rejects a
// bad value before it ever reaches the DB.
const GAP_PATTERN = "^$|^[0-9]+(\\.[0-9]+)?(px|rem|em|%|vh|vw)?$";

// The 8 CollectionConfig objects + their before/after hooks — moved out of
// index.ts verbatim (god-file breakup, index.ts, final step). The actual
// registerPublicCollectionRoutes/registerProtectedCollectionRoutes CALLS for
// pages/posts/categories/menus/symbols/events/siteChrome stay grouped here
// too (registerPublicCollections/registerProtectedCollections below) since
// they were already grouped together at their call sites in index.ts —
// templatesCollection's own registerProtectedCollectionRoutes call is NOT
// included here: it's interleaved with a hand-rolled GET route later in
// index.ts's protected-scope closure and stays exactly where it is, just
// importing `templatesCollection` from this file instead of a local const.

// Section lock (Page Blueprint deferred item): a superadmin can mark a
// section `locked` (props.locked === "true", Designer.tsx's Section
// Inspector) so it survives edits by a non-superadmin unchanged — e.g. a
// blueprint's mandated footer/CTA section that shouldn't be removable once
// cloned into a real page. Sections have no stable id of their own (only
// rows/columns/elements do, see designer/types.ts), so a locked section is
// matched by an exact deep-equal copy existing SOMEWHERE in the new layout,
// not by array position — this still blocks every real edit (delete,
// content change, style change) while tolerating reordering/insertion of
// unrelated sections around it. This is the real enforcement point;
// Designer.tsx's own disabled buttons/read-only Inspector notice are UX only.
function findLockedSections(layout: unknown[]): unknown[] {
  return layout.filter((block) => {
    if (typeof block !== "object" || block === null) return false;
    const b = block as Record<string, unknown>;
    const props = b.props as Record<string, unknown> | undefined;
    return b.type === "section" && props?.locked === "true";
  });
}

function lockedSectionViolation(oldLayout: unknown[], newLayout: unknown[]): string | null {
  for (const oldBlock of findLockedSections(oldLayout)) {
    const stillPresent = newLayout.some((b) => JSON.stringify(b) === JSON.stringify(oldBlock));
    if (!stillPresent) return "a locked section was removed or modified — only a superadmin can change it";
  }
  return null;
}

// publishedAt arrives as an ISO string over JSON; Drizzle's timestamp column
// needs a Date. Same conversion as sanitizePostBody, plus the updatedAt bump
// posts already gets and pages never did.
const pagesBeforeChange = async (data: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const record = data as Record<string, unknown>;
  if (record.layout !== undefined) {
    const err = validateLayout(record.layout);
    // beforeChange has no `reply` in its signature (see config-types.ts) —
    // throwing here happens before generic-crud.ts's insert/update try block,
    // so it's never swallowed into a 23505 500; Fastify's default error
    // handler honors `.statusCode` on a thrown Error, giving a clean 400
    // instead of the 500 an unannotated throw would produce.
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
    if (req.method === "PATCH" && req.user.role !== "superadmin") {
      const { id } = req.params as { id?: string };
      if (id) {
        const [existing] = await req.db.select({ layout: schema.pages.layout }).from(schema.pages).where(eq(schema.pages.id, id));
        if (existing) {
          const lockErr = lockedSectionViolation(existing.layout as unknown[], record.layout as unknown[]);
          if (lockErr) throw Object.assign(new Error(lockErr), { statusCode: 403 });
        }
      }
    }
  }
  // i18n Phase 5 — each translations[code].layout (the OLD, retired shape —
  // still accepted from an existing unmigrated row, or a raw API caller) is
  // just as much a raw layout tree as the top-level one above, and gets the
  // exact same check. translations[code].overrides (the CURRENT shape —
  // Designer.tsx's language-pill rework, see CLAUDE.md's i18n Phase 5 note)
  // is a sparse prop-key/value bag, not a layout tree, so it gets its own
  // matching validator instead — every value in it is exactly as much of a
  // CSS-injection/XSS surface as the same key would be on the base layout.
  if (record.translations && typeof record.translations === "object") {
    for (const entry of Object.values(record.translations as Record<string, unknown>)) {
      const e = entry as Record<string, unknown> | null;
      if (e?.layout !== undefined) {
        const err = validateLayout(e.layout);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
      if (e?.overrides !== undefined) {
        const err = validateOverrides(e.overrides);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
    }
  }
  // Page settings — contentWidth/paddingX are page-wide defaults SectionBlock.astro
  // falls back to (mirrors the existing `gap` default); `theme` is a snapshot copy of
  // a saved theme preset, validated with the exact same rules `/api/theme` enforces on
  // site_theme itself, since it lands in the same CSS-custom-property pipeline.
  if (record.settings && typeof record.settings === "object") {
    const settings = record.settings as Record<string, unknown>;
    if (settings.contentWidth !== undefined && settings.contentWidth !== "contained" && settings.contentWidth !== "full") {
      throw Object.assign(new Error("settings.contentWidth must be \"contained\" or \"full\""), { statusCode: 400 });
    }
    if (settings.paddingX !== undefined && (typeof settings.paddingX !== "string" || !new RegExp(GAP_PATTERN).test(settings.paddingX))) {
      throw Object.assign(new Error("settings.paddingX must be a plain CSS length"), { statusCode: 400 });
    }
    if (settings.theme !== undefined) {
      if (typeof settings.theme !== "object" || settings.theme === null) {
        throw Object.assign(new Error("settings.theme must be an object"), { statusCode: 400 });
      }
      const err = validateThemeSettings(settings.theme as Record<string, unknown>);
      if (err) throw Object.assign(new Error(`settings.theme: ${err}`), { statusCode: 400 });
    }
  }
  // i18n Phase 4 — same validation/thrown-.statusCode convention as
  // postsBeforeChange's own language check.
  if (typeof record.language === "string") {
    const { allEnabled } = await getTenantLanguageSelection(req.tenantHost);
    if (!allEnabled.some((l) => l.code === record.language)) {
      throw Object.assign(new Error("language must be one of this site's enabled languages"), { statusCode: 400 });
    }
  }
  if (typeof record.publishedAt === "string") record.publishedAt = new Date(record.publishedAt);
  record.updatedAt = new Date();
  return record;
};

// Upgrades any surviving legacy top-level "hero" block (the retired
// BlockBuilder shape — Designer.tsx has no edit UI for a non-"section"
// block at all) into an equivalent section on every read, for both
// Designer's own fetch and the public site's (same GET /api/pages route).
// In-memory only, never written back — a page carrying one silently
// upgrades for real the next time it's saved through Designer, same
// non-destructive convention as this codebase's other schema evolutions.
const pagesAfterRead = (items: unknown[]) =>
  (items as Record<string, unknown>[]).map((item) => {
    const layout = item.layout;
    if (!Array.isArray(layout) || !layout.some((b) => (b as { type?: string })?.type === "hero")) return item;
    return {
      ...item,
      layout: layout.map((b) => {
        const block = b as { type?: string; props?: Record<string, unknown> };
        if (block.type !== "hero") return b;
        const { title, subtitle, imageUrl } = block.props ?? {};
        const elements = [
          { type: "heading", props: { level: "1", text: title ?? "" } },
          { type: "text", props: { text: subtitle ?? "" } },
        ];
        return {
          type: "section",
          props: { rows: [{ columns: [{ span: 1, elements }] }], ...(imageUrl ? { bgImage: imageUrl } : {}) },
        };
      }),
    };
  });

// Snapshots the page into page_revisions whenever a request explicitly
// publishes it (req.body.status, the raw incoming payload — not just
// "happens to already be published", so a plain content edit via Designer's
// Save never re-snapshots). Mirrors postsAfterChange exactly, minus the
// "private" branch — pages have no equivalent status.
const pagesAfterChange = async (item: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const requested = (req.body as Record<string, unknown>)?.status;
  if (requested !== "published") return;
  const row = item as Record<string, unknown>;
  await req.db.insert(schema.pageRevisions).values({
    pageId: row.id as string,
    title: row.title as string,
    layout: (row.layout as unknown[]) ?? [],
    settings: (row.settings as Record<string, unknown>) ?? {},
    bannerImageUrl: row.bannerImageUrl as string | null,
    status: row.status as string,
    publishedAt: row.publishedAt as Date | null,
  });
};

export const pagesCollection: CollectionConfig = {
  slug: "pages",
  table: schema.pages,
  createSchema: {
    type: "object",
    required: ["slug", "title"],
    additionalProperties: false,
    properties: {
      slug: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      layout: { type: "array" },
      bannerImageUrl: { type: "string" },
      status: { type: "string", enum: ["draft", "published"] },
      settings: {
        type: "object",
        additionalProperties: false,
        properties: {
          gap: { type: "string", pattern: GAP_PATTERN },
          contentWidth: { type: "string", enum: ["contained", "full"] },
          paddingX: { type: "string", pattern: GAP_PATTERN },
          theme: { type: "object" },
          themePresetName: { type: "string" },
        },
      },
      language: { type: ["string", "null"] },
      multilangEnabled: { type: "boolean" },
      translations: { type: "object" },
    },
  },
  shareable: {
    title: (row) => row.title as string,
    link: (row, tenantHost) => `https://${tenantHost}/${row.slug as string}`,
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "pages.create"),
    update: (a) => hasPermission(a, "pages.update"),
    delete: (a) => hasPermission(a, "pages.delete"),
  },
  hooks: {
    beforeChange: pagesBeforeChange,
    afterChange: pagesAfterChange,
    afterRead: pagesAfterRead,
  },
};

// body is author-written HTML rendered raw on the public site — sanitize at
// this trust boundary on every write, whatever the client sent. Author is
// stamped once, on create only (req.method — PATCH never overwrites it), so
// editing someone else's post never reassigns authorship.
//
// bookmarkCard's toExternalHTML (blocknote/bookmarkCard.tsx) encodes the
// block as data-bookmark-* attrs + a fixed, hardcoded inline style on the
// a/img/div/span it renders — both are needed for parse() to reconstitute
// the block on reopen and for the public frontend to render the card's
// layout, so they must survive this trust-boundary sanitize on every save.
// `style` isn't allowed unrestricted (that would let arbitrary saved HTML
// carry CSS-injection payloads, e.g. url()-based exfiltration) —
// allowedStyles below whitelists only the exact property/value shapes
// BOOKMARK_CARD_STYLE ever emits. Shared by the top-level `body` and every
// i18n Phase 5 `translations[code].body` — a translation's body is exactly
// as much of a trust boundary as the base one.
function sanitizePostBodyHtml(html: string): string {
  const bookmarkCardStyleValue = [/^inherit$|^none$|^flex$|^inline-block$|^cover$|^uppercase$/, /^-?\d+(\.\d+)?(px|%)?$/, /^#[0-9a-fA-F]{3,8}$/, /^\d+px solid #[0-9a-fA-F]{3,8}$/];
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: [
        ...sanitizeHtml.defaults.allowedAttributes.a,
        "style",
        "data-bookmark-type",
        "data-bookmark-id",
        "data-bookmark-title",
        "data-bookmark-excerpt",
        "data-bookmark-image",
        "data-bookmark-url",
      ],
      img: ["src", "alt", "style"],
      div: ["style"],
      span: ["style"],
    },
    allowedStyles: {
      "*": {
        display: bookmarkCardStyleValue,
        gap: bookmarkCardStyleValue,
        border: bookmarkCardStyleValue,
        "border-radius": bookmarkCardStyleValue,
        padding: bookmarkCardStyleValue,
        "text-decoration": bookmarkCardStyleValue,
        color: bookmarkCardStyleValue,
        width: bookmarkCardStyleValue,
        height: bookmarkCardStyleValue,
        "object-fit": bookmarkCardStyleValue,
        "flex-shrink": bookmarkCardStyleValue,
        "min-width": bookmarkCardStyleValue,
        flex: bookmarkCardStyleValue,
        "font-size": bookmarkCardStyleValue,
        "font-weight": bookmarkCardStyleValue,
        "text-transform": bookmarkCardStyleValue,
        "margin-bottom": bookmarkCardStyleValue,
        "margin-top": bookmarkCardStyleValue,
      },
    },
  });
}

const postsBeforeChange = async (data: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const record = data as Record<string, unknown>;
  // i18n Phase 3 — same thrown-.statusCode convention as pagesBeforeChange's
  // validateLayout check above: reject before generic-crud's insert/update
  // try block runs, so this is a clean 400, never a raw 500.
  if (typeof record.language === "string") {
    const { allEnabled } = await getTenantLanguageSelection(req.tenantHost);
    if (!allEnabled.some((l) => l.code === record.language)) {
      throw Object.assign(new Error("language must be one of this site's enabled languages"), { statusCode: 400 });
    }
  }
  // JSON gives an ISO string; Drizzle timestamp columns need a Date.
  if (typeof record.publishedAt === "string") record.publishedAt = new Date(record.publishedAt);
  record.updatedAt = new Date();
  if (typeof record.body === "string") record.body = sanitizePostBodyHtml(record.body);
  if (record.translations && typeof record.translations === "object") {
    for (const entry of Object.values(record.translations as Record<string, Record<string, unknown>>)) {
      if (entry && typeof entry.body === "string") entry.body = sanitizePostBodyHtml(entry.body);
    }
  }
  if (req.method === "POST" && req.user) {
    record.authorId = req.user.userId;
    record.authorEmail = req.user.email;
  }
  return record;
};

// Snapshots the post into post_revisions whenever a request explicitly
// publishes or makes it private (req.body.status, the raw incoming payload —
// not just "happens to already be published", so a plain content edit via
// PostEditor's Save never re-snapshots). "private" gets a real history entry
// too, same as "published" — both are "this went live" events, just with
// different public visibility (see 0009's migration comment).
const postsAfterChange = async (item: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const requested = (req.body as Record<string, unknown>)?.status;
  if (requested !== "published" && requested !== "private") return;
  const row = item as Record<string, unknown>;
  let categoryName: string | null = null;
  if (row.categoryId) {
    const [cat] = await req.db.select().from(schema.categories).where(eq(schema.categories.id, row.categoryId as string));
    categoryName = cat?.name ?? null;
  }
  await req.db.insert(schema.postRevisions).values({
    postId: row.id as string,
    title: row.title as string,
    body: row.body as string,
    excerpt: row.excerpt as string | null,
    bannerImageUrl: row.bannerImageUrl as string | null,
    category: categoryName,
    tags: (row.tags as string[]) ?? [],
    status: row.status as string,
    publishedAt: row.publishedAt as Date | null,
  });
};

// The public posts list/get returns the raw row, which only has categoryId
// (uuid) — categories.name text column was dropped in migration 0010. The
// frontend's Post.category: string | null contract (apps/frontend/src/lib/
// api.ts, rendered by posts/[slug].astro) expects a resolved name, so add it
// here rather than pushing the join onto every frontend consumer.
const postsAfterRead = async (items: unknown[], req: FastifyRequest) => {
  const rows = items as Record<string, unknown>[];
  const categoryIds = [...new Set(rows.map((r) => r.categoryId as string | null).filter((v): v is string => Boolean(v)))];
  const byId = new Map<string, { name: string; slug: string; translations: unknown; multilangEnabled: boolean }>();
  if (categoryIds.length > 0) {
    const cats = await req.db.select().from(schema.categories).where(inArray(schema.categories.id, categoryIds));
    for (const cat of cats) byId.set(cat.id, { name: cat.name, slug: cat.slug, translations: cat.translations, multilangEnabled: cat.multilangEnabled });
  }
  return rows.map((r) => {
    const cat = r.categoryId ? byId.get(r.categoryId as string) : undefined;
    return {
      ...r,
      category: cat?.name ?? null,
      categorySlug: cat?.slug ?? null,
      // i18n follow-up — resolvePostContent's sibling for the category name:
      // the frontend picks translations[lang].name when the category opted
      // into multilangEnabled, otherwise `category` (above) is always shown
      // as-is regardless of viewed language ("keep original name").
      categoryTranslations: cat?.multilangEnabled ? cat.translations : {},
    };
  });
};

export const postsCollection: CollectionConfig = {
  slug: "posts",
  table: schema.posts,
  createSchema: {
    type: "object",
    required: ["slug", "title"],
    additionalProperties: false,
    properties: {
      slug: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      body: { type: "string" },
      excerpt: { type: "string" },
      bannerImageUrl: { type: "string" },
      status: { type: "string", enum: ["draft", "published", "private"] },
      categoryId: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
      language: { type: ["string", "null"] },
      multilangEnabled: { type: "boolean" },
      translations: { type: "object" },
    },
  },
  shareable: {
    title: (row) => row.title as string,
    excerpt: (row) => (row.excerpt as string | null) ?? "",
    link: (row, tenantHost) => `https://${tenantHost}/posts/${row.slug as string}`,
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "posts.create"),
    update: (a) => hasPermission(a, "posts.update"),
    delete: (a) => hasPermission(a, "posts.delete"),
  },
  hooks: {
    beforeChange: postsBeforeChange,
    afterChange: postsAfterChange,
    afterRead: postsAfterRead,
  },
};

const categoriesBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  record.updatedAt = new Date();
  if (record.translations && typeof record.translations === "object") {
    for (const [code, entry] of Object.entries(record.translations as Record<string, unknown>)) {
      const name = (entry as Record<string, unknown> | null)?.name;
      if (typeof name !== "string") {
        const err = new Error(`translations.${code}.name must be a string`) as Error & { statusCode?: number };
        err.statusCode = 400;
        throw err;
      }
    }
  }
  return record;
};

// Gated on posts.* permissions (not a new categories.* resource) — managing
// categories is a sub-concern of managing posts.
export const categoriesCollection: CollectionConfig = {
  slug: "categories",
  table: schema.categories,
  createSchema: {
    type: "object",
    required: ["name", "slug"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      slug: { type: "string", minLength: 1 },
      translations: { type: "object" },
      multilangEnabled: { type: "boolean" },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "posts.update"),
    update: (a) => hasPermission(a, "posts.update"),
    delete: (a) => hasPermission(a, "posts.update"),
  },
  hooks: { beforeChange: categoriesBeforeChange },
};

// Site navigation menus. `items` is a nested tree (see validate-menu.ts) —
// no separate menu-items table, the whole structure lives in one jsonb
// column, same "one row holds the whole tree" shape templates.data already
// uses. Gated on its own menus.write permission (not pages.*/posts.*) since
// managing site navigation is its own concern, not a sub-concern of either.
const menusBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  const err = validateMenuItems(record.items ?? []);
  if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  record.updatedAt = new Date();
  return record;
};

export const menusCollection: CollectionConfig = {
  slug: "menus",
  table: schema.menus,
  createSchema: {
    type: "object",
    required: ["name"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      items: { type: "array" },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "menus.write"),
    update: (a) => hasPermission(a, "menus.write"),
    delete: (a) => hasPermission(a, "menus.write"),
  },
  hooks: { beforeChange: menusBeforeChange },
};

// Events calendar. Own events.write permission (not posts.*/pages.*, same
// reasoning as menus.write) — managing the events calendar is its own
// concern. registrationUrl/imageUrl are scheme-checked the same way any
// other author-supplied URL in this codebase is (isSafeUrl) since both
// render as a real href/src, not sanitized HTML.
const eventsBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  if (typeof record.registrationUrl === "string" && record.registrationUrl !== "" && !isSafeUrl(record.registrationUrl)) {
    throw Object.assign(new Error("registrationUrl has an unsafe URL scheme"), { statusCode: 400 });
  }
  if (typeof record.imageUrl === "string" && record.imageUrl !== "" && !isSafeUrl(record.imageUrl)) {
    throw Object.assign(new Error("imageUrl has an unsafe URL scheme"), { statusCode: 400 });
  }
  if (typeof record.startDate === "string") record.startDate = new Date(record.startDate);
  if (typeof record.endDate === "string") record.endDate = new Date(record.endDate);
  record.updatedAt = new Date();
  return record;
};

export const eventsCollection: CollectionConfig = {
  slug: "events",
  table: schema.events,
  createSchema: {
    type: "object",
    required: ["title", "startDate"],
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1 },
      description: { type: "string" },
      startDate: { type: "string" },
      endDate: { type: ["string", "null"] },
      location: { type: ["string", "null"] },
      imageUrl: { type: ["string", "null"] },
      registrationUrl: { type: ["string", "null"] },
      status: { type: "string", enum: ["draft", "published"] },
    },
  },
  // No `shareable` — events have no dedicated public detail page to link to
  // (unlike posts/pages), so "Share to portal" wouldn't have a real URL.
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "events.write"),
    update: (a) => hasPermission(a, "events.write"),
    delete: (a) => hasPermission(a, "events.write"),
  },
  hooks: { beforeChange: eventsBeforeChange },
};

// Header/Footer designer (see docs/superpowers/specs/2026-09-04-header-footer-designer-design.md).
// Own headerFooter.write permission, same reasoning as menus.write/events.write
// — managing site chrome is its own concern, not a sub-concern of pages.*.
// `layout`/`translations[code].layout` get the exact same validateLayout()
// pass pagesBeforeChange runs, since a header/footer canvas is built from the
// same Section/Row/Column/Element tree a page is. The one-default-per-kind
// invariant is enforced here (not a DB constraint) by flipping every OTHER
// row of the same kind to isDefault=false whenever this write sets it true —
// "exactly one," flip-based rather than reject-based, since there's no
// equivalent of tenant_languages' guardLastEnabled "can't go below zero" (a
// tenant is allowed to have zero defaults, e.g. before the first header is
// ever published).
const siteChromeBeforeChange = async (data: unknown, _args: AccessArgs, req: FastifyRequest) => {
  const record = data as Record<string, unknown>;
  if (record.kind !== undefined && record.kind !== "header" && record.kind !== "footer") {
    throw Object.assign(new Error('kind must be "header" or "footer"'), { statusCode: 400 });
  }
  if (record.layout !== undefined) {
    const err = validateLayout(record.layout);
    if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  }
  if (record.translations && typeof record.translations === "object") {
    for (const entry of Object.values(record.translations as Record<string, unknown>)) {
      const e = entry as Record<string, unknown> | null;
      if (e?.layout !== undefined) {
        const err = validateLayout(e.layout);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
      if (e?.overrides !== undefined) {
        const err = validateOverrides(e.overrides);
        if (err) throw Object.assign(new Error(err), { statusCode: 400 });
      }
    }
  }
  if (record.isDefault === true) {
    const { id } = req.params as { id?: string };
    let kind = record.kind as string | undefined;
    if (!kind && id) {
      const [existing] = await req.db.select({ kind: schema.siteChrome.kind }).from(schema.siteChrome).where(eq(schema.siteChrome.id, id));
      kind = existing?.kind as string | undefined;
    }
    if (kind) {
      await req.db
        .update(schema.siteChrome)
        .set({ isDefault: false })
        .where(id ? and(eq(schema.siteChrome.kind, kind), ne(schema.siteChrome.id, id)) : eq(schema.siteChrome.kind, kind));
    }
  }
  record.updatedAt = new Date();
  return record;
};

export const siteChromeCollection: CollectionConfig = {
  slug: "siteChrome",
  table: schema.siteChrome,
  createSchema: {
    type: "object",
    required: ["kind", "name"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["header", "footer"] },
      name: { type: "string", minLength: 1 },
      layout: { type: "array" },
      translations: { type: "object" },
      settings: { type: "object" },
      isDefault: { type: "boolean" },
      status: { type: "string", enum: ["draft", "published"] },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "headerFooter.write"),
    update: (a) => hasPermission(a, "headerFooter.write"),
    delete: (a) => hasPermission(a, "headerFooter.write"),
  },
  hooks: { beforeChange: siteChromeBeforeChange },
};

// Reusable Designer section blocks. Protected-scope only (see registration
// in index.ts) — no `access.update` since there's no PATCH route (replacing a
// template is delete-and-recreate), and no `shareable` since these aren't
// site content. Gated on the existing pages.* permissions rather than a new
// templates.* category — a webmaster who can edit pages can manage these.
export const templatesCollection: CollectionConfig = {
  slug: "templates",
  table: schema.designTemplates,
  createSchema: {
    type: "object",
    required: ["name", "data"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      data: { type: "object" },
    },
  },
  // No `read` here — registerProtectedCollectionRoutes has no GET of its own
  // (see the hand-rolled /api/templates GET in index.ts, since this collection
  // deliberately has no public route to pair with, unlike pages/posts).
  access: {
    create: (a) => hasPermission(a, "pages.create"),
    delete: (a) => hasPermission(a, "pages.delete"),
  },
};

// Live-linked reusable component. Unlike templates above, this DOES need
// read+update: a page's "symbol" element resolves `node` at render time (both
// admin canvas and the public site, hence the public registration below —
// same reasoning as menus), and "Edit Master" PATCHes `node` in place rather
// than delete-and-recreate. Reuses pages.* permissions, same precedent as
// templates above (no new symbols.* permission category).
const symbolsBeforeChange = (data: unknown) => {
  const record = data as Record<string, unknown>;
  const err = validateElement(record.node, "node");
  if (err) throw Object.assign(new Error(err), { statusCode: 400 });
  record.updatedAt = new Date();
  return record;
};

export const symbolsCollection: CollectionConfig = {
  slug: "symbols",
  table: schema.symbols,
  createSchema: {
    type: "object",
    required: ["name", "node"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      node: { type: "object" },
    },
  },
  access: {
    read: () => true,
    create: (a) => hasPermission(a, "pages.create"),
    update: (a) => hasPermission(a, "pages.update"),
    delete: (a) => hasPermission(a, "pages.delete"),
  },
  hooks: { beforeChange: symbolsBeforeChange },
};
