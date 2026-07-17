// Walks a page's `layout` for per-element custom Google Fonts (see
// Designer.tsx's typography fields) so [...slug].astro can ask BaseLayout
// to load them alongside the site theme's own font. Mirrors Designer.tsx's
// canvas-preview font-sync effect, which does the equivalent client-side.
interface El {
  type: string;
  props?: Record<string, string>;
}
interface Col {
  elements?: El[];
}
interface Row {
  columns?: Col[];
}
interface SectionProps {
  rows?: Row[];
}
interface Block {
  type: string;
  props?: Record<string, unknown>;
}

export function collectFonts(layout: Block[]): string[] {
  const fonts = new Set<string>();
  for (const block of layout) {
    if (block.type !== "section") continue;
    const sp = block.props as SectionProps | undefined;
    for (const row of sp?.rows ?? []) {
      for (const col of row.columns ?? []) {
        for (const el of col.elements ?? []) {
          if ((el.type === "heading" || el.type === "text" || el.type === "list") && el.props?.fontFamily) {
            fonts.add(el.props.fontFamily);
          }
        }
      }
    }
  }
  return [...fonts];
}
