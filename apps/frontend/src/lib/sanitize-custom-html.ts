import sanitizeHtml from "sanitize-html";
import {
  CUSTOM_HTML_ALLOWED_ATTRIBUTES,
  CUSTOM_HTML_ALLOWED_SCHEMES,
  CUSTOM_HTML_ALLOWED_TAGS,
  POST_BODY_ALLOWED_STYLES,
  POST_BODY_STYLE_TAGS,
} from "@ucms/element-style";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: CUSTOM_HTML_ALLOWED_TAGS,
  allowedAttributes: CUSTOM_HTML_ALLOWED_ATTRIBUTES,
  allowedSchemes: CUSTOM_HTML_ALLOWED_SCHEMES,
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

// Custom HTML is content, never executable code. Use a strict allowlist at
// render time as well as API write authorization so old database rows and
// direct database edits cannot turn this element into stored XSS. The lists
// live in @ucms/element-style so the Designer's "removed on the live site"
// hint (customHtmlRemovals) reads the same ones.
export function sanitizeCustomHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return sanitizeHtml(value, OPTIONS);
}

// A post's body: the same allowlist plus the inline styles the post editor
// writes (alignment, colors, font, bookmark card), limited to the closed
// shapes apps/api also saves. Rendering it through sanitizeCustomHtml
// dropped every one of them, so those toolbar buttons did nothing on the site.
export function sanitizePostBody(value: unknown): string {
  if (typeof value !== "string") return "";
  return sanitizeHtml(value, {
    ...OPTIONS,
    allowedAttributes: {
      ...CUSTOM_HTML_ALLOWED_ATTRIBUTES,
      ...Object.fromEntries(POST_BODY_STYLE_TAGS.map((tag) => [tag, [...(CUSTOM_HTML_ALLOWED_ATTRIBUTES[tag] ?? []), "style"]])),
    },
    allowedStyles: { "*": POST_BODY_ALLOWED_STYLES },
  });
}
