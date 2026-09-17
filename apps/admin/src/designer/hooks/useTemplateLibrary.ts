// Layer 2 of the God Component refactor (see docs/superpowers/specs/
// 2026-08-29-designer-layer2-hooks-design.md) — extended scope vs. that
// spec's original useTemplateLibrary design: covers not just the template
// gallery (save/insert/delete a section/row/column/element snippet) but
// also the Component/Symbol system (makeComponent/insertSymbol/
// deleteSymbolHandler/detachSymbolInstance) and the blueprint-save modal
// (confirmSaveAsBlueprint) — both added to main after that spec was
// written, and both the same "insert/save a reusable content unit into the
// library" concern as templates.
import { useState } from "react";
import * as api from "@/lib/api";
import { toast } from "sonner";
import type { Key } from "@/i18n";
import { insertAt } from "../../designerTree";
import { section } from "../blockPath";
import type { Block, Row, Col, El, Sel, SectionProps, PageSettings } from "../types";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const uid = () => Math.random().toString(36).slice(2, 10);

export interface TemplateLibraryDeps {
  blocks: Block[];
  mutate: (fn: (next: Block[]) => void) => void;
  sel: Sel;
  bumpStructural: () => void;
  isSectionLocked: (b: number) => boolean;
  t: (k: Key) => string;
  tenantHost: string;
  token: string;
  pageSettings: PageSettings;
  availableSymbols: api.Symbol[];
  setAvailableSymbols: (v: api.Symbol[]) => void;
  setError: (msg: string | null) => void;
}

