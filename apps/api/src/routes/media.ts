import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { hasPermission } from "./permissions.js";
import { getMergedStorageLimits } from "../db/tenant-pool.js";
import { deleteFile } from "../storage.js";
import { generateImageVariants, deleteImageVariants } from "../image-variants.js";
import { uploadFile } from "../storage.js";

// Media upload + library CRUD + folders, moved out of index.ts verbatim
// (god-file breakup, index.ts).
export function registerMediaRoutes(protectedScope: FastifyInstance) {
  // Stores uploaded images (banners, etc.) on local disk under a per-tenant
  // folder. Served back publicly at the returned URL — that's expected for
  // site assets, not a tenant-isolation break (no read of any DB data here).
  // No svg in the allowlist on purpose: svg can carry scripts. Extension is
  // derived from THIS map (server-controlled), never the client's own
  // filename — without it, a part declaring e.g. `Content-Type:
  // video/mp4` with `filename: x.html` got stored and served back with a
  // `.html` extension, executing as a page on this API's own origin (a
  // stored-XSS → session-hijack chain, since GET /api/auth/session — same
  // origin — returns the caller's csrfToken).
  const MEDIA_EXT_BY_MIME: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  const tenantFolder = (host: string) => host.toLowerCase().replace(/[^a-z0-9]/g, "_");

  protectedScope.post("/api/media", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const limits = await getMergedStorageLimits(req.tenantHost);
    // Per-call override, not the plugin's registration-time default — this
    // is what actually enforces a site-specific cap: busboy stops reading
    // and truncates the stream once this many bytes are seen, rather than
    // us buffering an oversized file just to reject it.
    const file = await req.file({ limits: { fileSize: limits.maxUploadFileSizeMb * 1024 * 1024 } });
    if (!file) {
      reply.code(400);
      return { error: "file required (multipart/form-data, field name 'file')" };
    }
    // folderId must be appended to the FormData BEFORE the file field —
    // busboy only exposes fields that arrived ahead of the file stream here.
    let folderId: string | null = null;
    const folderField = file.fields.folderId;
    if (folderField && !Array.isArray(folderField) && folderField.type === "field") {
      folderId = (folderField.value as string) || null;
    }
    const ext = MEDIA_EXT_BY_MIME[file.mimetype];
    if (!ext) {
      reply.code(415);
      return { error: `unsupported file type ${file.mimetype} (jpeg/png/gif/webp/mp4/webm only)` };
    }
    const safeTenant = tenantFolder(req.tenantHost);
    const stem = randomUUID();
    const filename = `${stem}${ext}`;
    // Buffered (not streamed straight to storage) so the same bytes can also
    // feed sharp for the responsive-variant pipeline below — bounded by
    // limits.maxUploadFileSizeMb, already enforced on the multipart parser
    // above, so this never buffers more than a site's own configured cap.
    const fileBuffer = await streamToBuffer(file.file);
    // Busboy truncates the stream at the multipart fileSize limit rather
    // than erroring — detect it once the stream is fully drained (buffer()
    // just did that) and refuse the partial file before anything is
    // uploaded, rather than uploading then deleting.
    if (file.file.truncated) {
      reply.code(413);
      return { error: `file too large (max ${limits.maxUploadFileSizeMb} MB)` };
    }
    if (limits.maxTotalStorageMb !== null) {
      const [{ total }] = await req.db.select({ total: sql<string>`coalesce(sum(${schema.media.sizeBytes}), 0)` }).from(schema.media);
      if (Number(total) + fileBuffer.byteLength > limits.maxTotalStorageMb * 1024 * 1024) {
        reply.code(413);
        return { error: `storage limit reached (${limits.maxTotalStorageMb} MB max for this site)` };
      }
    }
    const { url: rawUrl } = await uploadFile(safeTenant, filename, Readable.from(fileBuffer));
    // Responsive image pipeline: gif is skipped (animated — sharp would only
    // read its first frame, silently breaking the animation in every
    // generated variant). jpeg/png/webp get downsized WebP siblings plus
    // their real pixel size embedded in the URL as `?w=&h=` — see
    // image-variants.ts and SectionBlock.astro's buildSrcset for how the
    // frontend reconstructs a real <img srcset> from that alone, no DB
    // lookup needed at render time.
    const meta =
      file.mimetype.startsWith("image/") && file.mimetype !== "image/gif"
        ? await generateImageVariants(safeTenant, stem, fileBuffer)
        : null;
    const url = meta ? `${rawUrl}?w=${meta.width}&h=${meta.height}` : rawUrl;
    const [item] = await req.db
      .insert(schema.media)
      .values({
        filename,
        originalName: file.filename,
        url,
        mimeType: file.mimetype,
        sizeBytes: fileBuffer.byteLength,
        width: meta?.width ?? null,
        height: meta?.height ?? null,
        folderId,
        uploadedBy: req.user.userId,
        uploadedByEmail: req.user.email,
      })
      .returning();
    return { url, item };
  });

  // Tenant-facing, read-only: what the merged limit resolves to for THIS
  // site, plus current usage — any authenticated user, not gated behind
  // media.upload (a webmaster who can't upload should still be able to see
  // WHY, and the Content Manager's media library page needs this even for
  // someone who only browses, not uploads).
  protectedScope.get("/api/storage-limits", async (req) => {
    const limits = await getMergedStorageLimits(req.tenantHost);
    const [{ total }] = await req.db.select({ total: sql<string>`coalesce(sum(${schema.media.sizeBytes}), 0)` }).from(schema.media);
    return { limits, usageBytes: Number(total) };
  });

  // A webmaster only ever sees/edits/deletes files they personally uploaded
  // — other webmasters on the same tenant are invisible to each other here.
  // Superadmin (browsing via the content-manager site picker, or a portal
  // tool) is the one role that still sees the whole tenant's library.
  const ownershipFilter = (req: { user: { role: string; userId: string } }) =>
    req.user.role === "superadmin" ? undefined : eq(schema.media.uploadedBy, req.user.userId);

  protectedScope.get("/api/media", async (req) => {
    const { folderId } = req.query as { folderId?: string };
    const conditions = [ownershipFilter(req), folderId ? eq(schema.media.folderId, folderId) : undefined].filter(
      (c): c is Exclude<typeof c, undefined> => c !== undefined,
    );
    const query = req.db.select().from(schema.media).orderBy(desc(schema.media.createdAt));
    const items = conditions.length ? await query.where(and(...conditions)) : await query;
    return { items };
  });

  protectedScope.patch("/api/media/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const { id } = req.params as { id: string };
    const body = req.body as {
      originalName?: string;
      altText?: string | null;
      description?: string | null;
      folderId?: string | null;
      isDecorative?: boolean;
    };
    const idFilter = ownershipFilter(req);
    // Allowlist fields explicitly — body is only TS-cast, not runtime
    // validated, so spreading it into .set() would let a caller overwrite
    // any column (uploadedBy, url, mimeType, ...) via extra JSON fields.
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.originalName !== undefined) updates.originalName = body.originalName;
    if (body.altText !== undefined) updates.altText = body.altText;
    if (body.description !== undefined) updates.description = body.description;
    if (body.folderId !== undefined) updates.folderId = body.folderId;
    if (body.isDecorative !== undefined) updates.isDecorative = body.isDecorative;
    const [item] = await req.db
      .update(schema.media)
      .set(updates)
      .where(idFilter ? and(eq(schema.media.id, id), idFilter) : eq(schema.media.id, id))
      .returning();
    if (!item) {
      reply.code(404);
      return { error: "not found" };
    }
    return { item };
  });

  protectedScope.delete("/api/media/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.delete")) {
      reply.code(403);
      return { error: "missing media.delete permission" };
    }
    const { id } = req.params as { id: string };
    const idFilter = ownershipFilter(req);
    const [row] = await req.db
      .delete(schema.media)
      .where(idFilter ? and(eq(schema.media.id, id), idFilter) : eq(schema.media.id, id))
      .returning();
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    const safeTenant = tenantFolder(req.tenantHost);
    await deleteFile(safeTenant, row.filename);
    await deleteImageVariants(safeTenant, path.parse(row.filename).name, row.width);
    return { deleted: true, id };
  });

  protectedScope.get("/api/media/folders", async (req) => ({
    items: await req.db.select().from(schema.mediaFolders).orderBy(schema.mediaFolders.name),
  }));

  protectedScope.post("/api/media/folders", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      reply.code(400);
      return { error: "name required" };
    }
    const [item] = await req.db.insert(schema.mediaFolders).values({ name: name.trim() }).returning();
    return { item };
  });

  protectedScope.patch("/api/media/folders/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.upload")) {
      reply.code(403);
      return { error: "missing media.upload permission" };
    }
    const { id } = req.params as { id: string };
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      reply.code(400);
      return { error: "name required" };
    }
    const [item] = await req.db
      .update(schema.mediaFolders)
      .set({ name: name.trim() })
      .where(eq(schema.mediaFolders.id, id))
      .returning();
    if (!item) {
      reply.code(404);
      return { error: "not found" };
    }
    return { item };
  });

  protectedScope.delete("/api/media/folders/:id", async (req, reply) => {
    if (!hasPermission({ role: req.user.role, permissions: req.user.permissions }, "media.delete")) {
      reply.code(403);
      return { error: "missing media.delete permission" };
    }
    const { id } = req.params as { id: string };
    // Files inside fall back to "no folder" (folder_id ON DELETE SET NULL) —
    // deleting a folder organizes, never bulk-deletes files.
    const [row] = await req.db.delete(schema.mediaFolders).where(eq(schema.mediaFolders.id, id)).returning();
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    return { deleted: true, id };
  });
}
