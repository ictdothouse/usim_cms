import { useEffect, useState } from "react";
import * as api from "./lib/api";
import { TemplatePreview } from "./designer/TemplatePreview";
import { useT } from "./App";
import type { Row } from "./designer/types";

function blueprintRows(bp: api.PageBlueprint): Row[] {
  // A blueprint's layout is a whole page's Block[] (section blocks only) —
  // flatten every section's own rows into one preview strip.
  const sections = (bp.layout ?? []) as Array<{ rows?: Row[] }>;
  return sections.flatMap((s) => s.rows ?? []);
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
  const [blueprints, setBlueprints] = useState<api.PageBlueprint[]>([]);
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setBlueprints(await api.listBlueprints(tenantHost, token, category || undefined));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantHost, category]);

  async function remove(id: string) {
    try {
      await api.deleteBlueprint(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const categories = Array.from(new Set(blueprints.map((b) => b.category).filter((c): c is string => Boolean(c))));

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
        {blueprints.map((bp) => (
          <div key={bp.id} className="space-y-2 rounded-lg border border-line/30 p-3">
            <TemplatePreview rows={blueprintRows(bp)} />
            <div>
              <p className="text-xs font-semibold text-ink">{bp.name}</p>
              {bp.description && <p className="text-[11px] text-sub">{bp.description}</p>}
              {bp.tenantHost === null && (
                <span className="mt-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">
                  {t("blueprints-system-badge")}
                </span>
              )}
            </div>
            {mode === "picker" ? (
              <button
                onClick={() => onUse?.(bp)}
                className="w-full rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
              >
                {t("blueprints-use")}
              </button>
            ) : (
              <div className="flex gap-2">
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
        {blueprints.length === 0 && <p className="text-xs text-sub">{t("blueprints-empty")}</p>}
      </div>
    </div>
  );
}
