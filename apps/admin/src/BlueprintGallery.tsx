import { useEffect, useState } from "react";
import * as api from "./lib/api";
import { TemplatePreview } from "./designer/TemplatePreview";
import { useT } from "./App";
import { useConfirm } from "@/hooks/useConfirm";
import type { Row } from "./designer/types";

function blueprintRows(bp: api.PageBlueprint): Row[] {
  // A blueprint's layout is a whole page's Block[] (section blocks only) —
  // flatten every section's own rows into one preview strip. Rows live at
  // section.props.rows, not section.rows (see Designer.tsx's templateRows).
  const sections = (bp.layout ?? []) as Array<{ props?: { rows?: Row[] } }>;
  return sections.flatMap((s) => s.props?.rows ?? []);
}

export function BlueprintGallery({
  tenantHost,
  token,
  mode,
  onUse,
  isSuper,
}: {
  tenantHost: string;
  token: string;
  mode: "picker" | "manage";
  onUse?: (bp: api.PageBlueprint) => void;
  isSuper: boolean;
}) {
  const { t } = useT();
  const confirm = useConfirm();
  const [blueprints, setBlueprints] = useState<api.PageBlueprint[]>([]);
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");

  async function refresh() {
    try {
      setBlueprints(await api.listBlueprints(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost]);

  async function remove(id: string) {
    if (!(await confirm(t("blueprints-delete-confirm")))) return;
    try {
      await api.deleteBlueprint(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit(bp: api.PageBlueprint) {
    setEditingId(bp.id);
    setEditName(bp.name);
    setEditDescription(bp.description ?? "");
    setEditCategory(bp.category ?? "");
  }

  async function saveEdit(id: string) {
    try {
      await api.updateBlueprint(tenantHost, token, id, {
        name: editName,
        description: editDescription.trim() || null,
        category: editCategory.trim() || null,
      });
      await refresh();
      setEditingId(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const categories = Array.from(new Set(blueprints.map((b) => b.category).filter((c): c is string => Boolean(c))));
  const visible = category ? blueprints.filter((b) => b.category === category) : blueprints;

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-danger">{error}</p>}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategory("")}
            className={`rounded-full px-3 py-1 text-xs font-medium ${category === "" ? "bg-accent text-white" : "bg-canvas text-body"}`}
          >
            {t("blueprints-all-categories")}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${category === c ? "bg-accent text-white" : "bg-canvas text-body"}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((bp) => (
          <div key={bp.id} className="space-y-2 rounded-lg border border-line/30 p-3">
            <TemplatePreview rows={blueprintRows(bp)} />
            {editingId === bp.id ? (
              <div className="space-y-1">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-line/30 bg-canvas px-2 py-1 text-xs text-ink"
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t("blueprints-description-placeholder")}
                  className="w-full rounded border border-line/30 bg-canvas px-2 py-1 text-xs text-ink"
                />
                <input
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  placeholder={t("blueprints-category-placeholder")}
                  className="w-full rounded border border-line/30 bg-canvas px-2 py-1 text-xs text-ink"
                />
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold text-ink">{bp.name}</p>
                {bp.description && <p className="text-[11px] text-sub">{bp.description}</p>}
                {bp.tenantHost === null && (
                  <span className="mt-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">
                    {t("blueprints-system-badge")}
                  </span>
                )}
              </div>
            )}
            {mode === "picker" ? (
              <button
                onClick={() => onUse?.(bp)}
                className="w-full rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
              >
                {t("blueprints-use")}
              </button>
            ) : editingId === bp.id ? (
              <div className="flex gap-2">
                <button
                  onClick={() => void saveEdit(bp.id)}
                  className="flex-1 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {t("blueprints-save")}
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="flex-1 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-body"
                >
                  {t("designer-cancel")}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(bp)}
                  disabled={bp.tenantHost === null && !isSuper}
                  className="flex-1 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-body disabled:opacity-40"
                >
                  {t("blueprints-edit")}
                </button>
                <button
                  onClick={() => void remove(bp.id)}
                  disabled={bp.tenantHost === null && !isSuper}
                  className="flex-1 rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-40"
                >
                  {t("blueprints-delete")}
                </button>
              </div>
            )}
          </div>
        ))}
        {visible.length === 0 && <p className="text-xs text-sub">{t("blueprints-empty")}</p>}
      </div>
    </div>
  );
}
