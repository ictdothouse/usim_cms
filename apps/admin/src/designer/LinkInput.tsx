// A link field that suggests this site's own pages and posts as you type
// (title search through the existing paginated list endpoints, 5 of each),
// so a button/logo/card link is picked instead of typed. Free text still
// commits as-is for an external URL, mailto:, tel: or #anchor. Commits on
// blur/Enter like BufferedInput.
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { Key } from "@/i18n";

// Provided by Designer.tsx; without it (outside a Designer) this is a plain input.
export const LinkSiteContext = createContext<{ tenantHost: string; token: string } | null>(null);

interface Hit {
  title: string;
  href: string;
  kind: "page" | "post";
}

// Same URLs the site serves: slug "home" is the root ([...slug].astro), posts live under /posts/.
const pageHref = (slug: string) => (slug === "home" ? "/" : `/${slug}`);

export function LinkInput({
  value,
  onCommit,
  className,
  placeholder,
  t,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  t: (k: Key) => string;
}) {
  const site = useContext(LinkSiteContext);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(-1);
  const focused = useRef(false);
  const listId = useId();
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  // A typed word searches titles; empty or "#" lists the first few; a path, #anchor or URL is left alone.
  const q = draft.trim() === "#" ? "" : draft.trim();
  const searching = open && !!site && !/^(\/|#|[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i.test(q);
  useEffect(() => {
    if (!searching || !site) {
      setHits([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      const params = { search: q, limit: 5 };
      Promise.all([api.listPagesPage(site.tenantHost, site.token, params), api.listPostsPage(site.tenantHost, site.token, params)])
        .then(([pages, posts]) => {
          if (!live) return;
          setHits([
            ...pages.items.map((r) => ({ title: String(r.title), href: pageHref(String(r.slug)), kind: "page" as const })),
            ...posts.items.map((r) => ({ title: String(r.title), href: `/posts/${String(r.slug)}`, kind: "post" as const })),
          ]);
          setActive(-1);
        })
        .catch(() => live && setHits([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [searching, q, site]);

  const commit = (v: string) => {
    if (v !== value) onCommit(v);
  };
  const pick = (h: Hit) => {
    setDraft(h.href);
    setOpen(false);
    commit(h.href);
  };
  const shown = open && hits.length > 0;
  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        className={className}
        placeholder={placeholder}
        value={draft}
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (shown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i === -1 && step < 0 ? hits.length - 1 : (i + step + hits.length) % hits.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (shown && active >= 0) pick(hits[active]);
            else e.currentTarget.blur();
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {shown && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line/30 bg-white p-1 shadow-lg">
          {hits.map((h, i) => (
            <li
              key={h.kind + h.href}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the input's blur (which closes this list) would fire first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h);
              }}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-xs ${i === active ? "bg-accent/10 text-accent" : "text-ink hover:bg-canvas"}`}
            >
              <span className="block truncate font-semibold">{h.title}</span>
              <span className="flex justify-between gap-2 text-[11px] text-sub">
                <span className="truncate font-mono">{h.href}</span>
                <span className="shrink-0">{t(h.kind === "page" ? "menus-link-page" : "menus-link-post")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
