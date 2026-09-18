import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, Image as ImageIcon, Pencil, Search, Trash2, UploadCloud, X } from "lucide-react";
import * as api from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT, inputCls, btnGhost, card, FormError, ListLoading, ListEmpty } from "./App";

export default function MediaManager({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [folders, setFolders] = useState<Array<Record<string, unknown>>>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null); // null = root (all folders + unfiled)
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ originalName: "", altText: "", description: "", folderId: "", isDecorative: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");

  async function refreshFolders() {
    try {
      setFolders(await api.listMediaFolders(tenantHost, token));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function refreshItems() {
    try {
      // Fetch the whole library once — folder counts and the root/folder
      // views below are all derived client-side from this one list.
      setItems(await api.listMedia(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    setLoading(true);
    void Promise.all([refreshFolders(), refreshItems()]).finally(() => setLoading(false));
  }, [tenantHost]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of items) {
      const fid = m.folderId as string | null;
      if (fid) counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    // A query searches the whole library, not just the open folder — a
    // folder-scoped filter would hide matches that live elsewhere and look
    // like search is broken.
    return items
      .filter((m) => q || ((m.folderId as string | null) ?? null) === activeFolder)
      .filter((m) => !q || (m.originalName as string).toLowerCase().includes(q));
  }, [items, activeFolder, search]);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        await api.uploadMedia(tenantHost, token, file, activeFolder);
      }
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) await uploadFiles(e.target.files);
    e.target.value = "";
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    await uploadFiles(e.dataTransfer.files);
  }

  async function copyUrl(m: Record<string, unknown>) {
    const raw = m.url as string;
    await navigator.clipboard.writeText(raw.startsWith("http") ? raw : api.publicMediaBase(tenantHost) + raw);
    setCopiedId(m.id as string);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === visibleItems.length ? new Set() : new Set(visibleItems.map((m) => m.id as string)),
    );
  }

  async function remove(id: string) {
    if (!(await confirm(t("media-delete-confirm")))) return;
    try {
      await api.deleteMedia(tenantHost, token, id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function bulkDelete() {
    if (!(await confirm(t("media-bulk-delete-confirm")))) return;
    try {
      for (const id of selected) await api.deleteMedia(tenantHost, token, id);
      setSelected(new Set());
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addFolder() {
    if (!newFolderName.trim()) return;
    try {
      await api.createMediaFolder(tenantHost, token, newFolderName.trim());
      setNewFolderName("");
      setAddingFolder(false);
      await refreshFolders();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function renameFolder(f: Record<string, unknown>) {
    if (!editingFolderName.trim()) return;
    try {
      await api.renameMediaFolder(tenantHost, token, f.id as string, editingFolderName.trim());
      setEditingFolderId(null);
      await refreshFolders();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeFolder(id: string) {
    if (!(await confirm(t("media-delete-folder-confirm")))) return;
    try {
      await api.deleteMediaFolder(tenantHost, token, id);
      if (activeFolder === id) setActiveFolder(null);
      await refreshFolders();
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit(m: Record<string, unknown>) {
    setEditingId(m.id as string);
    setEditForm({
      originalName: (m.originalName as string) ?? "",
      altText: (m.altText as string) ?? "",
      description: (m.description as string) ?? "",
      folderId: (m.folderId as string) ?? "",
      isDecorative: (m.isDecorative as boolean) ?? false,
    });
  }

  // Sprint 4 UX audit: alt text is required unless the image is explicitly
  // marked decorative — a blank alt is then a deliberate choice, not a gap.
  const altRequired = !editForm.isDecorative && !editForm.altText.trim();

  async function saveEdit(id: string) {
    if (altRequired) return;
    try {
      await api.updateMedia(tenantHost, token, id, {
        originalName: editForm.originalName,
        altText: editForm.altText || null,
        description: editForm.description || null,
        folderId: editForm.folderId || null,
        isDecorative: editForm.isDecorative,
      });
      setEditingId(null);
      await refreshItems();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const activeFolderName = activeFolder ? (folders.find((f) => f.id === activeFolder)?.name as string | undefined) : null;

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <ImageIcon className="h-4 w-4 text-accent" /> {t("media-title")}
      </h2>
      <FormError>{error}</FormError>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setActiveFolder(null)}
            className={activeFolder === null ? "font-semibold text-ink" : "text-sub hover:text-ink"}
          >
            {t("media-all-files")}
          </button>
          {activeFolderName && (
            <>
              <ChevronRight className="h-3 w-3 text-sub" />
              <span className="font-semibold text-ink">{activeFolderName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sub" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("media-search-placeholder")}
              className={`${inputCls} py-1.5 pl-8`}
            />
          </div>
          {addingFolder ? (
            <div className="flex items-center gap-1.5">
              <input
                className="rounded border border-line/30 px-1.5 py-1 text-xs outline-none"
                placeholder={t("media-new-folder-prompt")}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addFolder();
                  if (e.key === "Escape") setAddingFolder(false);
                }}
                autoFocus
              />
              <button onClick={addFolder} className="text-xs font-semibold text-accent hover:underline">
                {t("media-save")}
              </button>
              <button onClick={() => setAddingFolder(false)} className="text-xs text-sub hover:underline">
                {t("media-cancel")}
              </button>
            </div>
          ) : (
            <button onClick={() => setAddingFolder(true)} className={btnGhost}>
              + {t("media-new-folder")}
            </button>
          )}
        </div>
      </div>

      {activeFolder === null && !search.trim() && folders.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sub">{t("media-folders-heading")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {folders.map((f) => (
              <div
                key={f.id as string}
                onClick={() => setActiveFolder(f.id as string)}
                className={`${card} group flex cursor-pointer flex-col gap-2 p-3 transition-colors hover:border-accent/50`}
              >
                <div className="flex items-start justify-between">
                  <Folder className="h-7 w-7 text-accent/70" />
                  {editingFolderId !== f.id && (
                    <div className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingFolderId(f.id as string);
                          setEditingFolderName(f.name as string);
                        }}
                        className="rounded p-1 text-sub hover:bg-canvas"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => removeFolder(f.id as string)} className="rounded p-1 text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                {editingFolderId === f.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="w-full rounded border border-line/30 px-1.5 py-0.5 text-xs outline-none"
                      value={editingFolderName}
                      onChange={(e) => setEditingFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void renameFolder(f);
                        if (e.key === "Escape") setEditingFolderId(null);
                      }}
                      autoFocus
                    />
                    <button onClick={() => renameFolder(f)} className="text-[10px] font-semibold text-accent hover:underline">
                      {t("media-save")}
                    </button>
                    <button onClick={() => setEditingFolderId(null)} className="text-[10px] text-sub hover:underline">
                      {t("media-cancel")}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="truncate text-xs font-semibold text-ink">{f.name as string}</p>
                    <p className="text-[10px] text-sub">
                      {folderCounts.get(f.id as string) ?? 0} {t("media-items-suffix")}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sub">{t("media-assets-heading")}</p>

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            dragOver ? "border-accent bg-accent/5" : "border-line/50 hover:border-accent/50"
          }`}
        >
          <UploadCloud className="h-6 w-6 text-accent" />
          <p className="text-xs font-medium text-ink">{uploading ? t("uploading") : t("media-dropzone-title")}</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={onFileChosen}
          />
        </div>

        {visibleItems.length > 0 && (
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5 text-sub">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === visibleItems.length}
                onChange={toggleSelectAll}
              />
              {selected.size > 0 ? `${selected.size} ${t("media-selected-suffix")}` : t("media-select-all")}
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-3">
                <button onClick={() => setSelected(new Set())} className="flex items-center gap-1 text-sub hover:text-ink">
                  <X className="h-3 w-3" /> {t("media-clear-selection")}
                </button>
                <button onClick={bulkDelete} className="font-semibold text-red-600 hover:underline">
                  {t("media-bulk-delete")}
                </button>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <ListLoading />
        ) : visibleItems.length === 0 ? (
          <ListEmpty>{t("media-empty")}</ListEmpty>
        ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {visibleItems.map((m) => (
            <div key={m.id as string} className={`${card} group relative overflow-hidden`}>
              <input
                type="checkbox"
                checked={selected.has(m.id as string)}
                onChange={() => toggleSelect(m.id as string)}
                className="absolute left-1.5 top-1.5 z-10 h-3.5 w-3.5"
              />
              <img
                src={(m.url as string).startsWith("http") ? (m.url as string) : api.publicMediaBase(tenantHost) + (m.url as string)}
                alt={(m.altText as string) || (m.originalName as string)}
                className="h-24 w-full object-cover"
              />
              {editingId === m.id ? (
                <div className="space-y-1.5 p-2">
                  <input
                    className="w-full rounded border border-line px-1.5 py-1 text-[10px]"
                    placeholder={t("media-name-label")}
                    value={editForm.originalName}
                    onChange={(e) => setEditForm({ ...editForm, originalName: e.target.value })}
                  />
                  <input
                    className={`w-full rounded border px-1.5 py-1 text-[10px] ${altRequired ? "border-red-400" : "border-line"}`}
                    placeholder={t("media-alt-label")}
                    value={editForm.altText}
                    disabled={editForm.isDecorative}
                    onChange={(e) => setEditForm({ ...editForm, altText: e.target.value })}
                  />
                  {altRequired && <p className="text-[9px] text-red-600">{t("media-alt-required-hint")}</p>}
                  <label className="flex items-center gap-1.5 text-[10px] text-sub">
                    <input
                      type="checkbox"
                      checked={editForm.isDecorative}
                      onChange={(e) => setEditForm({ ...editForm, isDecorative: e.target.checked })}
                    />
                    {t("media-decorative-label")}
                  </label>
                  <textarea
                    className="w-full rounded border border-line px-1.5 py-1 text-[10px]"
                    placeholder={t("media-description-label")}
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                  <Select value={editForm.folderId || "__none"} onValueChange={(v) => setEditForm({ ...editForm, folderId: v === "__none" ? "" : v })}>
                    <SelectTrigger className="text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t("media-all-files")}</SelectItem>
                      {folders.map((f) => (
                        <SelectItem key={f.id as string} value={f.id as string}>
                          {f.name as string}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className="text-[10px] text-sub hover:underline">
                      {t("media-cancel")}
                    </button>
                    <button
                      onClick={() => saveEdit(m.id as string)}
                      disabled={altRequired}
                      className="text-[10px] font-semibold text-accent hover:underline disabled:opacity-40"
                    >
                      {t("media-save")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 p-2">
                  <p className="truncate text-[10px] font-medium text-ink" title={m.originalName as string}>
                    {m.originalName as string}
                  </p>
                  {!m.isDecorative && !m.altText && (
                    <p className="text-[9px] font-semibold text-warn">{t("media-no-alt-badge")}</p>
                  )}
                  <p className="text-[10px] text-sub">
                    {Math.max(1, Math.round((m.sizeBytes as number) / 1024))} KB ·{" "}
                    {new Date(m.createdAt as string).toLocaleDateString()}
                  </p>
                  <div className="flex items-center justify-between">
                    <button onClick={() => copyUrl(m)} className="text-[10px] font-semibold text-accent hover:underline">
                      {copiedId === m.id ? t("media-copied") : t("media-copy")}
                    </button>
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(m)} className="rounded p-1 text-sub hover:bg-canvas">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(m.id as string)} className="rounded p-1 text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        )}
      </div>
    </section>
  );
}
