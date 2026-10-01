// Designer's page revision history modal (kind === "page" only) — split out
// of Designer.tsx as part of the same God Component file-size refactor
// Inspector.tsx already went through (see Designer.tsx's own header
// comment). Fed by usePersist's own revision-history slice.
//
// Holds no hooks of its own — deliberately NOT wrapped in React.memo (this
// region wasn't memoized before the split either).
import { History, X } from "lucide-react";
import type { Key } from "@/i18n";
import type { usePersist } from "./hooks/usePersist";

export type DesignerHistoryModalProps = Pick<
  ReturnType<typeof usePersist>,
  "showHistory" | "setShowHistory" | "revisions" | "revisionsLoaded" | "restoring" | "restoreRevision"
> & {
  t: (k: Key) => string;
};

export function DesignerHistoryModal({
  t, showHistory, setShowHistory, revisions, revisionsLoaded, restoring, restoreRevision,
}: DesignerHistoryModalProps) {
  if (!showHistory) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowHistory(false)}>
      <div className="w-[min(90vw,28rem)] rounded-xl bg-white p-4 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-bold text-ink"><History className="h-3.5 w-3.5" /> {t("designer-history")}</p>
          <button onClick={() => setShowHistory(false)} aria-label={t("designer-close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {!revisionsLoaded && <p className="text-[11px] text-sub">{t("designer-saving")}</p>}
        {revisionsLoaded && revisions.length === 0 && <p className="text-[11px] text-sub">{t("designer-history-empty")}</p>}
        <ul className="max-h-80 divide-y divide-line/20 overflow-y-auto">
          {revisions.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-sub">{new Date(r.createdAt).toLocaleString()} · {r.title}</span>
              <button
                onClick={() => void restoreRevision(r.id)}
                disabled={restoring}
                className="shrink-0 font-semibold text-accent hover:underline disabled:opacity-40"
              >
                {t("designer-restore")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
