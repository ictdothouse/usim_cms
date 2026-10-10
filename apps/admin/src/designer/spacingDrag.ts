// Padding/margin drag-to-resize write logic, extracted out of
// DesignerCanvas.tsx (pure code motion, same behavior) so Live Edit's
// postMessage bridge (useLiveEditBridge.ts's "designer:spacingDrag" handler)
// can commit a drag reported by the real iframe through the exact same
// mutation Blocks mode's own onMouseDown handlers already use, instead of a
// third hand-copy — this codebase has hit that exact drift bug before (see
// apps/admin/CLAUDE.md's packages/element-render history).
import type { Bp } from "./hooks/useBpStyle";

// Column/Element shape: `bp` is a sibling of `props` on the same object
// (Col/El in types.ts). `linked` fans the dragged value out to every key in
// `keys` instead of just `activeKey` — same rule as the Inspector's linked
// FourSideControl toggle.
export function writeDragSideKeys(
  target: { props?: Record<string, string>; bp?: Record<string, string> },
  keys: readonly string[],
  activeKey: string,
  px: number,
  linked: boolean,
  bp: Bp,
  bpKey: (key: string) => string,
): void {
  const touched = linked ? keys : [activeKey];
  if (bp === "desktop") {
    const patch: Record<string, string> = {};
    for (const k of touched) patch[k] = `${px}px`;
    target.props = { ...(target.props ?? {}), ...patch };
  } else {
    const patch: Record<string, string> = {};
    for (const k of touched) patch[bpKey(k)] = `${px}px`;
    target.bp = { ...(target.bp ?? {}), ...patch };
  }
}

// Section's own shape: SectionProps.bp lives INSIDE props (not a sibling —
// Block is just `{type, props}`), and the per-side keys (paddingTop, etc)
// live flat on props itself, so this needs its own write shape rather than
// fitting writeDragSideKeys' target.props/target.bp split.
export function applySectionSpacingWrite(
  props: { bp?: Record<string, string> },
  keys: readonly string[],
  activeKey: string,
  px: number,
  linked: boolean,
  bp: Bp,
  bpKey: (key: string) => string,
): void {
  const touched = linked ? keys : [activeKey];
  if (bp === "desktop") {
    for (const k of touched) (props as unknown as Record<string, string>)[k] = `${px}px`;
  } else {
    const patch: Record<string, string> = {};
    for (const k of touched) patch[bpKey(k)] = `${px}px`;
    props.bp = { ...(props.bp ?? {}), ...patch };
  }
}
