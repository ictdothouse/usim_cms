import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

// Snapshot captured at insert time — not live-refetched on render. Known
// ceiling: if the source post/page is later renamed/deleted, the card shows
// a stale snapshot. Acceptable for v1; upgrade path is a background re-sync
// job if this becomes a real complaint.
//
// NOTE on installed @blocknote/react@0.51.4 types (differs from a naive
// createReactBlockSpec usage):
// - createReactBlockSpec(config, implementation) returns a FACTORY
//   `(options?) => BlockSpec`, not a BlockSpec itself — it must be invoked
//   before going into `blockSpecs` (see `defaultBlockSpecs`'s entries, which
//   are plain BlockSpec objects, not factories).
// - `toExternalHTML` in the React block-spec implementation is typed as a
//   React FC with the same props shape as `render` (plus `context`), i.e. it
//   returns JSX, not a `{ dom: HTMLElement }` pair — that DOM-returning shape
//   only exists on the non-React `BlockImplementation` in @blocknote/core.

const BOOKMARK_CARD_STYLE = {
  display: "flex",
  gap: "12px",
  border: "1px solid #e2e2e2",
  borderRadius: "8px",
  padding: "12px",
  textDecoration: "none",
  color: "inherit",
  width: "100%",
} as const;

function BookmarkCardContent({
  title,
  excerpt,
  imageUrl,
  targetType,
}: {
  title: string;
  excerpt: string;
  imageUrl: string;
  targetType: "post" | "page";
}) {
  return (
    <>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          style={{
            width: "96px",
            height: "72px",
            objectFit: "cover",
            borderRadius: "6px",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "inline-block",
            fontSize: "10px",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "#6b7280",
            marginBottom: "4px",
          }}
        >
          {targetType === "post" ? "Post" : "Page"}
        </span>
        <div style={{ fontWeight: 600, fontSize: "14px" }}>{title}</div>
        {excerpt && (
          <div
            style={{
              fontSize: "12px",
              color: "#6b7280",
              marginTop: "2px",
            }}
          >
            {excerpt}
          </div>
        )}
      </div>
    </>
  );
}
const createBookmarkCardBlockSpec = createReactBlockSpec(
  {
    type: "bookmarkCard",
    propSchema: {
      targetType: { default: "post" as const, values: ["post", "page"] as const },
      targetId: { default: "" },
      title: { default: "" },
      excerpt: { default: "" },
      imageUrl: { default: "" },
      url: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const { title, excerpt, imageUrl, url, targetType } = block.props;
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={BOOKMARK_CARD_STYLE}
        >
          <BookmarkCardContent
            title={title}
            excerpt={excerpt}
            imageUrl={imageUrl}
            targetType={targetType}
          />
        </a>
      );
    },
    // Self-contained inline-styled HTML with data-bookmark-* attributes that
    // `parse` below reads back — post bodies are stored/rendered as raw
    // sanitized HTML already, so this requires zero apps/frontend changes.
    toExternalHTML: ({ block }) => {
      const { title, excerpt, imageUrl, url, targetType, targetId } = block.props;
      return (
        <a
          href={url}
          data-bookmark-type={targetType}
          data-bookmark-id={targetId}
          data-bookmark-title={title}
          data-bookmark-excerpt={excerpt}
          data-bookmark-image={imageUrl}
          data-bookmark-url={url}
          style={BOOKMARK_CARD_STYLE}
        >
          <BookmarkCardContent
            title={title}
            excerpt={excerpt}
            imageUrl={imageUrl}
            targetType={targetType}
          />
        </a>
      );
    },
    parse: (el) => {
      if (!(el instanceof HTMLElement) || !el.hasAttribute("data-bookmark-type")) return undefined;
      return {
        targetType: (el.getAttribute("data-bookmark-type") as "post" | "page") ?? "post",
        targetId: el.getAttribute("data-bookmark-id") ?? "",
        title: el.getAttribute("data-bookmark-title") ?? "",
        excerpt: el.getAttribute("data-bookmark-excerpt") ?? "",
        imageUrl: el.getAttribute("data-bookmark-image") ?? "",
        url: el.getAttribute("data-bookmark-url") ?? "",
      };
    },
  },
);

// createReactBlockSpec returns a factory, not the spec — call it once to get
// the actual BlockSpec object BlockNoteSchema.create expects.
export const bookmarkCardBlockSpec = createBookmarkCardBlockSpec();

export const bookmarkCardSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, bookmarkCard: bookmarkCardBlockSpec },
});
