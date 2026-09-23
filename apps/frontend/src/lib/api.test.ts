import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePageLayout, resolvePostContent, resolveCategoryName, type Page, type Post } from "./api";

const basePage: Page = {
  id: "p1",
  slug: "home",
  title: "Home",
  layout: [{ type: "section", props: { rows: [] } }],
  bannerImageUrl: null,
  language: "en",
  translations: {},
  headerId: null,
  footerId: null,
  hideHeader: false,
  hideFooter: false,
};

test("resolvePageLayout returns the base layout when code is null or matches the page's own language", () => {
  assert.equal(resolvePageLayout(basePage, null), basePage.layout);
  assert.equal(resolvePageLayout(basePage, "en"), basePage.layout);
});

test("resolvePageLayout falls back to the base layout when the requested language has no translation entry", () => {
  assert.equal(resolvePageLayout(basePage, "ms"), basePage.layout);
});

test("resolvePageLayout uses the OLD retired shape's stored layout as-is when present", () => {
  const oldShapeLayout = [{ type: "section", props: { rows: [], cssClass: "old-shape" } }];
  const page: Page = { ...basePage, translations: { ms: { layout: oldShapeLayout } } };
  assert.equal(resolvePageLayout(page, "ms"), oldShapeLayout);
});

test("resolvePageLayout overlays a flat override key onto a clone of the base layout, leaving the base untouched", () => {
  const page: Page = {
    ...basePage,
    layout: [{ type: "section", props: { rows: [], anchorId: "base-anchor" } }],
    translations: { ms: { overrides: { "0": { anchorId: "ms-anchor" } } } },
  };
  const resolved = resolvePageLayout(page, "ms");
  assert.equal((resolved[0].props as { anchorId?: string }).anchorId, "ms-anchor");
  assert.equal((page.layout[0].props as { anchorId?: string }).anchorId, "base-anchor");
});

test("resolvePageLayout merges a breakpoint-prefixed override key into that node's bp bag instead of props", () => {
  const page: Page = {
    ...basePage,
    layout: [{ type: "section", props: { rows: [] } }],
    translations: { ms: { overrides: { "0": { "tablet:anchorId": "tablet-anchor" } } } },
  };
  const resolved = resolvePageLayout(page, "ms") as Array<{ props?: { bp?: Record<string, string>; anchorId?: string } }>;
  assert.equal(resolved[0].props?.bp?.["tablet:anchorId"], "tablet-anchor");
  assert.equal(resolved[0].props?.anchorId, undefined);
});

const basePost: Post = {
  id: "post1",
  slug: "hello-world",
  title: "Hello World",
  body: "<p>Hi</p>",
  excerpt: "Hi",
  bannerImageUrl: null,
  publishedAt: null,
  category: "News",
  categorySlug: "news",
  categoryTranslations: {},
  tags: [],
  authorEmail: null,
  status: "published",
  showTags: null,
  showCategory: null,
  showAuthor: null,
  showPublishedDate: null,
  language: "en",
  translations: { ms: { title: "Halo Dunia", excerpt: "Halo", body: "<p>Halo</p>" } },
};

test("resolvePostContent returns the base fields when code is null or matches the post's own language", () => {
  assert.deepEqual(resolvePostContent(basePost, null), { title: "Hello World", excerpt: "Hi", body: "<p>Hi</p>" });
  assert.deepEqual(resolvePostContent(basePost, "en"), { title: "Hello World", excerpt: "Hi", body: "<p>Hi</p>" });
});

test("resolvePostContent returns the requested language's stored copy when present", () => {
  assert.deepEqual(resolvePostContent(basePost, "ms"), { title: "Halo Dunia", excerpt: "Halo", body: "<p>Halo</p>" });
});

test("resolvePostContent falls back to the base fields when no translation exists for that code", () => {
  assert.deepEqual(resolvePostContent(basePost, "zh"), { title: "Hello World", excerpt: "Hi", body: "<p>Hi</p>" });
});

test("resolveCategoryName falls back to the post's own category when code is null or has no translation entry", () => {
  assert.equal(resolveCategoryName(basePost, null), "News");
  assert.equal(resolveCategoryName(basePost, "ms"), "News");
});

test("resolveCategoryName returns the per-language name when the category opted into translations", () => {
  const post: Post = { ...basePost, categoryTranslations: { ms: { name: "Berita" } } };
  assert.equal(resolveCategoryName(post, "ms"), "Berita");
});
