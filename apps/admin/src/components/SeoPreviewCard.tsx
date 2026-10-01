// Google-style search-result preview (Webflow's own SEO panel has the same card) —
// used by both Designer's Page Settings panel and PostEditorPage so this markup
// exists once. Pure presentational, no state of its own.
export function SeoPreviewCard({ title, url, description }: { title: string; url: string; description: string }) {
  return (
    <div className="rounded-lg border border-line/30 bg-white p-3">
      <p className="truncate text-[11px] text-[#202124]">{url}</p>
      <p className="truncate text-base text-[#1a0dab]">{title || " "}</p>
      <p className="line-clamp-2 text-xs text-[#4d5156]">{description || " "}</p>
    </div>
  );
}
