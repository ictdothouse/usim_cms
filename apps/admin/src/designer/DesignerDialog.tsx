import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

/** Focus-managed overlay shared by Designer's preview and library panels. */
export function DesignerDialog({ title, onClose, children, className = "" }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
      <Dialog.Content
        className={`designer-dialog fixed inset-0 z-[60] flex items-center justify-center p-4 ${className}`}
        onClick={onClose}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        <Dialog.Description className="sr-only">{title}</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
