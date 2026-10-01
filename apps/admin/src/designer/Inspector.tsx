// The right-hand Inspector panel: page settings (nothing selected), or
// Section/Row/Column/Element style + actions for whatever `ctx.sel` points
// at. Split out of Designer.tsx as part of Layer 1b of the God Component
// refactor (see docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md).
//
// Holds no hooks of its own (verified during extraction — every piece of
// state it reads comes from `ctx`), so it's safe to call directly as a plain
// function, same as FieldGroups/FieldInput already are.
//
// Rendered as real JSX + wrapped in React.memo (2026-09-24 render-perf pass,
// see docs/superpowers/specs/2026-09-24-designer-render-perf-design.md) —
// memo can't yet skip a re-render (ctx isn't memoized upstream until that
// doc's parts (b)/(c) land), this only removes the structural blocker.
//
// 2026-10-01 file-size split: the 6 per-depth panel bodies (page settings,
// Section/Row/Column/Element/nested-container-child) moved out to their own
// InspectorXxxPanel.tsx files (see each one's own header comment), and the
// shared module-scope helper components they all need (ContainerChildrenPanel,
// FlexIconGroup, FourSideControl, BoxModel, VisibilityToggle, the `section`
// accessor) moved out to InspectorControls.tsx — this file is now just the
// slim dispatcher: reads `ctx.sel` and renders the matching panel. (An
// earlier version of this split had the panel files import those shared
// helpers back from this file, a circular module reference — safe in
// practice but needless; InspectorControls.tsx has zero dependency on this
// file or any panel, so the graph is one-directional now.)
import { Lock } from "lucide-react";
import { memo } from "react";
import type { DesignerCtx } from "./context";
import { InspectorPageSettings } from "./InspectorPageSettings";
import { InspectorSectionPanel } from "./InspectorSectionPanel";
import { InspectorRowPanel } from "./InspectorRowPanel";
import { InspectorColumnPanel } from "./InspectorColumnPanel";
import { InspectorElementPanel } from "./InspectorElementPanel";
import { InspectorNestedPanel } from "./InspectorNestedPanel";

function InspectorImpl({ ctx }: { ctx: DesignerCtx }) {
  const { t, sel, setSel, blocks, isSectionLocked } = ctx;

  function Breadcrumb() {
    if (!sel || blocks[sel[0]]?.type !== "section") return null;
    const crumbs: { label: string; path: number[] }[] = [{ label: t("designer-section"), path: [sel[0]] }];
    if (sel.length >= 2) crumbs.push({ label: t("designer-row"), path: sel.slice(0, 2) });
    if (sel.length >= 3) crumbs.push({ label: t("designer-column"), path: sel.slice(0, 3) });
    if (sel.length >= 4) crumbs.push({ label: t("designer-element"), path: sel.slice(0, 4) });
    return (
      <div className="flex flex-wrap items-center gap-1 text-[11px] font-medium text-sub">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-line">/</span>}
            <button
              type="button"
              onClick={() => setSel(crumb.path)}
              disabled={i === crumbs.length - 1}
              className={i === crumbs.length - 1 ? "text-ink" : "text-accent hover:underline"}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>
    );
  }

  if (!sel) {
    return <InspectorPageSettings ctx={ctx} />;
  }
  if (blocks[sel[0]]?.type !== "section") {
    return <p className="text-xs text-sub">{t("designer-none-selected")}</p>;
  }
  const [b] = sel;

  // Section lock (Page Blueprint deferred item) — a non-superadmin gets a
  // read-only notice instead of editable fields at every level under a
  // locked section (Section/Row/Column/Element all share this one gate,
  // since editing any of them mutates the same locked section subtree). The
  // real enforcement is server-side (apps/api's pagesBeforeChange); this
  // just avoids presenting fields whose Save would be silently rejected.
  if (isSectionLocked(b)) {
    return (
      <div className="space-y-3">
        <Breadcrumb />
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-800">
          <div className="flex items-center gap-1.5 font-semibold">
            <Lock className="h-3.5 w-3.5" /> {t("designer-section-locked-title")}
          </div>
          <p className="mt-1">{t("designer-section-locked-body")}</p>
        </div>
      </div>
    );
  }

  if (sel.length === 1) return <InspectorSectionPanel ctx={ctx} />;
  if (sel.length === 2) return <InspectorRowPanel ctx={ctx} />;
  if (sel.length === 3) return <InspectorColumnPanel ctx={ctx} />;
  if (sel.length === 4) return <InspectorElementPanel ctx={ctx} />;
  if (sel.length > 4) return <InspectorNestedPanel ctx={ctx} />;
  return null;
}

export const Inspector = memo(InspectorImpl);
Inspector.displayName = "Inspector";
