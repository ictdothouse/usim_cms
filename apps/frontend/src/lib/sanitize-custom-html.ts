import sanitizeHtml from "sanitize-html";
import { CUSTOM_HTML_ALLOWED_ATTRIBUTES, CUSTOM_HTML_ALLOWED_SCHEMES, CUSTOM_HTML_ALLOWED_TAGS } from "@ucms/element-style";

// Custom HTML is content, never executable code. Use a strict allowlist at
// render time as well as API write authorization so old database rows and
// direct database edits cannot turn this element into stored XSS. The lists
// live in @ucms/element-style so the Designer's "removed on the live site"
// hint (customHtmlRemovals) reads the same ones.
export function sanitizeCustomHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return sanitizeHtml(value, {
    allowedTags: CUSTOM_HTML_ALLOWED_TAGS,
    allowedAttributes: CUSTOM_HTML_ALLOWED_ATTRIBUTES,
    allowedSchemes: CUSTOM_HTML_ALLOWED_SCHEMES,
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}
