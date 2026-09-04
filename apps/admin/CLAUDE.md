# apps/admin — additional context

Loaded when working under apps/admin/. See the repo root CLAUDE.md for cross-cutting constraints.

- **`apps/admin`** — Vite + React + TypeScript, Tailwind CSS, Shadcn UI conventions (`components.json`,
  `src/lib/utils.ts`'s `cn` helper, which also holds the shared `slugify`/`oklchToHex` used by both
  `App.tsx` and `Designer.tsx`). No components have been added via the shadcn CLI yet — `pnpm dlx
  shadcn@latest add <component>` from `apps/admin` will place them under `src/components`. Routing is
  `react-router-dom`'s `BrowserRouter` (`App.tsx`'s default export): `Shell`'s `<Routes>` maps
  `/dashboard`, `/multisite`, `/users`, `/roles`, `/content/*`, `/theme`, `/global-theme`, `/feed`,
  `/settings` (the superadmin-only tabs redirect a webmaster session to `/dashboard` via `<Navigate>`,
  not a hidden-but-reachable route), and `ContentManager` — itself mounted at `/content/*` — nests its own
  sub-tree: `pages`, `pages/:id` (`PageDesignerRoute` → `Designer`), `posts`, `posts/categories`
  (`CategoriesPanel`), `posts/:id` (`PostEditorPage`), `media`, and, superadmin-only, `theme`. Both
  `Designer` and `PostEditorPage` are real routed pages reached by navigating to a row's id
  (`navigate(item.id)` right after quick-create, or a list row's Design/Edit button) — going back is a
  real `navigate("/content/pages")`/`navigate("/content/posts")`, not a `useState`-driven conditional
  mount the way `PagesPanel`'s `BlockBuilder` (the older inline page-block editor, still expand-under-row)
  remains. The page builder itself lives in `src/Designer.tsx`: drag-drop block canvas, **Live Edit**
  (opens by default — the real frontend page rendered in an iframe with click-to-select/inline editing via a postMessage
  bridge to `BaseLayout.astro`, always minted a preview token even for a published page so the bridge
  actually activates), and a design template library. A page's slug is auto-derived from its title on
  create (`PagesPanel`'s quick-create form) and stays editable afterward via a click-to-edit field in
  Designer's header. Element types (`ELS` registry) span the basics (heading/text/image/button/spacer/
  divider/embed/icon/list/html/gallery) plus 4 richer ones for real-world department-site content:
  **accordion** and **tabs** (each `items` field is `Question|Answer`/`Label|Content` pairs, one per
  line — same plain delimited-line convention `list`'s items already uses), **info box** (icon+heading+text
  "feature card" — pairs naturally with a themeable Column as its card background, per `COLUMN_FIELDS`,
  rather than having its own bg/border), and **slider/banner**. Accordion/tabs' stored format is still
  the plain `a|b`-per-line string (`validate-layout.ts`/`SectionBlock.astro` parse it exactly as before) —
  only the Inspector's editing UI is structured: `FieldKind` grew `"pairs"` (add/remove item cards with two
  labeled inputs each, labels driven by each field's `subLabels`), so authors never hand-type the
  `|`-delimited line themselves; `parsePairs` converts between the array the UI edits and the flat string
  that's actually saved. Interactivity stays proportional to `apps/frontend`'s "no client-side JS"
  convention below: accordion is native `<details>`/`<summary>` (zero JS, `name`-grouped only when the
  author opts into "one open at a time"); tabs is the one exception needing a real click handler, a small
  event-delegated `<script>` Astro bundles once per page regardless of how many instances render.
  Slider/banner's `slides` field is a **JSON array**, one object per slide (`imageUrl`, `heading`,
  `subtitle`, `textPosition` — left/center/right —, `overlayColor`+`overlayOpacity` for the darkening
  scrim, and a `buttons` array — each button its own card in the Inspector (not a cramped single-line
  row) with `label`/`href`, `variant` (primary/outline), `size` (sm/md/lg), an optional hex `color`/
  `textColor` override (empty = theme default; `textColor` also recolors an outline button's border
  since its CSS uses `currentColor`), an optional `radius` (px), and `position` — `"flow"` (default,
  laid out inside the slide's text block same as before) or `"custom"` (absolutely placed anywhere in
  the slide via `x`/`y` percent). Custom placement is set either by dragging inside a small position
  minimap next to each button (`dragPosition()` in Designer.tsx — plain pointerdown/pointermove/pointerup
  against the minimap's own bounding rect, not a hook, safe to call from inside the buttons `.map()`) or
  by clicking one of 9 preset dots (`POSITION_PRESETS`, just canonical x/y shortcuts — there's no
  separate named-preset enum to keep in sync across admin/frontend/validator, a preset is only ever
  `{x, y}` like a hand-dragged one). SectionBlock.astro splits a slide's buttons into `flowButtons`
  (rendered inside `.ds-slide-content` as before) and `freeButtons` (rendered as `.ds-slide-btn-free`
  siblings, `position:absolute; left:{x}%; top:{y}%` on `.ds-slide`, which already has `position:relative`)
  — `slideButtonStyle()` turns color/textColor/radius/`fontSize` into inline style overrides, each
  re-checked against a hex/numeric regex at render time (defense-in-depth, same as `bgImage`'s
  `safeCssUrl` guard) on top of `validate-layout.ts`'s write-time check. `.ds-btn`'s padding is `em`, not
  `rem` — an inline `fontSize` override scales the whole pill (label + padding) together instead of just
  enlarging the text inside a fixed-size button.
  A button also has an optional `fontSize` (px, "" = derive from `size`) — the canvas's drag-to-resize
  handle (below) sets this directly; the `size` sm/md/lg dropdown is still the quick discrete preset,
  `fontSize` is the continuous override on top of it, same additive relationship as `color`/`radius`.
  The Inspector's small per-button minimap (drag-or-preset-click to set `x`/`y`) coexists with a second,
  richer way to do the same thing directly on the canvas: `ElPreview`'s `"slider"` case (Blocks-mode
  canvas preview, not Live Edit) renders slide 1's actual buttons with their real style/position — a flow
  button inline next to heading/subtitle, a custom one absolutely placed at its `x`/`y` — and every button
  chip is itself draggable (`startMove`, mirrors `dragPosition`'s pointerdown/pointermove/pointerup-on-
  window pattern, but resolves the containing slide box via `closest("[data-slide-box]")` instead of using
  its own small rect, and works from either starting position — dragging a "flow" button switches it to
  "custom" at the drop point) and has a small corner handle for drag-to-resize (`startResize`, horizontal
  drag delta scales `fontSize` px, clamped 10-40 — same interaction shape as this file's existing
  padding/margin edge-drag handles, just driving a font size instead of a length prop). Both write through
  `updateButtonAt()`, which — like the heading/text canvas-edit `commit()` above it — always re-reads the
  current `slides` off the fresh `bs` inside `mutate()` rather than off a value captured at render time,
  since a drag fires many pointermove events against what would otherwise be a stale closure. Both
  surfaces (the Inspector minimap and each canvas button chip) are also keyboard-focusable
  (`tabIndex={0}`) with an arrow-key nudge (`nudgeButton()`, shared by both) — 2% per press, clamped
  0-100, for anyone who doesn't want to hand-drag or needs a precise realign; nudging a still-"flow"
  button starts it from `BUTTON_DEFAULTS`' center and switches it to `"custom"`, same as a drag would.
  Dragging on the canvas also shows Figma-style smart guides: a red center-alignment line on whichever
  axis the button is within 3% of the slide's own center (and snaps to exactly 50 on that axis), plus
  red spacing ticks on BOTH axes — vertical (top/bottom) and horizontal (left/right) — against whichever
  candidate is nearest, where a candidate is the heading/subtitle text block or any OTHER button on the
  same slide (`edgeGap()`, module-level: only returns a mark when the two rects don't overlap on the
  requested axis but do overlap on the other, so the tick has a sensible perpendicular anchor point;
  `startMove` calls it once per axis per candidate and keeps only the smallest/nearest result per axis, so
  a slide with several buttons doesn't draw a cluttered mark against every one of them at once). This reads
  real DOM rects (`sliderPreviewRefs`, keyed by `el.id` like `editingText` above it — a flat single ref
  would get clobbered by whichever slider block rendered last if a page has more than one — and holding a
  `buttons: Record<number, HTMLElement | null>` map too, keyed by button index, since a button's own
  rendered size varies with its `fontSize`/padding and can't be derived from the x/y percent model the rest
  of this feature uses) rather than that percent model, since alignment-to-actual-rendered-content needs
  real pixel geometry — the dragged button itself doesn't have a live DOM rect mid-drag (it's still
  animating toward its new spot), so its own rect is reconstructed as a same-shaped `EdgeRect` from the
  live cursor position plus its pre-drag size snapshot. `sliderGuide` (transient React state, tagged with
  `elId` so only the slider block actually being dragged draws its own guide) drives the overlay and is
  cleared on pointerup. Each tick also shows its own rounded px length as a small label at its midpoint —
  a bare tick mark didn't read as meaningfully different at a glance without the actual number.
  Heading and subtitle get most of this same treatment — position (flow/custom x/y), color, and fontSize —
  not just buttons: `heading`/`subtitle` evolved from plain strings to a `SlideText` object
  `{text, color, fontSize, align, position, x, y}` (`parseSlideText()`, same string-input-means-legacy-
  content fallback as everywhere else here), and `Positionable` (`{position, x, y}`) is the shape
  `SlideButton` and `SlideText` both structurally satisfy — `dragPosition`/`nudgePosition`/`POSITION_PRESETS`
  all operate on `Positionable` generically rather than being duplicated per item kind. On the canvas,
  `ElPreview`'s `"slider"` case is generalized the same way: `previewRefs.items` is one flat
  `Record<string, HTMLElement|null>` keyed `"heading"|"subtitle"|"btn-<i>"` (not separate text/button ref
  buckets), `ItemRef` (`{kind:"heading"}|{kind:"subtitle"}|{kind:"button",bi}`) is what
  `startMove`/`startResize`/`updateItem` take instead of a bare button index, and the smart-guide candidate
  search just iterates every OTHER key in that one map — so heading-vs-subtitle, heading-vs-button, and
  button-vs-button spacing/alignment all fall out of the same code path instead of three special cases.
  Heading/subtitle stayed fully hand-drag/resizable on the canvas, exactly like buttons — that part was
  never in question. What changed, after a first pass got this wrong: the Inspector's per-button minimap
  (`renderPositionEditor()`, drag-or-preset-click on a small preview box) stayed **button-only** — heading/
  subtitle "tiba2 jd tak best...sama macam button" with a minimap of their own, so instead they get
  `renderTextAlign()`, the exact same left/center/right icon-button row (`ALIGN_ICON`) the standalone
  heading/text element types already render for their own `align` field (`FieldInput`'s
  `field.kind === "select" && field.key === "align"` branch) — no manual fontSize input either; resizing a
  heading/subtitle, like a button, is canvas-drag-only. `align` only affects a flow item's own text-align;
  a custom-positioned one ignores it (there's no "alignment" for an absolutely-placed floating box).
  Heading/subtitle also got a real Typography section in the Inspector (fontFamily/fontWeight/lineHeight/
  letterSpacing/textTransform/fontStyle/textDecoration) — added by literally reusing `TYPOGRAPHY_FIELDS`
  (the same field list the standalone heading/text element types render in their own Style tab) and calling
  `FieldInput` directly as a plain function (it holds no hooks of its own, same reasoning that already lets
  `ElPreview` be called directly), rather than hand-writing a second set of font controls that could drift
  out of sync. On the canvas, the single bottom-right resize dot was replaced with a proper 4-corner
  resize box (dashed border + a small square handle at each corner, all four driving the same
  `startResize()` — there's only one dimension to scale, fontSize, so all corners are equivalent, this is
  purely about reading as a real resizable object like a standard shape/text box, not a floating dot).
  Getting that box to hug the actual rendered text required `whitespace-nowrap` on the chip: an
  `inline-block` that DOES wrap (a long heading vs. the slide's `max-w-[80%]`) shrink-to-fits to the
  *available* width, not the widest wrapped line, so the box floated visibly past the glyphs whenever a
  heading wrapped to 2+ lines — forcing single-line in this canvas approximation (the real published page
  in SectionBlock.astro still wraps normally) keeps the box meaningful.
  That Typography section's `fontFamily`/`lineHeight`/`letterSpacing` fields got two more `FieldKind`s (not
  slider-specific — `TYPOGRAPHY_FIELDS` is shared with the standalone heading/text/list elements' own Style
  tab, so both picked up the same upgrade for free): `"font"` renders `FontPickerInput`, a typeable input
  with a dropdown of matches from `GOOGLE_FONTS` (moved to `lib/utils.ts` so both this and App.tsx's
  `ThemeForm`/`FontField` draw from one list) where every option is styled `fontFamily: f` so it previews in
  its own face instead of just naming itself — freeform names typed by hand still work, the dropdown is a
  narrowing filter, not a closed enum. Designer.tsx also preloads the whole curated list as one batched
  Google Fonts stylesheet on mount (`id="admin-font-picker-preview"`, same guarded-`<link>` approach
  `ThemeForm` already used) so every dropdown option actually renders in its real font immediately, not just
  whichever fonts happen to already be in use on the page (the existing per-block font-scanning effect below
  it still covers hand-typed names outside the curated list). `"stepper"` renders a "−/+ flanking a number
  input" control (Field gained an optional `step?: number`) — the same visual pattern the shadow panel's
  X/Y/blur/spread fields already used via `NumberStepper`, inlined here without that component's own
  `<label>` wrapper since `FieldInput`'s other kinds are all bare controls (FieldGroups/
  renderTypographyFields already render each field's label above it).
  `startMove`'s smart guides gained sibling-to-sibling center alignment (a pink line, distinct from the
  red page-center/spacing-tick lines) — before this, `vCenter`/`hCenter` only snapped to the slide box's
  own 50% center; now, while dragging any item, its center is also compared against every OTHER item's
  center on the box (`previewRefs.items`, same candidate set `vGap`/`hGap` already iterate) and snaps
  there within a small px tolerance when close (nearest-match only, mirrors the `vGap`/`hGap` "keep
  smallest" pattern) — e.g. two buttons lining up with each other, or a button centering under the
  heading. `sliderGuide` gained `alignX`/`alignY` (box-relative px, null when no match) for this.
  Two more canvas-only bugs surfaced once Typography/align were actually used: the resize box's default
  line-height (unset → browser's ~1.2 "normal") left visible space above/below the glyphs inside the
  dashed box — worse the larger fontSize got — so `textChip`'s style now defaults `lineHeight` to `"1"`
  when the field is unset (an explicit Typography lineHeight still wins; only the un-set default changed).
  Separately, per-item `align` had silently stopped doing anything the moment `whitespace-nowrap` (above)
  made the chip shrink-to-fit its own single line — `text-align` only has a visible effect when a box is
  wider than its content, and shrink-to-fit means it never is. Fixed by moving alignment out of the chip's
  own `text-align` and into `justify-content` on a `w-full` flex wrapper each flow-mode heading/subtitle
  now renders inside (`ALIGN_JUSTIFY`) — the wrapper takes the full row width, `justify-*` positions the
  shrink-wrapped chip within it. This also made the slide's older `first.textPosition`-driven
  `text-left`/`text-center`/`text-right` classes on the outer block dead weight (they only ever affected
  inline/inline-block children, and both text items are now wrapped in block-level flex divs) — removed,
  keeping just `textPosition`'s `self-start ml-6`/`self-end mr-6` block-position classes.
  Equal-spacing detection was added alongside the existing nearest-neighbor `vGap`/`hGap` tick: while
  dragging, besides the dragged item's own gap to its nearest neighbor, `set()` also walks every pair of
  OTHER (non-dragged) items and, if any of THEIR gaps on that axis already equals the dragged item's gap
  (±2px), pushes an extra tick for it (`vGapMatches`/`hGapMatches`) — e.g. dragging the middle item of 3 in
  a row now also confirms when the two outer buttons are already exactly as far apart as the gap just
  formed, not just showing the one nearest tick. Rendered identically to `vGap`/`hGap` (same red tick +
  px-label style), just once per match found.
  Sibling alignment (`alignX`) was center-only at first — a screenshot showed 3 stacked items flush-left
  (heading/subtitle/a button all sharing the same left edge) asking for that case to get its own guide
  line too, not just centered stacks. Since `alignX` already stores "where dragRect's own center would
  have to sit" for a match (so one line/snap value covers every case), this only needed more candidate
  targets per sibling: besides that sibling's own center-x, also its `left + halfW` (the center position
  that makes dragRect's left edge land on the sibling's left edge) and `right - halfW` (same for the right
  edge) — whichever of the three is nearest wins, same as before. `alignY` stayed center-only (not asked
  for; Y-axis top/bottom edge guides would be the same pattern if ever requested).
  Equal-spacing matching (previous paragraph) originally compared raw gap length within a ±2px float
  tolerance, which a screenshot caught showing three simultaneous ticks reading "31px"/"32px"/"32px" —
  correctly flagged as "matching" by that tolerance, but visually reading as a bug since matched ticks
  showed disagreeing numbers. Root cause: flex layout can round two CSS-identical gaps to different
  device-pixel widths (sub-pixel drift in child box sizing, not an actual spacing difference), so the raw
  float distance between them can be up to ~1-2px even when they're "the same" gap. Fixed by comparing
  `Math.round(length)` equality instead of a float tolerance — a match is now only flagged when the two
  ticks would display the exact same rounded number, which is the only thing the user can actually see.
  Left/right-edge `alignX` (previous paragraph) shipped with a real bug: it drew the guide line at the same
  value used to reposition the dragged item's own center, but for an edge match that snap-center is offset
  from the sibling's true edge by the dragged item's own half-width — so the line visibly sat away from the
  actual left/right edge whenever the two items weren't the same width (worked fine for center-matches only
  because there the two values happen to coincide). Fixed by tracking them separately: each X candidate now
  carries both `snap` (screen-space target for repositioning, unchanged math) and `line` (the sibling's real
  matched coordinate — its own left/center/right, never offset by the dragged item's size) — `snapCenterX`
  drives the reposition, `alignX` (from `line`) drives only where the pink guide is drawn.
  Heading/subtitle also gained an explicit numeric Size field in the Inspector (`SLIDE_TEXT_SIZE_FIELD`,
  reusing the `"stepper"` kind and the standalone text element's own `designer-f-size` label) — the canvas
  drag handle was the only way to resize before this, fast but imprecise; typing isn't clamped to the
  drag's 10-40 range, since a specific-number ask shouldn't inherit the drag handle's comfortable bounds.
  Shown value falls back to `TEXT_BASE_PX.heading`/`.subtitle` when `fontSize` is still `""` (unset), same
  fallback the canvas chip itself already uses, so the stepper starts from the size actually on screen
  instead of 0. `startResize`'s own drag also dropped its 10-40px clamp right after — asked not to cap how
  big a drag can make text/buttons; only a 1px floor remains (avoids zero/negative). No server-side change
  needed — `validate-layout.ts`'s `fontSize` check was already just a numeric-format regex, no upper bound.
  Removing that cap surfaced a real responsiveness gap: `slideTextStyle()`/`slideButtonStyle()` emitted a
  literal `font-size:{px}px`, a fixed number that rendered exactly as large on a phone as on a desktop —
  reported as text "tak fit" once an author actually used a big custom size. Fixed with a new
  `fluidFontSize(pxStr)` helper (SectionBlock.astro) that wraps the author's px value in `clamp(floor,
  vw, ceiling)`: the ceiling is the author's own chosen size (never rendered bigger than they set), the
  floor is `max(14, size*0.55)` (stays legible), and the vw middle term is calibrated (`size/10` vw) so it
  equals the ceiling at a ~1000px "designed at this width" viewport and shrinks below that — same fluid-type
  technique `.ds-slide-heading`'s own default `clamp(1.5rem, 4vw, 2.5rem)` already used, just derived
  per-value instead of one hardcoded rule. Neither heading/subtitle/button text has `white-space: nowrap` on
  the real site (only Designer's own canvas approximation does, for its resize-box hugging), so long text
  already wraps to 2+ lines within its container's `max-width` — the missing piece was purely the font-size
  itself not shrinking. Verified this reaches Live Edit's actual mobile preview: its iframe container really
  narrows to `24rem` when the mobile breakpoint is selected (`bp === "mobile"` in Designer.tsx), so the real
  SectionBlock.astro CSS — now fluid — renders exactly as it would on an actual phone, not just a simulated
  grid layout.
  Generalized right after to every element with an author-set font-size, not just the slider — split
  `fluidFontSize` into a shared `fluidClamp(px, ceiling)` plus two callers: `fluidFontSize(pxStr)` (unchanged,
  slider's bare-px strings) and `fluidTextSize(v)` (new — the standalone Text element's own free-form `size`
  field, which allows px/rem/em/% via the "length" field kind). `fluidTextSize` converts rem/em to a
  px-equivalent for the floor/vw math only (assumes the 16px root, same assumption `pxLabel()` in
  Designer.tsx already makes) but keeps the ceiling term in the author's original unit; `%` (or anything
  unrecognized) passes through untouched since it's already relative, not a fixed size that can overflow a
  narrow screen. Heading elements don't have their own free-form size (they pick a `level` h1-4, sized purely
  by the `.ds-h1`-`.ds-h4` CSS classes) — h1/h2 already used `clamp()`, but h3/h4 were still a fixed
  `1.5rem`/`1.2rem`, an inconsistency fixed in the same pass (`clamp(1.3rem, 3.2vw, 1.5rem)` /
  `clamp(1.1rem, 2.6vw, 1.2rem)`, same proportions as h1/h2's own clamps). Icon's own `size` field (also
  "length" kind, also free-form) was deliberately left alone — it sets an `<svg>` `width`/`height`
  *attribute*, not a CSS `font-size` property, and `clamp()` support in SVG presentation attributes is far
  less consistent across browsers than in CSS; icons are also a much smaller overflow risk than a paragraph
  of text, so this wasn't worth the same treatment without being asked specifically.
  Live-testing the mobile breakpoint preview surfaced a real gap the fluid-CSS fix above didn't cover: the
  Blocks canvas's slider heading/subtitle/buttons stayed at full literal px size regardless of the "bp"
  toggle, overflowing the (correctly narrowed) simulated mobile box. Root cause: `vw`/`clamp()` — which
  works perfectly in the real site's actual iframe — can't work here, because the canvas's "bp" preview is
  just a `max-width` box (Designer.tsx's `style={{ maxWidth: ... }}` on the canvas) sitting inside the
  admin's own full, actually-wide browser window; `vw` always measures that real window, never the
  simulated container, so it never visibly shrinks. Fixed with `fluidPreviewPx(px, bp)` — a JS
  reimplementation of the same floor/scaled/ceiling clamp math, evaluated against a fixed reference width
  per breakpoint (`BP_REFERENCE_PX`: desktop 1000, tablet 768, mobile 384) instead of a live `vw` unit —
  gives the canvas an accurate preview of how the real fluid size will look small. `btnChip`/`textChip` now
  compute both `rawFontPx` (the true stored value) and `fontPx` (the bp-adjusted display value); only
  `rawFontPx` is ever passed to `startResize`, so resizing while previewing "mobile" can't accidentally
  persist a shrunk-for-preview size as the real one — drag always continues from the true size regardless
  of which bp you're looking at.
  Slider height also got the same free-length upgrade as everything else here: the `height` field was a
  closed `select` (sm/md/lg/full keywords only) even though `SectionBlock.astro`'s own render
  (`lengthValue(p.height, SLIDER_HEIGHT, SLIDER_HEIGHT.md)`) and `validate-layout.ts` (`height` already in
  `LENGTH_KEYS`, `LENGTH_RE` already includes `vh`/`vw`) both already fully supported an arbitrary literal
  length — the UI itself was the only thing that couldn't express one. Changed to `kind: "length"` (that
  shared control gained `vh`/`vw` alongside its existing px/%/em/rem, benefiting every other field using it
  too, e.g. icon size) and `defaults.height` from the keyword `"md"` to the literal `"32rem"` it already
  resolved to, so a freshly-added slider looks identical to before. Legacy pages keep whatever keyword they
  already have — `lengthValue()` still resolves it the same way, silently upgrades to a literal value the
  next time anyone edits that field, same non-migration convention as every other schema evolution here.
  The Blocks canvas's own slide box was a hardcoded `aspect-[21/9]` regardless of this field — never
  actually reflected the chosen height, even before this change — so it now resolves the same
  keyword-or-literal value (a small `SLIDER_HEIGHT` table mirror, same duplication convention as every
  other shared table between the two apps) into an explicit `style.height`, falling back to the aspect
  ratio only if it somehow resolves empty.
  Two more bugs from that same round, confirmed live by the user (not guessed): (1) the heading resize box
  was STILL floating away from the text despite the earlier `whitespace-nowrap`/`lineHeight:1` fixes (a
  third attempt, `w-fit`, also failed — see the fitTextBox paragraph below for why every CSS-only attempt
  at this was doomed). (2) the shared `"length"`
  FieldInput control (number + unit dropdown) was unusable in a narrow Inspector sidebar — its number input
  used `base`'s own `w-full` as a flex-basis, which combined with the unit `<select>`'s fixed width simply
  didn't fit a ~240-280px panel, squeezing the number input to the point of being hard to click/type into.
  Fixed generically (benefits every `"length"` field, not just slider height): the number input now uses
  `min-w-0 flex-1` instead of `w-full` so it actually shares the row properly, and the unit select shrank
  slightly (`w-20`→`w-16`) to leave it more room.
  A real-browser screenshot then caught the Blocks canvas actively lying about the real site: the editor
  showed heading/subtitle stacked cleanly, but the actual published page showed the heading wrapping to 2
  lines and a custom-positioned subtitle overlapping right through it — invisible in the editor purely
  because `whitespace-nowrap` forced the heading to stay single-line there, something the real site never
  does. Removed `whitespace-nowrap` from the chip so the canvas wraps exactly like `SectionBlock.astro`.
  Keeping the dashed resize box tight around *wrapped* text then needed `fitTextBox()` — and this is the
  part worth remembering, because three separate CSS-only attempts (`whitespace-nowrap`, `lineHeight:1`,
  `w-fit`) all failed before the actual constraint was understood: **no CSS width value can size a box to
  the widest rendered line of wrapped text.** `width: fit-content` resolves to
  `min(max-content, max(min-content, available))`, and the instant text wraps, `max-content` (its full
  unwrapped width) exceeds `available` — so it collapses to the *container's* width, which is exactly the
  floating box being reported. The only real answer is measurement: `Range.getClientRects()` over the chip's
  text node returns one rect per rendered line box, so the widest of those is the true ink width.
  `fitTextBox` sets that as an explicit px width (plus the chip's own padding/border, since Tailwind's
  global `box-sizing: border-box` would otherwise clip the last glyph), and is called from an inline `ref`
  callback rather than a layout effect — a new function identity each render means React re-runs it on
  every render, which is what `ElPreview` needs since it's a plain function that can't hold hooks. It
  mutates the DOM directly (never React state), so there's no re-render loop. It does, however, need its
  containing block to have a **definite** width, which cost one more round to discover: a heading started
  wrapping to two lines on its own with most of the slide still empty, because `.ds-slide-content` (and the
  canvas's mirror of it) had `max-width` but no `width`, leaving it a shrink-to-fit flex item that hugs its
  children. The explicit width `fitTextBox` set on the heading therefore fed straight back into its
  parent's width, which became the heading's available width on the next measure — a ratchet that shrank
  the text column until the text wrapped and stabilized there. Fixed by giving that column a definite width
  on both sides (`width: 100%` on `.ds-slide-content`; `w-full max-w-[36rem] p-6` on the canvas div, which
  also closed a parity gap — the canvas had been using `max-w-[80%]` against the real site's absolute
  `36rem`, and had no equivalent of its `1.5rem` padding). This also fixed something quietly broken well
  before any of it: `text-align`/`justify-*` on the flow heading/subtitle had nothing to align *within*
  while their container hugged them exactly, so the align control was a no-op in flow mode on both the
  canvas and the real site. The general rule worth keeping: never set a measured width on an element whose
  own available width is derived from that element. The custom-position wrapper
  divs (`!headingFlow`/`!subtitleFlow` branches) also gained `max-w-[80%]`, matching `.ds-slide-text-free`'s
  real constraint — previously unconstrained in the canvas, another small accuracy gap. This is a genuine
  author-visible-now, author-fixable-by-repositioning issue, not something auto-resolvable in code short of
  a full collision-avoidance layout system — the fix here is "let the editor tell the truth," not "prevent
  the collision."
  The same screenshot also showed a slider button rendering with invisible (background-colored) text on the
  real site, correct in the canvas. Root cause: when an author sets a custom `btn.color` (background) but no
  `textColor`, `.ds-btn-primary`'s CSS default color is `var(--color-primary-content)` — computed for the
  SITE THEME's own primary color, not this button's overridden one, so it can end up near-invisible against
  an unrelated custom background. `slideButtonStyle()` now falls back to the exact same dark/light default
  (`#111827`/`#ffffff` by variant) Designer.tsx's own canvas preview already used for this case, only when a
  custom background is actually set — a button using the theme's own default color (no override) still
  correctly inherits the theme-aware contrast variable, unchanged.
  A report that an added button "tak muncul" (never appears) turned out to be a structural gap, not a
  rendering bug: `ElPreview`'s slider case did `const first = slides[0]`, so the Blocks canvas only ever
  drew the **first** slide while the Inspector edits every slide — adding a button to slide 2 genuinely
  showed nothing anywhere. The dots along the bottom of the canvas preview (previously decorative `<span>`s
  with the first one always highlighted) are now real buttons driving `sliderSlideIdx` (per-element-id
  state, same keying as `sliderPreviewRefs`, clamped on read since deleting a slide can strand the index
  past the end of the array), plus an `N/M` counter that only appears for a multi-slide slider — dots alone
  never communicated that the canvas was showing one slide out of several, which is what made this read as
  "the button wasn't added" instead of "you're looking at a different slide". Fixing this also required
  fixing a latent bug it would otherwise have exposed: `updateItem` wrote to `currentSlides[0]` hard-coded,
  which was harmless only while the preview could never leave slide 1 — it now writes to `slideIdx`, so a
  drag/resize while previewing slide 2 no longer silently rewrites slide 1.
  A slide button with no custom colour previewed as a plain white pill on the canvas while rendering in the
  site theme's colour on the real page — `btnChip` hard-coded `#fff`/`#111827` as its unset fallback, where
  the real `.ds-btn-primary` resolves `var(--color-primary, #0f62fe)` / `var(--color-primary-content, #fff)`.
  It now uses those same two CSS custom properties (already set on the canvas root from `siteTheme`, and
  already what the standalone button element's own preview uses), so an untouched slide button previews in
  the theme colour; an explicitly-set `btn.color` still wins, and keeps the fixed dark label
  `slideButtonStyle()` falls back to for that case. The Inspector's two swatches also stopped showing an
  arbitrary `#2563eb`/`#ffffff` for an unset value — they now preview what's actually in effect
  (`themePrimary`, and `bestTextColor()` of it), since a blue swatch on a button that renders pink reads as
  a real setting rather than "unset". The existing `×` next to each swatch is the reset-to-theme-default
  control and gained a `designer-reset-default` tooltip; it stays hidden when nothing is overridden.
  `SectionBlock.astro` mirrors this: `slideTextStyle()` (color/fontSize/text-align/typography inline
  overrides, same pattern as `slideButtonStyle()`, each new field checked against the same
  `FONT_FAMILY_RE`/`LENGTH_RE`/enum shapes validate-layout.ts already uses for every other element's
  Typography fields) plus a `headingFlow`/`subtitleFlow` split identical to buttons'
  `flowButtons`/`freeButtons` — a flow heading/subtitle renders in `.ds-slide-content` as before, a custom
  one renders as a new `.ds-slide-text-free` (`position:absolute`, `transform:translate(-50%,-50%)`, mirrors
  `.ds-slide-btn-free`) sibling. `validate-layout.ts`'s `isSafeSlideText()` accepts either a plain string
  (legacy) or the new object shape (now including `align`), same dual-format convention as
  `isSafeSlideButton`/`isSafeSlide` themselves. This was a deliberate schema evolution off the original
  needed once slides gained more fields than a flat line can hold. `parseSlides`/`stringifySlides`
  (Designer.tsx) and their SectionBlock.astro mirror both accept **either** shape — `JSON.parse` first,
  falling back to the old pipe-line parse on failure — so a page saved before this change keeps
  rendering/saving untouched and silently upgrades to JSON the next time its slider is edited; never a
  hard migration. Rendering uses **Embla Carousel** (`embla-carousel` + `embla-carousel-autoplay`,
  apps/frontend's only real npm UI dependency beyond Tailwind/daisyUI — headless, ~6kb, vanilla JS, no
  React) instead of the original hand-rolled `translateX()` script: `.ds-slider-viewport` >
  `.ds-slider-track` > `.ds-slide` is exactly Embla's expected viewport/container/slide structure, giving
  real touch/drag/swipe/momentum/loop for free. The `<script>` just wires the existing prev/next/dot
  buttons + an optional autoplay plugin to Embla's API (`scrollPrev`/`scrollNext`/`scrollTo`/`on("select")`)
  instead of computing scroll percentages by hand. `apps/api/src/collections/validate-layout.ts` validates
  every field the same way as every other prop — `slides`' new JSON shape gets its own
  `isSafeSlide`/`isSafeSlideButton` checks (image through the same `isSafeCssUrl` as `bgImage`, since both
  land in a raw `url(...)`; button `href` through `isSafeUrl`), with the same JSON-then-legacy-pipe
  fallback as the parsers above so an unedited old page's layout keeps validating on every save, not just
  ones already rewritten to the new shape. This slider work also surfaced two real gaps unrelated to
  itself, worth remembering: `validate-layout.ts`'s `LENGTH_KEYS` was missing the bare `"padding"` key
  (Column/Element's own legacy fallback — distinct from Section's `paddingY`/`paddingX` split — see
  `COLUMN_SPACING_KEYS` and every `sideValue(..., "padding")` call), which 400'd on the very first
  save/publish of any page saved before that validator existed; and `apps/admin/src/lib/api.ts`'s
  `request()` only read `body.error`, but Fastify's default error handler for a thrown `.statusCode` Error
  puts the real reason in `body.message` and just the generic HTTP phrase ("Bad Request") in `body.error`
  — every validation-rejection toast was showing that useless generic phrase instead of the actual
  problem. Both fixed in the same pass; `request()` now reads `body.message ?? body.error`.
  `Designer.tsx`'s pure helpers (types + style/geometry/slide-parsing functions with no
  dependency on the component's own state) live in `src/designer/` (`types.ts`, `style.ts`,
  `geometry.ts`, `parsers.ts`) — Layer 0 of the God Component refactor described in
  `docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md`. Each has its own
  `node:test` unit test (`pnpm --filter @ucms/admin test`, mirroring `apps/api`'s existing
  `tsx --test` convention) — the first automated coverage this file has ever had.
  Layer 1a extended this split with `designer/fields.tsx` (the field-schema
  lookup tables `TYPOGRAPHY_FIELDS`/`FIELD_GROUP_BY_KEY`/`GROUP_META`/etc,
  plus the `FieldLabel` helper), `designer/FieldControls.tsx` (5 small
  hook-bearing-but-closure-free leaf controls: `BufferedInput`,
  `BufferedTextarea`, `FontPickerInput`, `NumberStepper`, `BpToggle` — the
  last of these gained explicit `bp`/`t` props since it no longer has
  `Designer()`'s closure to read them from), and `designer/FieldInput.tsx`/
  `designer/FieldGroups.tsx` (the Inspector's data-driven field renderer and
  its Grouped Styles bucketing, both still hook-free and called as plain
  functions/JSX exactly as before). A related fix during Task 3's review also
  moved `Block`/`SectionProps` (and their structural dependents `ElType`/`El`/
  `Col`/`Row`) from `Designer.tsx` into `designer/types.ts`, closing an
  import-rule violation `FieldInput.tsx` had introduced by importing them from
  `Designer.tsx` directly.
  **Layer 1b** (`designer/Inspector.tsx`/`designer/ElPreview.tsx`) extracted the
  spec's remaining, much higher-risk pieces — each originally closed over
  45-55+ `Designer()` state values/mutator functions, including the `mutate`
  machinery every block-tree edit goes through. Rather than the FieldGroups-
  style "one interface per component" props shape (unworkable at this many
  values — the call site would need to spread 50+ individual props, twice),
  both now take one bundled `ctx: DesignerCtx` object (`designer/context.ts`)
  built once per render in `Designer()` right before its own final `return`
  and handed to both (`Inspector({ ctx })`, `ElPreview({ ctx, el, path })`) —
  still an explicit, typed prop per the design doc's own Layer 1 guidance, not
  the custom-hook state migration that's Layer 2. Extracting these two also
  forced everything THEY read out of `Designer.tsx` too, since a `designer/`
  file may never import back from `Designer.tsx` (`designer/types.ts`'s own
  rule): the `ELS` element-type registry moved to `designer/elements.ts`, the
  icon-name lookup table to `designer/icons.ts`, `SECTION_FIELDS`/
  `COLUMN_FIELDS`/`COLUMN_SPACING_KEYS`/`CSS_CLASS_FIELD` into
  `designer/fields.tsx`, the four-side padding/margin/radius key-maps and the
  slider/typography size tables plus `renderInline`/`headingFontFamily`
  (already-pure, zero-closure helpers, just never previously needed outside
  Designer.tsx) into `designer/style.ts`, and `Sel`/`PageSettings`/
  `SliderGuide` into `designer/types.ts`. `Designer.tsx` imports all of these
  straight back for its own remaining canvas-render code, same as it already
  did for Layer 0/1a's exports. `ELS` living in its own module is this
  codebase's closest thing today to an element-plugin registry — the field-
  schema/defaults/label live in one place now, though a NEW element type
  still means separately touching `ElPreview.tsx`'s render switch, the
  shared validator (below), and `SectionBlock.astro`'s own render switch; a
  single `ElementDefinition` uniting schema+canvas-render+site-render+
  validator is a bigger, separate design question, not attempted here. No Playwright/React-
  Testing-Library harness was added as the spec's own pre-Layer-1 "testing
  gap" section asked for — this repo has neither installed and standing one
  up needs a live api+db, a heavier lift than this pass's actual risk
  warranted; verified instead via `tsc -b`/`pnpm --filter @ucms/admin test`/
  `vite build` (per this project's established "typecheck+build is enough
  unless live browser testing is asked for" convention) — a real Playwright
  E2E smoke test is still the right investment before a future contributor
  attempts Layer 2 on top of this. `Designer.tsx` itself dropped from 5,810
  to ~3,430 lines; Layer 2 (the `useDesignerState(page)` hook consolidating
  the remaining 50+ hooks/100+ mutate/copy/paste/duplicate/undo functions)
  is the next layer in the same design doc, not yet started. See
  `docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md` and
  `docs/superpowers/plans/2026-08-21-designer-layer1a-field-controls.md`.
  **`packages/element-schema`** (new pnpm workspace package, `pnpm-workspace.yaml` gained a
  `packages/*` glob for it) is a follow-up extraction, done separately from the Layer 1b
  work above: the `pages.layout` XSS/CSS-injection validator (`validateLayout`/`isSafeUrl`/
  `isSafeCssUrl`, previously `apps/api/src/collections/validate-layout.ts` in full) moved
  here byte-identical (mechanical relocation, not a rewrite — same regexes, same per-key
  `ENUM_VALUES`/`LENGTH_KEYS`/etc tables, same `isSafeSlide*`/`isSafeCard*` JSON checks).
  `apps/api/src/collections/validate-layout.ts` is now a one-line `export * from
  "@ucms/element-schema"` so its 3 existing relative importers (`index.ts`, `validate-menu.ts`,
  its own `.test.ts`) needed no changes. Why: this validator is pure logic with no framework
  dependency (no React, no Fastify) — the one piece of the 4-touchpoint element-registry
  puzzle (schema/`ELS` in apps/admin, this validator, canvas render in `ElPreview.tsx`, site
  render in `SectionBlock.astro`) that COULD be a real shared module instead of a
  hand-duplicated table, so it's the one that moved. `ELS`/`ElPreview.tsx`/`SectionBlock.astro`
  were deliberately left untouched this round — merging `ELS`'s field schema into the same
  package would also require resolving its `labelKey` (bound to apps/admin's own `Key` union
  type) and `icon` (a `lucide-react` component, React-only) fields, real design work with real
  regression risk across 20+ element types for marginal benefit right now; a bigger design
  question, not attempted here, same as the `ElementDefinition`-unification note above.
  `apps/api`'s Dockerfile now also `COPY`s and `pnpm --filter @ucms/element-schema build`s
  this package before building `apps/api` itself — `apps/api`'s own `dist/` has no compiled
  copy of it, only a `workspace:*` dependency on its `dist/` output, so skipping this step
  would ship a broken image. Local `pnpm build`/`pnpm typecheck` at the repo root already
  handled this correctly for free (`pnpm -r` respects the workspace dependency graph); only
  the Dockerfile's single-package `--filter` build needed the explicit extra step.
  **Follow-up (same 4-touchpoint gap, next practical slice):** `ELS`'s field schema and
  `ElPreview.tsx`/`SectionBlock.astro`'s render switches are still NOT unified — that remains the
  bigger, cross-framework design question above (a real shared `ElementDefinition` would need one
  render implementation both React's canvas and Astro's SSR output could consume, which the two
  frameworks don't share). What WAS closed: `@ucms/element-schema` now also exports its
  classification buckets (`LENGTH_KEYS`/`COLOR_KEYS`/`ENUM_VALUES`/`REPEATER_SCHEMAS`, previously
  module-local), and `apps/admin` (now a real `@ucms/element-schema` dependency, not just a
  comment referencing it) has a new `designer/elements.test.ts` that walks every `ELS[type].fields`
  entry and asserts its `kind` actually lands in the matching bucket — `"length"` keys must be in
  `LENGTH_KEYS`, `"color"` in `COLOR_KEYS`, `"select"` options must be a subset of `ENUM_VALUES`,
  `"repeater"` itemFields keys must match `REPEATER_SCHEMAS`. This is the automated version of the
  exact incident already documented above (`LENGTH_KEYS` missing `"padding"` 400'd on first
  save) — it turns that class of drift into a red test instead of a live 400. Running it
  immediately caught one real instance: `documentdownload`'s `columns` field offers a `"1"` option
  (1-column layout) that `ENUM_VALUES.columns` didn't allow, which would have 400'd on save; fixed
  by adding `"1"` to that enum. Whether to go further and derive admin's per-field `options` arrays
  from these same exported buckets (removing the *other* direction of duplication) is a separate,
  lower-value follow-up — those arrays are small/static and rarely drift, and several fields
  deliberately narrow the shared set (`infobox`'s `align` offers only `left`/`center`, not the
  3-value global enum), so a blind swap risks silently widening a field's real options; the test
  above already catches the direction that has actually broken production.
  `ThemeForm` (Site Theme / Global Theme) offers a swatch picker labelled "UI Themes"
  (daisyUI is the real source of the color data — see `App.tsx`'s `THEME_PRESETS` comment — but the
  brand name and each theme's own name are deliberately not shown in the UI) + a random generator (both
  built on the same `oklchToHex` conversion), a 4-role Google Font system (Heading/Header-Title,
  Sub-heading, Blog/Post Title, Body — each a typeable/scrollable `FontField` with live per-row preview,
  and a "same as Heading font" note when two roles happen to match, since a pairing intentionally sets
  Heading/Sub-heading/Post-Title to the same face) with a "Generate font pairing" button that fills
  Heading+Sub-heading+Post-Title+Body from a curated ~30-entry `FONT_PAIRINGS` list (documented
  typography pairings, not a random freeform combination), a live preview panel, and — in its own box
  below the preview, not mixed into it, so it stays legible even when the theme it's judging isn't — an
  automatic WCAG contrast-ratio readability check (`lib/utils.ts`'s `contrastRatio`, worst-case across
  body text vs background and the primary button's label vs its background, shown as a percent +
  Good/OK/Poor label). The button check (and the real frontend) use `bestTextColor` — black or white,
  whichever actually contrasts — instead of assuming white text always; `BaseLayout.astro` computes the
  matching `--color-primary-content` and `SectionBlock.astro`'s `.ds-btn-primary` reads it, so a light
  primary color (several curated presets included) renders a readable button instead of invisible
  white-on-white. The live preview's secondary/accent button is filled the same way (background:
  secondaryColor, label: `bestTextColor(secondaryColor)`) — not outlined with secondaryColor used
  directly as text on the page background, which isn't how any real color system pairs an accent hue
  and made several legitimately-fine UI Themes presets score "poor" for a combination nothing actually
  renders. All 12 presets score "Good" under this model; a genuinely low-contrast accent (e.g. mid-gray)
  still moves the score down, by design. The same box also flags font legibility independently of color contrast — script/handwriting faces
  (`SCRIPT_FONTS`) are illegible in any role, display-only faces like Abril Fatface (`DISPLAY_ONLY_FONTS`)
  are only flagged when used as the body font, not heading — either caps the score/tone to "poor" even
  if the color contrast alone would pass. Also a personal saved-style collection
  (save/test/activate/delete, export/import as `.md`) backed by `theme_presets`. "Test" on a saved preset
  opens the real site's homepage with those not-yet-saved settings applied: `POST
  /api/theme-preview-token` (`verifyAnyUser`-gated) validates the settings the same way the real save
  route does and mints a short-lived (`previewOnly`, 5-min TTL) session-signed token carrying them;
  `GET /api/theme` overlays a valid token's settings on top of the real merged theme for that response
  only (empty-string fields skipped, so a partial test still falls back to what's actually persisted) —
  nothing is written to `site_theme`. `previewUrl`'s new `themeToken` param is independent of its
  page-draft `previewToken` (different purpose, both can be present at once); only the two tenant-scoped
  `ThemeForm` instances pass a `previewTenantHost` to enable this — Global Theme has no single site to
  open, so its Test still only updates the form's own local preview panel.
  `PostsPanel` ("Post / Article" in the UI — the underlying `posts` slug/table/i18n-key names are
  unchanged) follows the same quick-create pattern as `PagesPanel`: title only, auto-derived +
  de-duplicated slug, then `navigate(item.id)` straight into `PostEditorPage` — a real routed page now
  (`posts/:id`, see the route map above), not the old inline-expand-under-the-list-row `PostEditor`.
  `PostEditorPage` is a Ghost-style full-screen editor (`fixed inset-0` overlay over the whole shell): a
  header with a status badge, a Preview button (mints a post preview token via `POST
  /api/posts/:id/preview-token` so Draft/Private posts stay previewable), the two status actions that
  aren't the post's current one (Publish/Make private/Back to draft), Save, and a toggle for the settings
  panel; a feature-image band whose empty state opens `MediaPickerModal` — a small upload-or-pick modal
  (its own component, shared wherever the editor needs exactly one image) distinct from the full
  `MediaManager` panel's folders/search/bulk-select; the title/excerpt fields; and the BlockNote editor
  wrapped in its own fixed `EditorToolbar` (bold/italic/underline/strike/code, heading 1-3, quote, lists,
  alignment, link) — an always-visible bar for people used to a Word/Docs-style toolbar, layered on top of
  BlockNote's own slash-menu and selection popup rather than replacing them. The collapsible settings
  panel (`panelOpen`, open by default) holds a `<select>` of this tenant's `categories` plus an inline
  new-category name input + button that calls `POST /api/categories` and immediately selects the result,
  so creating a category never requires leaving the editor for `CategoriesPanel`'s own route
  (`posts/categories`, linked from `PostsPanel`'s header — a plain rename/delete list, no
  quick-create-into-editor pattern of its own, since a category has no content to edit); a
  comma-separated tags input; "Share to portal" (rendered only when `status === "published"`, matching
  the server-side gate — never for `"private"`); the author's email if set; and a collapsible
  `PostHistory` panel (fetched only when opened, not on every edit) listing `post_revisions` snapshots
  with one-click Restore. Typing `@` in the body opens a `SuggestionMenuController` wired to a custom
  `bookmarkCard` BlockNote block (`src/blocknote/bookmarkCard.tsx`): it calls `GET /api/content-search`
  and, on pick, inserts a card whose title/excerpt/image/url are a snapshot captured at insert time, not
  re-fetched on render — an accepted staleness ceiling (a later rename or delete of the linked post/page
  leaves the card showing the old snapshot; a background re-sync job is the upgrade path if that's ever a
  real complaint, not built now). Building that block surfaced two real deviations from the naive
  BlockNote API in the installed `@blocknote/react@0.51.4`: `createReactBlockSpec(config, implementation)`
  returns a factory function (`(options?) => BlockSpec`), not a `BlockSpec` itself, so it has to be
  invoked once (`createBookmarkCardBlockSpec()`) before going into `blockSpecs` alongside
  `defaultBlockSpecs`'s already-plain entries; and a React block spec's `toExternalHTML` is typed as a
  React FC returning JSX (same props as `render`, plus `context`), not the DOM-node-returning function
  `BlockImplementation` uses on the non-React `@blocknote/core` side — both are called out inline in
  `bookmarkCard.tsx` so the next block spec added there doesn't have to rediscover them. A section's
  `Row` (`sp.rows[]`) is independently selectable in Blocks mode — click its background/grid area or the
  hover-revealed "Row" tag, or click "Row N" in the Layers tab — surfacing its own Inspector panel
  (`sel.length === 2`, a case that never collides with section/column/element's `sel.length`
  1/3/4) with per-side `padding`, top/bottom `margin` (the gap *between* stacked rows — replaces the old
  fixed `space-y-*`/flex-`gap` spacing, so rows are plain block-flow now and adjacent rows' margins
  collapse like normal HTML), a plain px `gap` field for the gap *between this row's columns*
  (`Row.gap`, custom px only, no presets — falls back to the page-wide default in `pages.settings.gap`,
  set from the Inspector's "nothing selected" panel, then to a hardcoded 2rem), and
  duplicate/copy/paste/copy-style/paste-style/delete — the same `ClipLevel` clipboard mechanism
  (`"row"` alongside `"section"/"column"/"element"`) Column already used, Inspector-panel buttons only,
  no on-canvas widget or context menu (matches Column's pattern, not Section's). Mobile breakpoint
  preview (bp === "mobile") forces every row's `gridTemplateColumns` to `1fr`, stacking columns — mirrors
  `SectionBlock.astro`'s own `@media (max-width: 768px)` rule, which the canvas didn't previously
  simulate. The padding/margin spacing-overlay hatch band (blue = padding, amber = margin) only renders
  while its matching drag handle is hovered or actively dragged (`hoverBand` state) — the small "Npx"
  badge itself still always shows once selected; a persistent hatch on every side at once, just from
  selecting the item, was too visually noisy. The canvas's dashed section/row/column guide lines and
  empty-column hint text are drawn directly on top of that block's actual configured background (which
  a tenant can set to anything), so they no longer use a fixed admin-chrome gray (`border-line`) — that
  vanished on a bright/white section or column background. `overlayColors()` (next to `hexToRgba`) picks
  a dark- or light-tinted line/text color per block via the same `bestTextColor` black-vs-white contrast
  check `ThemeForm`'s button preview uses, keyed off that block's own resolved bg (`col.props.bg` falling
  back to the section's, falling back to the site theme's). Row's own grid container has no permanent
  dashed border (removed — it was purely redundant with each Column's own dashed border directly inside
  it); Row selection/hover still comes from the same `selCls([b, r])` outline every other level uses. The
  Section Inspector's Grouped Styles panel (`FieldGroupKey`) has a dedicated `"appearance"` card (Opacity +
  Shadow — Figma calls this "Appearance") split out from the `"border"` card, which now holds a real
  Stroke control (`borderWidth`/`borderColor`/`borderStyle`) instead of the old `border`
  none/thin/thick preset — `borderWidth` set wins over the legacy preset (`sectionBpStyle()` in
  Designer.tsx, mirrored in `SectionBlock.astro`), so existing pages saved before this field existed don't
  move. `opacity` (0-100, CSS `opacity` on the whole section — backdrop and content together) is a new
  Section-only field, same fallback-to-fully-opaque-when-unset convention as every other optional style
  prop here. The canvas's guide-line overlay tint (`overlayColors()`, previous paragraph) only ever
  substitutes for an *unset* border — it never overrides a real `borderColor`/legacy `border` preset the
  author actually picked, so a configured Stroke shows its true color while editing, not just on the
  published site. "Save as Template"/the Templates modal (`saveAsTemplate`/`templateKind`/`insertTemplate`,
  backed by `apps/api`'s `design_templates` table) reads whichever selection path is passed in — the
  right-click context menu passes its own `ctxMenu.path` explicitly rather than the left-click `sel` state,
  since right-clicking an unselected element never updates `sel` and silently no-opped there before this was
  fixed. `templateKind` recognizes 4 depths, not 3: `section` (path length 1), **`row`** (length 2), `column`
  (length 3), `element` (length 4) — row was added because clicking a section's background/grid area selects
  its Row (see the Row Inspector paragraph above), not the section itself, so "save the whole section" via a
  background click always hit a silently-disabled Save button until row became a valid template kind too.
  The modal also shows a hint line whenever nothing template-able is currently selected, instead of just a
  dead-looking disabled button. Naming a new template uses an in-app field inside the modal
  (`pendingTemplate`/`templateName` state, submitted via `confirmSaveTemplate()`), not `window.prompt()` —
  a browser that's already shown several JS dialogs in the same tab (alert/confirm/prompt) offers to
  "prevent this page from creating additional dialogs," and once that's ticked `prompt()` returns `null`
  instantly with zero visible sign anything happened, which made a real Save click look identical to a
  disabled one. `saveAsTemplate()` itself is synchronous now — it only stages `pendingTemplate` and opens
  the modal; the actual `POST /api/templates` call happens in `confirmSaveTemplate()` once a name is typed.
  Section and Column each also have their own explicit-path `saveAsTemplate([b])`/`saveAsTemplate([b, r, c])`
  button (`LayoutTemplate` icon) wired into every place their other per-level actions (copy/paste/copy-style/
  delete) already live — Section's canvas-header `BlockControls`, Column's Inspector button row, and both
  branches of `LiveEditToolbar`. Right-click (`ctxMenu`) is no longer Element-only either: the single
  `ctxMenu` render block branches on `templateKind(ctxMenu.path)` and shows the same 8-item menu (Edit,
  Duplicate, Copy, Paste, Copy style, Paste style, Save as template, Delete) at all 4 depths, calling
  whichever level's already-existing helper functions (`duplicateSection`/`duplicateRow`/`duplicateColumn`
  — the last one newly added, Column previously had no standalone duplicate — /`duplicateElement`, and
  their copy/paste/copy-style/paste-style/delete counterparts). Blocks mode's Section/Row/Column canvas
  containers each got their own `onContextMenu` (mirroring Element's, which already existed) that calls
  `setSel` + `setCtxMenu` with their own path. Live Edit's iframe bridge (`designer:contextmenu` in the
  postMessage handler) accepts path lengths 1/3/4 now, not just 4 — but never 2 (row): `SectionBlock.astro`
  only stamps `data-designer-path` on section/column/element nodes, not the row wrapper, so a live-mode
  right-click can never resolve to a Row; Row's context menu only works in Blocks mode. The Templates modal
  itself scales for a large personal library (a flat, ungrouped list was fine at a handful of saved templates,
  not at 100+): it's a wider grid (`w-[min(90vw,52rem)]`, 2-3 columns) with a name search box and kind-filter
  pills (All/Section/Row/Column/Element, `templateFilter`/`templateSearch` state, filtered client-side —
  no new API params, the full list is already fetched by `listTemplates`) above the grid, and each card
  renders `TemplatePreview`: a rough layout-only impression (stacked rows → columns → a bar per element,
  `rows.slice(0,4)`/`columns.slice(0,5)`/`elements.slice(0,3)` so one oversized template can't blow up a
  card), not a real screenshot — an actual rendered thumbnail would need a headless-browser pipeline just
  for this, and a rough shape is enough to recognize a saved layout at a glance. Every template kind
  normalizes to the same `rows[]` shape for this (`row`/`column`/`element` templates are treated as a
  1-row, and for column/element also 1-column, section), so `TemplatePreview` has one render path for all
  4 kinds. The Element Inspector (only Element — Section/Row/Column's own field lists have no `"content"`-
  bucket fields at all, so a Content tab there would always be empty) splits into Kandungan/Content and
  Gaya/Style tabs (`inspectorTab` state) once it actually has content fields (`hasContentFields`, checked
  against `FIELD_GROUP_BY_KEY`) — Content shows only the `"content"` bucket (Text/URL/HTML/items/etc, an
  element's raw data), Style shows the Padding/Radius/Margin `FourSideControl`s plus every other
  `GROUP_META` bucket (typography/background/size/appearance/border/advanced). `FieldGroups` grew an
  `only?: "content" | "style"` prop for this — its 3 existing call sites (Section/Column/Element field
  lists) are unaffected when the prop is omitted. Copy/paste/duplicate/delete stay outside the tabs
  (always visible), since they're actions, not settings to browse.
  Slider heading/subtitle text boxes got a Canva-style resize model on the canvas: 4 corner dots
  (`startCornerScale`, `RESIZE_CORNERS`' `sign` per corner) scale `fontSize` and an explicit `width` (px)
  together, proportional to horizontal drag distance over the box's own current width; 2 side dots
  (`startWidthResize`) resize `width` only, font unchanged, and dragging narrower lets normal CSS wrapping
  push text to a second line (no forced `white-space:pre`) — `SlideText.width` mirrors this in
  `slideTextStyle()` (`SectionBlock.astro`) as a hard `width` + `overflow-wrap:break-word` safety net for a
  since-enlarged single word. Double-clicking a heading/subtitle on the canvas edits it in place
  (`contentEditable`, `sliderEditingItem`/`editingSliderText` — same stable-snapshot-ref pattern the
  standalone heading/text elements' own `editingText`/`commit()` already used, so React re-renders from the
  onInput round-trip don't reset the caret) instead of only through the Inspector's `BufferedTextarea`;
  Enter inserts a literal `\n` via `execCommand("insertText", false, "\n")` rather than the browser's
  default block-splitting behavior. A slide also gained a real `bgColor` (hex, optional flat fill behind
  `imageUrl` — the only previous way to get a solid-color slide was an accidental side effect of the
  overlay sitting over the page's own backdrop) and `.ds-slide` picked up a default `color:#fff`: a
  custom-positioned (`ds-slide-text-free`) heading/subtitle is a CSS **sibling** of `.ds-slide-content`, not
  a descendant, so it never inherited that div's own `color:#fff` and instead inherited the page's global
  theme text color from `body` — confirmed live via computed-style inspection before the fix, re-verified
  after. `ElPreview`'s Blocks-canvas slide box also stopped hardcoding a fake `bg-black/70` placeholder —
  it now renders the slide's real `bgColor`/`imageUrl` background plus an actual overlay div at the real
  `overlayColor`/`overlayOpacity`, so the canvas preview matches what publishes instead of a decorative
  approximation.
  The slider element also grew 3 more top-level fields (element props, not per-slide): `navStyle`
  ("arrows"/"minimal"/"none" — the prev/next button look, or hidden entirely), `dotsStyle`
  ("dots"/"lines"/"numbers"/"none" — the pagination indicator shape, or hidden), and `transition`
  ("slide"/"fade"). All 3 are plain `"select"`-kind `SLIDER_FIELDS` entries validated the same generic way
  as `autoplay`/`textPosition` (`validate-layout.ts`'s `ENUM_VALUES` map — closed allowlist, no pattern
  needed for a closed enum) and rendered onto the real `.ds-slider` as `data-nav`/`data-pagination`/
  `data-transition` attributes, styled purely via CSS attribute selectors (no new classes to keep in sync).
  `transition:"fade"` is a real branch in the `<script>`, not an Embla plugin — Embla's own
  `.ds-slider-track` assumes a horizontal scroll strip, which can't crossfade, so fade mode skips
  `EmblaCarousel(...)` entirely for that slider and hand-rolls index/opacity state instead (prev/next/dot
  clicks and an optional `setInterval` autoplay all just call the same `show(next)`, toggling each
  `.ds-slide`'s `is-active-fade` class): rung-5-lazy, no new dependency, since CSS `position:absolute` +
  `opacity` transition covers it. This is Blocks-canvas-cosmetic-only for now — `ElPreview`'s slider case
  doesn't reflect `navStyle`/`dotsStyle`/`transition` (the canvas preview isn't a live carousel to begin
  with), so those 3 only visibly change anything on the real published/Live-Edit render.
  Section/Row/Column/Element already had a per-breakpoint STYLE-override system (the `bp` toggle —
  `Monitor`/`Tablet`/`Smartphone` icons — routes Inspector field edits into each node's own `bp: Record
  <string,string>` bag, keyed `"tablet:<fieldKey>"`/`"mobile:<fieldKey>"`, resolved by `bpGetValue`/
  `sideValue`/`sectionBpStyle`/`bpColStyle`/`bpPaddingStyle`/`bpMarginStyle`), but it started
  **admin-preview-only** — apps/frontend didn't read `bp` at all, it only narrowed the Designer canvas
  itself to simulate how the page would look. Real per-screen VISIBILITY was added first, as a separate,
  simpler feature: `VisibilityToggle` (3 icon buttons, same Monitor/Tablet/Smartphone icons, "active"/
  highlighted = hidden on that screen) sits at the top of all 4 Inspector levels (Section/Row/Column/
  Element) and writes plain `hideDesktop`/`hideTablet`/`hideMobile` ("true" | unset) keys directly onto
  that node's own props (Row's are typed fields on the `Row` interface itself, like its existing
  `marginTop`; Section's are flat `SectionProps` fields; Column/Element read/write through their existing
  generic `props` bag — no new bag shape, no `bp:` prefix, since a visibility flag has no desktop-value
  fallback chain to speak of, it's just 3 independent boolean-shaped keys). Validated generically via
  `ENUM_VALUES` (`["true"]` — `""` is already skipped by `validateValue`'s own `value === ""` early return)
  plus `ROW_OWN_KEYS` picking up the 3 keys for Row's non-bagged fields.
  The STYLE-override bag was then wired into `SectionBlock.astro` for real too, for Section and Column
  (Row/Element style-override stays admin-preview-only — see below for why): `sectionStyle`'s build logic
  was extracted from a one-shot inline array reading the destructured Props consts directly into a real
  function, `buildSectionStyle(p: Record<string,string>)`, called once against `baseSectionProps` (those
  same consts collected back into a plain bag) for the normal desktop render — `colStyle(cp)` already
  had this shape, no extraction needed. `bpMerge(base, bp, tier)` copies `base` and overlays whichever
  `"tablet:"`/`"mobile:"`-prefixed keys exist in the node's `bp` bag for that tier; `bpStyleRules(selector,
  bp, base, build)` re-runs `build()` against each tier's merged copy (only for a tier that actually has
  at least one override — skips the other entirely) and appends ` !important` to every resulting
  declaration, because an inline `style=""` attribute (which is how the desktop value always renders)
  outranks any external stylesheet rule regardless of media-query specificity — without `!important` the
  override would be dead code that validates and saves fine but never visibly does anything. `respId(id,
  visProps, bp?, base?, build?)` is the single per-node entry point both features now share: it decides
  whether a node needs a `data-vis` id at all (a real hide flag, OR — only when `bp`/`base`/`build` are
  passed — at least one style override present), and if so pushes every applicable rule (visibility
  first, then style) into one page-render-scoped `responsiveRules` array, scoped to `[data-vis="id"]`.
  Row and Element omit the `bp`/`base`/`build` arguments (2-arg `respId` calls) — Row still has no `bp`
  bag on the real data model at all (`Row` interface literally has no `bp` field, unlike Section/Col/El,
  a pre-existing gap this round didn't need to close since Row's own margin/padding/gap fields are already
  desktop-only); Element's style is built inline, differently per element `type`'s own switch case (no
  single reusable `build(p)` function the way Section/Column have), so giving it the same real-render
  treatment would mean extracting a per-type style-builder out of every one of ~14 switch branches — a
  separate, much bigger task, intentionally deferred rather than done half-way. Cutoffs: desktop
  `min-width:1025px`, tablet `641px`-`1024px`, mobile `max-width:640px` — independent of Row's own
  pre-existing `@media (max-width:768px)` column-stacking rule, which is untouched, and of Designer.tsx's
  own `BP_REFERENCE_PX` (canvas-simulation reference widths, a different concern from either of these real
  breakpoints). Only nodes that actually need a rule get a `data-vis` attribute at all (cheap — no markup
  added to the common no-override case). Section/Row/Column already have a real wrapper element to hang
  the attribute on directly; Element did not (each element type renders its own root tag with no common
  wrapper) — reused the SAME `display:contents` wrapper `designerEdit` mode already uses for its
  `data-designer-path` bridge attribute, so adding visibility (and, if ever extended, style overrides)
  didn't need touching every element type's own render branch. The `<style set:html={responsiveRules
  .join("")}/>` is emitted once, as the last child inside `<section>` — safe because Astro/JSX evaluates
  children in source order, so every row/column/element beneath it has already run (and pushed into the
  array) by the time it's read.
  A node hidden at the currently-previewed bp is never actually hidden in the Blocks canvas itself
  (Elementor/Webflow convention) — it renders faded (`opacity:0.35`) with a small red "Hidden" badge
  (`HiddenAtBpBadge`) instead, at all 4 levels (Section/Row/Column/Element), so an author can still reach
  and edit it while it's hidden on the breakpoint they're looking at. Every bp-aware field (every
  `FieldGroups` field, every `FourSideControl` padding/radius/margin group) also grew a `BpToggle`: a
  small clickable Tablet/Smartphone icon next to the field's own label (only rendered once `bp` leaves
  desktop) — accent-colored when that field (or, for a `FourSideControl`, any of its side keys) actually
  has a real override at the current bp, muted when it's just inheriting the desktop value. Clicking
  toggles it: enabling seeds the override at `""` (falls through the field's own default-preset
  resolution until typed over) rather than copying the resolved desktop value, disabling removes it —
  `bpKeysOverridden`/`toggleBpKeys` are the two small pure helpers both behaviors share. This mirrors (and
  visually reuses the same 3 icons as) the Visibility toggle, but is a distinct concern: Visibility is a
  real per-screen boolean rendered on the published site; the `bp` style-override bag it sits next to is
  still admin-preview-only for most fields — **except** slide heading/subtitle's own Text size and Align
  controls, which got the exact same BpToggle treatment but wired for real: `SlideText` grew its own `bp`
  bag (only ever storing `fontSize`/`align`, not a general escape hatch), validated in
  `validate-layout.ts`'s `isSafeSlideText` (rejects any other key in the bag), and rendered for real by
  `SectionBlock.astro`'s `slideTextVisId(txt, id)` — a thin adapter over the same `bpStyleRules`/
  `responsiveRules` machinery Section/Column already use for their own real bp overrides, just reusing
  `slideTextStyle(txt)` itself as the `build()` function (a merged-bp copy of a `SlideText` object is
  still structurally a valid `SlideText`, so no separate style-builder was needed here the way Section's
  own `buildSectionStyle` extraction was). Making that real also required moving the Blocks canvas's own
  reads and writes in the same pass, which is the part that bit first: `ElPreview`'s `textChip` read
  `txt.fontSize`/`txt.align` directly and the flow wrappers read `first.heading.align` directly, so a
  mobile-only size or alignment saved correctly and rendered correctly on the real site while the canvas
  kept showing the desktop value — indistinguishable from the control being broken. Both now go through
  `bpGetValue` (`slideAlign()` for the align case, used by `textChip`'s `textAlign` AND the
  `ALIGN_JUSTIFY` flow wrapper, since in flow mode it's the wrapper's `justify-content` that actually
  positions the shrink-wrapped chip). `updateItem` had to follow: with reads bp-aware, a canvas
  drag-resize while previewing mobile would otherwise write the base `fontSize` that the mobile override
  then out-ranks on screen, so the handle would visibly do nothing — it now routes a `fontSize` patch
  into the same `bp` bag the Inspector's stepper writes to whenever `bp !== "desktop"`, leaving
  width/position/x/y (which have no bp override) on the base object.
  That still didn't make a tablet/mobile-only Alignment/Text size click visibly do anything — confirmed
  live (Playwright against the running admin + a direct `GET /api/pages/:id`, not guessed): the real bug
  was one level up. The Element Inspector's shared `fieldGroupsProps` (used by the generic `<FieldGroups>`
  for EVERY field on a slider element, "slides" included) treated `slides` as just another bp-overridable
  value — so editing anything inside the slides editor while `bp !== "desktop"` wrote a whole SECOND
  stringified copy of the entire slide array into `el.bp["mobile:slides"]`/`el.bp["tablet:slides"]`
  instead of the real `el.props.slides`. The Inspector's own `getValue` reads through `bpGetValue` too, so
  it happily read that duplicate back and looked correct (align showed "center", the button turned blue)
  — but `ElPreview`'s canvas reads `el.props.slides` directly, never `el.bp`, so it kept rendering the
  untouched original every time. Fixed by excluding `f.kind === "slides"` from the generic bp routing
  entirely in `fieldGroupsProps` (`getValue`/`setValue` always read/write `el.props.slides`, `hasOverride`
  always false, `onToggleOverride` a no-op for it) and from `FieldGroups`' own `BpToggle` rendering — the
  slides field manages its own per-breakpoint overrides internally (each `SlideText.bp`), it was never
  meant to have a whole-field bp variant of its own. Verified live afterward: Desktop still resolves the
  base heading (`align:left`, `41px`), Mobile now genuinely resolves its own override (`align:center`,
  `23px`), independently. This asymmetry (slide text real, everything else preview-only)
  exists because slide text's `bp` bag only ever holds 2 known keys — genuinely cheap to make real — while
  Section/Column/Element's `bp` bag covers dozens of arbitrary style keys, where doing the same for real
  would mean the same kind of per-node-type style-builder work `navStyle`/`dotsStyle`/`transition` above
  already opted out of for Element specifically; extending realness further is a distinct, larger,
  not-yet-scoped task if ever asked for.
  Sprint 5 (`docs/laporan-audit-ui-ux.md` section 5.6's element-priority ranking) added 4 more
  `ELS` entries: **card grid** (`cardgrid` — `cards` is a JSON array of `{image,title,description,href,
  buttonLabel}`, `designer/parsers.ts`'s `parseCards`/`stringifyCards`, a brand new element with no legacy
  delimited-line format to fall back to, unlike slider), **CTA banner** (`ctabanner` — flat heading/
  description/up-to-2-buttons/bg props, no repeater), **announcement bar** (`announcementbar` — a
  dismiss button that just removes the DOM node client-side, no cookie/localStorage persistence, reappears
  on reload), and **post/news listing block** (`postlist` — `categoryId` is a reference only, like `menu`'s
  `menuId`; real posts are fetched at render time by a new `apps/frontend/src/components/PostListBlock.astro`
  via the existing `listPosts(tenantHost, {categoryId, limit})`, never duplicated content — the audit
  report's own "guna content CMS sedia ada, bukan duplicate content manual" ask). `postlist`'s `categoryId`
  picker needed a new live-fetched-once-per-tenant Inspector control mirroring `menu`'s own `menuId` picker
  — `FieldInput.tsx` gained a `"category-select"` `FieldKind` plus an `availableCategories` prop threaded
  through both call sites, fetched via the admin's existing `api.listCategories`. `cardgrid`'s repeater
  needed a `"cards"` `FieldKind` too — a plain add/remove-card-with-5-inputs list, deliberately simpler than
  slider's drag-to-position UI (no positioning system, just image/title/description/href/buttonLabel per
  card). `validate-layout.ts` gained a matching `isSafeCards` (image/href checked via `isSafeUrl` since
  they're bound through safe Astro attributes — `<img src>`/`<a href>` — not concatenated into a raw
  `url(...)` CSS function the way `bgImage`/slide `imageUrl` are) plus the usual enum/free-text/attr-url key
  additions, and a `categoryId` exemption identical to `menuId`'s (only ever used as a parameterized DB
  lookup key, never interpolated).
  A later batch (same audit report, sections 5.2/5.7's remaining "no-backend" element list, minus a
  Contact form/Event listing that need real backend work first, deferred) added 9 more `ELS` entries:
  **testimonial**, **stats counter**, **peoplegrid** (consolidates the report's separate "Team card" and
  "People/directory card" — both structurally photo+name+role+contact, so one element with optional
  fields covers both rather than a duplicate touchpoint set), **social icons**, **logo cloud**,
  **timeline**, **document download**, **Google Map embed**, and **announcement ticker** (distinct from
  the existing `announcementbar` — a continuously-scrolling marquee, never dismissed, vs. a single
  dismissible message). 6 of these (testimonial/statscounter/peoplegrid/socialicons/logocloud/timeline)
  plus documentdownload are repeaters — rather than a bespoke `FieldKind` + hand-written add/remove UI per
  element the way `cardgrid`'s own `"cards"` kind is, `types.ts` gained one generic `"repeater"` `FieldKind`
  driven by a small `itemFields: RepeaterItemField[]` schema on the `Field` (each sub-field just
  `"text"|"textarea"|"image"|"icon"`), with one shared render branch in `FieldInput.tsx` and one shared
  `parseRepeaterItems`/`stringifyRepeaterItems` pair in `parsers.ts` (mirrored, as always, in
  `SectionBlock.astro` — no shared package between the two apps for render code). Each repeater's own prop
  key is its own name (`testimonials`/`stats`/`people`/`socials`/`logos`/`timelineItems`/`documents`),
  deliberately NOT `"items"` — that key already belongs to accordion/tabs' own free-text pipe-line field,
  and `packages/element-schema`'s `validateValue` dispatches purely by prop key name; reusing it would have
  let a repeater's JSON array (containing image/url values that need real checks) through that free-text
  branch completely unvalidated. The validator gained a matching generic `REPEATER_SCHEMAS` table +
  `isSafeRepeaterItem(s)` (image/url fields through `isSafeUrl`, an `icon` field through a plain slug
  pattern since it's only ever a lookup key into `ICONS`/`ICON_PATHS`, never interpolated — same treatment
  `menuId`/`categoryId` already get; any key not in that item's own schema is rejected outright, same
  strict-shape convention `isSafeCard` already uses) — covered by real test cases in
  `validate-layout.test.ts` (accepts a valid testimonial, rejects a `javascript:` URL smuggled into a
  repeater's image field, rejects an item with an unrecognized key), not just the existing menu-only
  coverage. `socialicons`' `platform` field reuses the existing generic icon picker (`Object.keys(ICONS)`)
  rather than a dedicated brand-logo set — lucide-react ships no Facebook/Instagram/etc marks, and adding a
  new icon dependency or hand-drawn brand SVGs for this alone wasn't worth it; an author picks any lucide
  icon + sets the item's own link. `googlemap`'s `requireConsent` (audit report 5.3: map embeds need
  "consent/cookie policy dan fallback address text") gates the real `<iframe>` behind a click-to-load
  placeholder — the real embed URL sits in a `data-map-src` attribute until a delegated click handler
  (`SectionBlock.astro`'s bottom `<script>`, same event-delegation convention as every other zero-framework
  interaction here) swaps it in; no cookie/localStorage, same reappears-on-reload convention as
  `announcementbar`'s own dismiss. `address` always renders alongside the map (or alone, if `embedUrl` is
  unset) so the map is never a page's only location info, per the same audit note. `Designer.tsx`'s
  `CONTENT_KEYS` (the "paste style" content-key strip-list) gained an entry per new element so
  copy-style/paste-style can't leak one element's content onto another's the way every other element type
  already guards against.
  **Event listing** (the other half of the audit's deferred "Event listing/Contact form" pair — Contact
  form still needs its own design, not attempted here): a new `events` table (control-plane-shaped but
  actually tenant-scoped, migration `0021_events.sql`, RLS mirroring `posts` — `status='published' OR
  authenticated`) with `title`/`description` (plain text, not sanitized HTML — rendered as a safe text
  node, unlike `posts.body`)/`startDate`/`endDate`/`location`/`imageUrl`/`registrationUrl`/`status`. Its
  own `events.write` permission (not `posts.*`/`pages.*`, same reasoning as `menus.write` — managing the
  events calendar is its own concern), added to both `PERMISSIONS` lists (server `index.ts` AND admin
  `App.tsx`, per the i18n-phase-2 lesson above). `registrationUrl`/`imageUrl` are scheme-checked with the
  same `isSafeUrl` every other author-supplied URL in this codebase goes through (`eventsBeforeChange`) —
  both render as a real `href`/`src`, not sanitized HTML, so a `javascript:` value would execute on click
  same as anywhere else. `EventsPanel.tsx` (new, mirrors `MenusPanel`'s quick-create-then-expand-to-edit
  shape, not a full routed editor like posts/pages since an event has few fields) is mounted the same way
  `menus`/`blueprints` are — a superadmin-only `ContentManager` sub-tab and a webmaster top-level `Tab`.
  The `"eventlist"` Designer element is a thin reference, same "reference, not a copy" idea as `postlist`
  — only `count`/`columns`/`eventLayout` live in `El.props`, the real events are fetched at render time by
  a new `apps/frontend/src/components/EventListBlock.astro` via `listEvents(tenantHost)`
  (`GET /api/events?status=published`), which filters to `startDate >= now` and sorts upcoming-first
  client-side in the component — the events table is small enough per tenant that a dedicated
  `?upcoming=` API filter wasn't worth adding (`generic-crud.ts`'s `buildListFilters` only knows a
  `publishedAt` range, not `startDate`, and extending it generically for one collection's own column
  wasn't warranted). `count`/`columns`/`eventLayout` validate through the same generic `ENUM_VALUES`
  buckets `postlist`'s `count`/`columns`/`postLayout` already use (`packages/element-schema`) — no new
  validator code needed since eventlist carries no risky (URL/HTML) props of its own.
  Sprint 5 sub-project 2, **Page Blueprint** (`docs/laporan-audit-ui-ux.md` §5.6): a ready-made section
  layout a page can start from instead of a blank canvas, plus letting a webmaster save a finished page as
  a reusable starting point for future pages on their own tenant. `page_blueprints` (`apps/api/src/db/
  schema.ts`) is a new **control-plane** table — `tenantHost` nullable (null = system-wide, seeded via
  `bootstrap-public.sql` with 6 starter blueprints — Landing page jabatan, About/profil, Program/
  perkhidmatan, News hub, Contact, Simple content page — each a small valid `layout` array using only
  existing element types like hero/cardgrid/ctabanner/postlist), a set value scopes it to one tenant's own
  library; `layout`/`settings` are the same jsonb shapes `pages.layout`/`pages.settings` already use. This
  mirrors `theme_presets`/`tenant_languages`/`languages` — a small curated library resolved by a
  `tenantHost` column read in code, no RLS, no per-tenant migration replay — **not** `design_templates`
  (per-tenant-DB), which is real tenant CONTENT (section snippets authored and consumed entirely within one
  tenant). A blueprint needs to be visible across every tenant when system-wide, which a per-tenant-DB
  table can't do without a second cross-tenant mechanism; the control-plane table gives that for free, the
  same way `languages` already is. No `thumbnailUrl` column — nothing populates a real screenshot (same
  headless-render-pipeline gap already noted for `design_templates`), the gallery's rough layout-impression
  preview (below) covers it. New `blueprints.write` permission (`PERMISSIONS` in `index.ts` **and** the
  admin's client-side `PERMISSIONS`/`PERMISSION_LABEL_KEY` in `App.tsx` — both, per the i18n-phase-2 lesson
  above: a permission only really exists once it's in both lists) covers create/update/delete as one
  permission, matching the newer single-permission convention (`menus.write`/`languages.write`) rather than
  pages/posts' older per-action split. Hand-written CRUD routes in `index.ts` (control-plane data via
  `tenant-pool.ts`, not `req.db` — same reason `theme`/`tenant-languages`/`roles` are hand-written, not
  generic-crud): `GET /api/blueprints` returns rows where `tenant_host IS NULL OR tenant_host =
  req.tenantHost` (optional `?category=` filter), open to any authenticated tenant user, same read-open/
  write-gated asymmetry as `theme.write`; `POST`/`PATCH /api/blueprints/:id`/`DELETE /api/blueprints/:id`
  all route through a shared `canWriteBlueprint(req, targetTenantHost)` — superadmin may touch anything, a
  webmaster needs `blueprints.write` AND the target row's `tenantHost` must equal their own (a `null`
  system-scoped row is superadmin-only regardless of that permission, and nobody may touch another
  tenant's row even by guessing its id, since PATCH/DELETE re-check against the EXISTING row's own
  `tenantHost`, not a client-supplied one). `layout` is validated through the exact same `validateLayout()`
  pages already use, no new validator; `createdBy`/`createdByEmail` stamped once on create, never
  overwritten on update, same convention as `posts.authorId`. `apps/admin/src/designer/TemplatePreview.tsx`
  was extracted out of `Designer.tsx` (the rows→columns→elements-bars rough layout impression the Templates
  modal already rendered) into its own pure, prop-driven component — the Templates modal (existing) and a
  new `apps/admin/src/BlueprintGallery.tsx` (new) both render from this one implementation, a small
  in-scope step of the same God-Component extraction described in `Designer.tsx`'s own paragraph above
  (`designer/types.ts`, `designer/parsers.ts`, etc.). `BlueprintGallery` takes `{tenantHost, token, mode:
  "picker" | "manage", onUse?, isSuper}`: picker mode (a "Use this blueprint" button per card, calling
  `onUse`) is used by the Create Page flow; manage mode (Edit fields + Delete-with-`useConfirm` per card,
  both disabled — not hidden — on a system row unless `isSuper`) is the management screen, mounted the
  same way `menus`/`languages` are — a superadmin-only `ContentManager` sub-tab (`"blueprints"`, site-picker
  required first) and a webmaster top-level `Tab` (sibling of their own `theme`/`languages`/`menus` tabs,
  since a webmaster has no site picker), both rendering `BlueprintGallery mode="manage"` and always visible
  regardless of whether the account actually holds `blueprints.write` — same no-client-side-permission-
  awareness convention as `TenantLanguagesForm`, Edit/Delete just surface the server's 403. **Create Page
  entry point**: `PagesPanel`'s quick-create form gains a "Choose blueprint" button opening
  `BlueprintGallery mode="picker"` in a modal; `useBlueprint(bp)` clones `bp.layout`/`bp.settings`
  client-side through `refreshBlueprintIds()` (deep-clones the layout and regenerates every section/row/
  column/element id, so two pages cloned from the same blueprint in the same session are never open with
  colliding ids) and calls the SAME `POST /api/pages` create the "Blank page" path already uses — no
  dedicated "use blueprint" backend route. The page title still comes from a plain `window.prompt` here
  (commented inline as the deliberate exception to the "don't use `window.prompt`" lesson elsewhere in this
  file: that lesson is about a *multi-dialog* flow silently no-oping once a browser mutes repeat JS
  dialogs, not a single plain-text prompt like this one or the existing tenant-clone prompts). **Designer's
  "Save as blueprint"** sits next to the existing "Save as Template" header action and opens a small named-
  field in-app modal (name, description, category, and — superadmin only — a system/tenant scope radio),
  the same `confirmSaveTemplate`-style pattern (never `window.prompt` here, since this one IS the
  repeated-multi-field case that lesson actually concerns); submitting calls `POST /api/blueprints` with
  the page's current in-memory `layout`/`settings` — again no dedicated backend route, both entry points are
  pure client-side composition of the plain CRUD routes above. Real screenshot thumbnails are still
  explicitly deferred (needs a headless-render pipeline — a real new dependency this codebase deliberately
  avoids elsewhere per its own "avoid heavy dependencies" constraint — not attempted without being asked
  specifically). **Section-lock** (built): a superadmin can mark a Section `locked` (props.locked ===
  "true", a checkbox in Designer's Section Inspector, gated on the `isSuper` prop Designer already receives
  — `DesignerCtx` gained `isSuper`/`isSectionLocked(b)` for this, `designer/context.ts`) so it survives
  edits by a non-superadmin unchanged — e.g. a blueprint's mandated footer/CTA section that shouldn't be
  removable once cloned into a real page (it just travels with the layout JSON through
  `refreshBlueprintIds()`/"Save as blueprint" like any other prop, no special-casing needed there). Sections
  have no stable id of their own (only rows/columns/elements do, see `designer/types.ts`), so the real
  enforcement — `apps/api`'s `pagesBeforeChange` (`lockedSectionViolation`/`findLockedSections`) — matches a
  locked section by an exact deep-equal copy existing SOMEWHERE in the new layout, not by array position:
  this blocks every real edit (delete, content change, style change) while tolerating reordering/insertion
  of unrelated sections around it, and rejects with 403 (not 400 — this is an authorization failure, not a
  malformed request) when the requester isn't superadmin. Only `deleteSection`/`pasteStyleSection` actually
  mutate a locked section's own content (duplicate-after/copy/paste-after/move/save-as-template all leave it
  untouched, so those stay enabled even on a locked section) — Designer.tsx guards both functions
  client-side too (a `toast.error` + disabled Delete/Paste-style buttons in `BlockControls`), but this is UX
  only, not the security boundary. Selecting anything under a locked section (Row/Column/Element, not just
  the Section itself) shows one shared read-only notice in `Inspector.tsx` instead of editable fields, since
  mutating any of them would mutate the same locked section subtree and get rejected on Save anyway — simpler
  and clearer than disabling each nested field individually. `locked` is validated the same generic
  `ENUM_VALUES` way as `hideDesktop`/`hideTablet`/`hideMobile` (`packages/element-schema`).

  **Header/Footer Designer** (`kind === "siteChrome"`) gained a real Publish/Unpublish toggle and a
  read-only device-preview modal, closing a gap from its first pass (it could only ever save as
  draft, and `resolveHeaderFooter`'s default-chrome lookup already filtered `status=published` — so
  a freshly built header/footer could never actually reach the real site). `saveSiteChrome(status?)`
  now optionally PATCHes `status` alongside `layout` (mirrors `save(status?)`'s page-publish shape);
  the header bar shows the same dirty/published/draft badge pages use, keyed off local `chromeStatus`
  state. The device-preview button (`openDevicePreview()`, previously blueprint-only) now also handles
  `kind === "siteChrome"` — but unlike blueprint's preview (which needs a minted preview-token route
  since a blueprint has no public row of its own), it just points at `api.chromePreviewUrl()`
  directly: `siteChromeCollection.access.read` is unconditionally `() => true` (any status, no auth),
  so no token is needed — apps/frontend's new `chrome-preview.astro` (`?id=&kind=header|footer`)
  fetches the row straight off the existing public `GET /api/siteChrome/:id` (via
  `getSiteChromeById`, now exported) and renders it through `BaseLayout`'s existing
  `headerChrome`/`footerChrome` props, with simple placeholder body text standing in for real page
  content — full click-to-edit Live Edit (the designerEdit bridge) was deliberately not extended to
  chrome, this is view-only, same scope line the original spec drew.

  **Content Manager nav grouping**: the superadmin's Content Manager sub-nav (9 items:
  Pages/Posts/Media/Theme/Languages/Menus/Header&Footer/Blueprints/Events) and the webmaster
  sidebar's own flat CONTENT tab list had both grown past a comfortable single row/list — regrouped
  per WordPress/Wix/Webflow convention into 3 labeled clusters (`NAV_GROUP_ORDER`/`NAV_GROUP_LABEL`
  in `App.tsx`): **Content** (Pages/Posts/Media), **Design** (Theme/Menus/Header&Footer/Blueprints),
  **Settings** (Languages/Events). `ContentManager`'s own sub-nav is now a vertical mini-sidebar
  (`CONTENT_SUBTAB_GROUP` maps each `ContentSubTab`) next to the routed panel instead of a horizontal
  pill row; the webmaster's `Shell` sidebar groups its CONTENT section the same way for `!isSuper`
  (`TAB_GROUP` maps each `Tab`) — a group with zero matching items for that session (e.g. a webmaster
  who has none of the isSuper-only sub-tabs) simply doesn't render its header. Superadmin's own
  sidebar `contentTabs` (`content`/`global-theme`/`feed`, only 3 items) was deliberately left flat —
  not crowded enough to need grouping. Pure render-layer change: no `ContentSubTab`/`Tab` value,
  route, or permission changed, so nothing else in the app depends on this.
