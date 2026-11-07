import { createStyleSpec } from "@blocknote/core";
import { GOOGLE_FONTS } from "@ucms/element-style";

// The post editor's font: one of the curated fonts on the selected text; no
// mark means the theme's font. This is core createStyleSpec, not the React
// one, because only it takes a parse(): apps/api keeps the inline
// font-family but drops BlockNote's data-* attributes, so reopening a post
// reads the font back from the style. An unlisted font (pasted from Word,
// say) is ignored, as the API and the site would drop it anyway.
export const fontStyleSpec = createStyleSpec(
  { type: "font", propSchema: "string" },
  {
    render: (value) => {
      const dom = document.createElement("span");
      dom.style.fontFamily = `"${value}"`;
      return { dom, contentDOM: dom };
    },
    parse: (element) => {
      const name = element.style.fontFamily.replace(/^["']|["']$/g, "");
      return GOOGLE_FONTS.includes(name) ? name : undefined;
    },
  },
);
