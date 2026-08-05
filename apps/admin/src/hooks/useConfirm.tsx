import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
// Circular import (App.tsx -> hooks/useConfirm.tsx for useConfirm; here ->
// App.tsx for useT) — same pattern CategoriesPanel.tsx/PostEditorPage.tsx
// already use for useT and it works fine, since it's only called inside a
// component body (after both modules finish loading), never at module scope.
import { useT } from "@/App";

type ConfirmFn = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// Mounted inside Shell (App.tsx), nested under I18nCtx.Provider, not at the
// app root — every useConfirm() call site lives inside Shell's post-login
// subtree, and useT() only resolves the real selected language for a
// component that's actually nested inside that provider.
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((msg) => {
    setMessage(msg);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setMessage(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={message !== null} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{message}</AlertDialogTitle>
            {/* Radix only warns (doesn't throw) without a description, but an
                sr-only one costs nothing — reusing the already-translated
                message avoids inventing a second, redundant string/i18n key. */}
            <AlertDialogDescription className="sr-only">{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{t("confirm-cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => settle(true)}>{t("confirm-ok")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() must be used inside <ConfirmDialogProvider>");
  return ctx;
}