export function useTemplateLibrary(deps: TemplateLibraryDeps) {
  const { blocks, mutate, sel, bumpStructural, isSectionLocked, t, tenantHost, token, pageSettings, availableSymbols, setAvailableSymbols, setError } = deps;

  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<api.DesignTemplate[]>([]);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  // Naming step for "Save as template" — an in-app field, not window.prompt():
  // Chrome/Firefox silently suppress repeated JS dialogs in one tab ("prevent
  // this page from creating additional dialogs"), after which prompt() just
  // returns null instantly with no visible sign anything happened, which
  // made a real save look like a dead button.
  const [pendingTemplate, setPendingTemplate] = useState<{ kind: string; value: unknown } | null>(null);
  const [templateName, setTemplateName] = useState("");
  // "Make component" — same in-app naming pattern as "Save as template".
  const [pendingSymbolEl, setPendingSymbolEl] = useState<{ path: [number, number, number, number]; el: El } | null>(null);
  const [symbolName, setSymbolName] = useState("");
  const [symbolsBusy, setSymbolsBusy] = useState(false);
  // "Save as blueprint" — same in-app-modal naming pattern as templates.
  const [showSaveBlueprint, setShowSaveBlueprint] = useState(false);
  const [blueprintName, setBlueprintName] = useState("");
  const [blueprintDescription, setBlueprintDescription] = useState("");
  const [blueprintCategory, setBlueprintCategory] = useState("");
  const [blueprintScope, setBlueprintScope] = useState<"system" | "tenant">("tenant");
  const [blueprintBusy, setBlueprintBusy] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState<"all" | "section" | "row" | "column" | "element">("all");

  async function openTemplates() {
    setShowTemplates(true);
    setTemplatesBusy(true);
    try {
      setTemplates(await api.listTemplates(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  // Saveable at any selection depth — path[0] is always the containing
  // section's index regardless of depth, so this derives which level
  // (section/row/column/element) a given path actually points at. Defaults
  // to the left-click `sel` state, but the right-click context menu passes
  // its own `ctxMenu.path` explicitly — right-clicking an element never
  // updates `sel`, so relying on `sel` there silently no-ops on whatever was
  // previously (or never) left-click selected. Row is included because
  // clicking a section's background/grid area selects its Row, not the
  // section itself — without this, a user trying to save "the whole
  // section" via a background click always hit a silently-disabled Save
  // button.
  function templateKind(path: Sel = sel): "section" | "row" | "column" | "element" | null {
    if (!path || blocks[path[0]]?.type !== "section") return null;
    return path.length === 1
      ? "section"
      : path.length === 2
        ? "row"
        : path.length === 3
          ? "column"
          : path.length === 4
            ? "element"
            : null;
  }

  // Stages the save (opens the modal's inline name field) — the actual API
  // call happens in confirmSaveTemplate() once a name is entered.
  function saveAsTemplate(path: Sel = sel) {
    const kind = templateKind(path);
    if (!kind || !path) return;
    const value: unknown =
      kind === "section"
        ? blocks[path[0]]
        : kind === "row"
          ? section(blocks, path[0]).rows[path[1]]
          : kind === "column"
            ? section(blocks, path[0]).rows[path[1]].columns[path[2]]
            : section(blocks, path[0]).rows[path[1]].columns[path[2]].elements[path[3]];
    setShowTemplates(true);
    setTemplateName("");
    setPendingTemplate({ kind, value });
  }

  async function confirmSaveTemplate() {
    if (!pendingTemplate) return;
    const name = templateName.trim();
    if (!name) return;
    setTemplatesBusy(true);
    try {
      await api.createTemplate(tenantHost, token, name, pendingTemplate as unknown as Record<string, unknown>);
      setTemplates(await api.listTemplates(tenantHost, token));
      setPendingTemplate(null);
      setTemplateName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplatesBusy(false);
    }
  }

  // Stages "Make component" the same way saveAsTemplate stages a save —
  // element-level only (sel.length === 4): a symbol is always a single El,
  // same granularity as insertTemplate's "element" branch.
  function makeComponent(path: Sel = sel) {
    if (!path || path.length !== 4) return;
    const [b, r, c, e] = path;
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const el = section(blocks, b).rows[r].columns[c].elements[e];
    setShowTemplates(true);
    setSymbolName("");
    setPendingSymbolEl({ path: [b, r, c, e], el });
  }

  async function confirmMakeComponent() {
    if (!pendingSymbolEl) return;
    const name = symbolName.trim();
    if (!name) return;
    setSymbolsBusy(true);
    try {
      const sym = await api.createSymbol(tenantHost, token, name, clone(pendingSymbolEl.el) as unknown as Record<string, unknown>);
      const [b, r, c, e] = pendingSymbolEl.path;
      mutate((bs) => {
        section(bs, b).rows[r].columns[c].elements[e] = { id: uid(), type: "symbol", props: { symbolId: sym.id } };
      });
      setAvailableSymbols(await api.listSymbols(tenantHost, token));
      setPendingSymbolEl(null);
      setSymbolName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSymbolsBusy(false);
    }
  }

  // Mirrors insertTemplate's "element" branch, but no node cloning at all —
  // just a thin reference (see the symbols table's own comment for why).
  function insertSymbol(sym: api.Symbol) {
    if (!sel || sel.length < 3) {
      alert(t("designer-templates-need-column"));
      return;
    }
    const [b, r, c] = sel;
    if (isSectionLocked(b)) {
      toast.error(t("designer-section-locked-toast"));
      return;
    }
    const index = sel.length === 4 ? sel[3] + 1 : section(blocks, b).rows[r].columns[c].elements.length;
    mutate((bs) => insertAt(bs, [b, r, c], { id: uid(), type: "symbol", props: { symbolId: sym.id } } as El, index));
    bumpStructural();
  }

  async function deleteSymbolHandler(id: string) {
    if (!confirm(t("designer-symbols-delete-confirm"))) return;
    await api.deleteSymbol(tenantHost, token, id);
    setAvailableSymbols(await api.listSymbols(tenantHost, token));
  }

  // Breaks the live link: materializes the resolved symbol's current
  // content as a plain, independently-editable element — same one-shot-copy
  // convention as blueprint apply/insertTemplate elsewhere.
  function detachSymbolInstance(b: number, r: number, c: number, e: number) {
    const el = section(blocks, b).rows[r].columns[c].elements[e];
    const sym = availableSymbols.find((s) => s.id === el.props.symbolId);
    if (!sym) return;
    mutate((bs) => {
      section(bs, b).rows[r].columns[c].elements[e] = { ...(clone(sym.node) as unknown as El), id: uid() };
    });
  }

  async function confirmSaveAsBlueprint() {
    const name = blueprintName.trim();
    if (!name) return;
    setBlueprintBusy(true);
    try {
      await api.createBlueprint(tenantHost, token, {
        name,
        description: blueprintDescription.trim() || undefined,
        category: blueprintCategory.trim() || undefined,
        layout: blocks,
        settings: pageSettings,
        scope: blueprintScope,
      });
      setShowSaveBlueprint(false);
      setBlueprintName("");
      setBlueprintDescription("");
      setBlueprintCategory("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlueprintBusy(false);
    }
  }

  // Pre-migration rows have no `kind`/`value` wrapper — `data` itself was
  // the raw section block, so a missing `kind` falls back to that shape.
  function insertTemplate(tpl: api.DesignTemplate) {
    const kind = tpl.data?.kind as "section" | "row" | "column" | "element" | undefined;
    const value = kind ? tpl.data.value : tpl.data;
    if (kind === "row") {
      if (!sel || sel.length < 1) {
        alert(t("designer-templates-need-column"));
        return;
      }
      const b = sel[0];
      if (isSectionLocked(b)) {
        toast.error(t("designer-section-locked-toast"));
        return;
      }
      const index = sel.length >= 2 ? sel[1] + 1 : section(blocks, b).rows.length;
      mutate((bs) => section(bs, b).rows.splice(index, 0, clone(value) as Row));
    } else if (kind === "column" || kind === "element") {
      if (!sel || sel.length < 3) {
        alert(t("designer-templates-need-column"));
        return;
      }
      const [b, r, c, e] = sel;
      if (isSectionLocked(b)) {
        toast.error(t("designer-section-locked-toast"));
        return;
      }
      if (kind === "column") {
        mutate((bs) => section(bs, b).rows[r].columns.splice(c + 1, 0, clone(value) as Col));
      } else {
        const index = sel.length === 4 ? e + 1 : section(blocks, b).rows[r].columns[c].elements.length;
        mutate((bs) => insertAt(bs, [b, r, c], { ...(clone(value) as El), id: uid() }, index));
      }
    } else {
      mutate((bs) => bs.push(clone(value) as unknown as Block));
    }
    bumpStructural();
    setShowTemplates(false);
  }

  async function deleteTemplateHandler(id: string) {
    if (!confirm(t("designer-templates-delete-confirm"))) return;
    try {
      await api.deleteTemplate(tenantHost, token, id);
      setTemplates((ts) => ts.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function templateKindLabel(kind: string): string {
    return kind === "row"
      ? t("designer-row")
      : kind === "column"
        ? t("designer-column")
        : kind === "element"
          ? t("designer-elements")
          : t("designer-section");
  }

  // Normalizes a DesignTemplate's kind/value into TemplatePreview's rows[]
  // shape — same normalization the old inline TemplatePreview used to do
  // internally, now a plain call-site helper so the preview component itself
  // stays templates-vs-blueprints agnostic.
  function templateRows(tpl: api.DesignTemplate): Row[] {
    const kind = (tpl.data?.kind as string | undefined) ?? "section";
    const value = tpl.data?.kind ? tpl.data.value : tpl.data;
    return kind === "section"
      ? ((value as SectionProps).rows ?? [])
      : kind === "row"
        ? [value as Row]
        : kind === "column"
          ? [{ columns: [value as Col] } as Row]
          : [{ columns: [{ elements: [value as El] }] } as Row];
  }

  return {
    showTemplates, setShowTemplates, templates, templatesBusy,
    openTemplates, templateKind, saveAsTemplate, confirmSaveTemplate, insertTemplate, deleteTemplateHandler,
    templateFilter, setTemplateFilter, templateSearch, setTemplateSearch, templateKindLabel, templateRows,
    pendingTemplate, setPendingTemplate, templateName, setTemplateName,
    pendingSymbolEl, setPendingSymbolEl, symbolName, setSymbolName, symbolsBusy,
    makeComponent, confirmMakeComponent, insertSymbol, deleteSymbolHandler, detachSymbolInstance,
    showSaveBlueprint, setShowSaveBlueprint,
    blueprintName, setBlueprintName, blueprintDescription, setBlueprintDescription,
    blueprintCategory, setBlueprintCategory, blueprintScope, setBlueprintScope, blueprintBusy,
    confirmSaveAsBlueprint,
  };
}
