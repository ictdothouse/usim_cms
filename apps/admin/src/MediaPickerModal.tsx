import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "./App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function MediaPickerModal({
  tenantHost, token, onSelect, onClose,
}: { tenantHost: string; token: string; onSelect: (url: string) => void; onClose: () => void }) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listMedia(tenantHost, token).then(setItems).catch((err) => setError((err as Error).message));
  }, [tenantHost]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const url = await api.uploadMedia(tenantHost, token, file);
      onSelect(url.startsWith("http") ? url : api.API_URL + url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("media-picker-title")}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 self-start">
          <Upload className="h-3.5 w-3.5" /> {uploading ? t("media-picker-uploading") : t("media-picker-upload-new")}
        </Button>
        <div className="grid flex-1 grid-cols-4 gap-3 overflow-y-auto">
          {items.filter((m) => (m.mimeType as string).startsWith("image/")).map((m) => (
            <button key={m.id as string} onClick={() => onSelect(api.API_URL + (m.url as string))} className="group relative aspect-square overflow-hidden rounded-lg border border-line/30 hover:border-accent">
              <img src={api.API_URL + (m.url as string)} alt={(m.altText as string) ?? ""} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("media-picker-cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
