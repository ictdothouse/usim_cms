# shadcn Foundation + App.tsx Migration (Phase 1) — Design

## Context

`apps/admin` (Vite + React + TypeScript) has `components.json` scaffolded for shadcn
since early on, but no component was ever pulled via the CLI — every panel in
`App.tsx` (3482 lines) and `Designer.tsx` (6171 lines) is hand-rolled Tailwind, native
`<select>`s, and browser `alert()`/`confirm()`. Motivation for adopting shadcn now is
long-term maintainability and expandability, not a specific broken interaction today.

`apps/frontend` (Astro SSR, daisyUI, explicit "no client-side JS" architecture
constraint) is untouched — shadcn is a React component library and does not apply
there. daisyUI's only role inside `apps/admin` is as a color-data source for the
"UI Themes" swatch picker (`App.tsx`'s `THEME_PRESETS`), unrelated to admin's own
component styling; that stays as-is.

This spec covers **Phase 1 only**: the shadcn foundation (deps, theme, component set)
plus migrating `App.tsx`'s panels onto it. `Designer.tsx` is split into its own
chrome (Inspector panels, buttons, dropdowns, dialogs — an eventual shadcn candidate)
and its canvas engine (drag/resize/smart-guides — bespoke pointer-event code, never a
component-swap candidate). Both are deliberately deferred to a later spec once Phase 1
establishes the pattern.

## A — Dependencies

- `class-variance-authority`, `@radix-ui/*` (pulled per-component by the shadcn CLI,
  not hand-added)
- `tailwindcss-animate` (Tailwind v3-compatible; admin stays on Tailwind v3, unlike
  `apps/frontend`'s v4)
- `react-hook-form`, `zod`, `@hookform/resolvers` — shadcn's `Form` component is built
  on `react-hook-form`; admin forms today are plain `useState` + manual checks
  (e.g. quick-create title→slug), so this is a real new pattern, not just styling
- `sonner` — toast, replaces `alert()`
- `cmdk` — underlies `Command`/`Combobox`

`lucide-react` is already a dependency and is shadcn's default icon set — no change
needed there.

## B — Theme

`components.json` is reinitialized: style `new-york` (current shadcn CLI default,
denser — better fit for a data-dense dashboard than the old `default` style this file
still names but never used), baseColor `zinc`, `cssVariables: true`.

`index.css` gains shadcn's standard `:root`/`.dark` CSS-variable block (`--background`,
`--foreground`, `--primary`, `--muted`, `--border`, `--destructive`, `--ring`, etc).
`tailwind.config.js` color tokens are extended to read those vars
(`hsl(var(--background))` pattern).

Decision: **reset to shadcn's default zinc theme rather than mapping the existing
brand tokens** (`ink`/`sub`/`body`/`line`/`canvas`/`accent`/`ok`/`warn`). A full visual
redesign of admin is already planned as separate future work, so precisely mapping
today's palette onto shadcn's variables would be effort spent on a look that's being
replaced anyway. The existing tokens are left in `tailwind.config.js`, untouched and
additive — screens not yet migrated in this phase keep using them; they're only
removed once nothing references them anymore.

`darkMode: ["class"]` is already set in `tailwind.config.js` and needs no change — it's
compatible with shadcn's convention as-is. No dark-mode toggle is being wired up as
part of this work (none exists today; out of scope).

## C — Component set (installed via CLI)

Button, Input, Textarea, Label, Select, Checkbox, RadioGroup, Switch, Tabs, Dialog,
AlertDialog, DropdownMenu, Popover, Tooltip, Command, Table, Card, Badge, Separator,
Avatar, ScrollArea, Sheet, Accordion, Collapsible, Skeleton, Progress, Sonner, Form.

Deliberately **not** installed yet: Calendar, Chart, Carousel — no concrete use case in
`apps/admin` today. Adding them later, on demand, once a real feature needs one, is the
whole point of the foundation being in place; installing them speculatively now would
be dead weight.

## D — Migration targets in `App.tsx`

Concrete, not hypothetical — grep-verified against the current file:

- `confirm()`/`window.confirm()` (9 call sites: pages/posts/media ×3/tenants-clone/
  users/roles/settings-restore delete-or-destructive actions) → `AlertDialog`
- `alert()` success notices (`pages-shared`, `posts-shared`) → `sonner` toast
- Quick-create forms (title → auto-slug, etc.) → `react-hook-form` + `zod` schema +
  shadcn `Form`/`Input`
- Native `<select>` elements and ad-hoc dropdown chrome → shadcn `Select`/
  `DropdownMenu`
- Existing modal-style overlays (`MediaPickerModal`, category inline-add, etc.) →
  `Dialog`/`Sheet`

## E — Migration order

Panel by panel, each its own commit, typecheck run after each, so a regression is
traceable to one panel rather than buried in one large diff:

Dashboard → Multisite → Users/Roles → Content panels (Pages/Posts/Categories) → Media
→ Theme → Settings.

`CategoriesPanel.tsx`, `MediaPickerModal.tsx`, `PostEditorPage.tsx` are migrated as
part of whichever panel-pass touches them (Content panels / Media respectively), since
they're already separate files, not inline in `App.tsx`.

## F — Verification

`pnpm --filter @usim-cms/admin typecheck` after each panel's migration commit. No live
browser pass unless explicitly requested — typecheck plus a read of the diff against
each panel's existing behavior is the bar, consistent with how prior Designer.tsx work
in this repo has been verified.

## Out of scope (explicitly)

- `Designer.tsx` — both its Inspector/chrome (a future shadcn candidate) and its
  canvas drag/resize/smart-guides engine (never a component-swap candidate, stays
  custom pointer-event code permanently). Separate future spec.
- `apps/frontend` / daisyUI — different app, not React, not touched.
- Dark-mode toggle — config supports it, nothing wires it up here.
- Full brand-token → shadcn-variable mapping — deferred to the future visual redesign,
  not this phase.
