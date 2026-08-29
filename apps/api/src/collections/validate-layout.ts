// Relocated to @ucms/element-schema (packages/element-schema/src/index.ts) —
// this file is now a thin re-export so existing relative imports
// ("./validate-layout.js" from index.ts/validate-menu.ts/this file's own
// test) keep working unchanged. The actual validation logic (the
// pages.layout XSS/CSS-injection guard) lives in the shared package now —
// see that file's own header comment for why.
export * from "@ucms/element-schema";
