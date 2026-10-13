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
import { DesignerDialog } from "./DesignerDialog";

export type DesignerHistoryModalProps = Pick<
  ReturnType<typeof usePersist>,
  "showHistory" | "setShowHistory" | "revisions" | "revisionsLoaded" | "historyError" | "loadHistory" | "restoring" | "restoreRevision"
> & {
  t: (k: Key) => string;
};

export function DesignerHistoryModal({
  t, showHistory, setShowHistory, revisions, revisionsLoaded, historyError, loadHistory, restoring, restoreRevision,
}: DesignerHistoryModalProps) {
  if (!showHistory) return null;
  return (
    <DesignerDialog title={t("designer-history")} onClose={() => setShowHistory(false)}>
      <div className="w-[min(90vw,28rem)] rounded-xl bg-white p-4 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink"><History className="h-4 w-4" /> {t("designer-history")}</p>
          <button onClick={() => setShowHistory(false)} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-canvas" aria-label={t("designer-close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {historyError && <div role="alert" className="flex items-center gap-3 text-sm text-red-700"><span>{historyError}</span><button type="button" onClick={() => void loadHistory()} className="font-semibold underline">{t("list-retry")}</button></div>}
        {!revisionsLoaded && !historyError && <p className="text-sm text-sub">{t("list-loading")}</p>}
        {revisions.some((r) => r.seo == null || r.translations == null) && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{t("designer-history-legacy-note")}</p>}
        {revisionsLoaded && revisions.length === 0 && <p className="text-sm text-sub">{t("designer-history-empty")}</p>}
        <ul className="max-h-80 divide-y divide-line/20 overflow-y-auto">
          {revisions.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-sub">{new Date(r.createdAt).toLocaleString()} · {r.title}</span>
              <button
                onClick={() => void restoreRevision(r.id)}
                disabled={restoring}
                className="min-h-10 shrink-0 rounded-lg px-2 font-semibold text-accent hover:bg-canvas disabled:opacity-40"
              >
                {t("designer-restore")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </DesignerDialog>
  );
}
