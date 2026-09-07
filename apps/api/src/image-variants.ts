import { Readable } from "node:stream";
import sharp from "sharp";
import { uploadFile, deleteFile } from "./storage.js";

// Fixed downsize policy for every raster upload — the same constant is
// mirrored in apps/frontend/src/components/SectionBlock.astro's buildSrcset,
// since the frontend reconstructs which variant URLs exist purely from the
// original image's own width (see generateImageVariants' return value and
// index.ts's `?w=&h=` query string) rather than a DB lookup at render time.
// Keep both lists identical or a real srcset candidate will 404.
export const SRCSET_WIDTHS = [400, 800, 1200, 1600];

export interface ImageMeta {
  width: number;
  height: number;
}

// Generates downsized WebP siblings for an uploaded raster image, named
// `<baseFilename>-<width>w.webp` next to the original — every width in
// SRCSET_WIDTHS strictly smaller than the source (no upscaling). All-or-
// nothing: if any resize fails partway, whatever variants were already
// written for this upload are removed and null is returned, so a caller
// never ends up advertising a srcset candidate that doesn't exist on disk.
export async function generateImageVariants(
  tenantFolder: string,
  baseFilename: string,
  buffer: Buffer,
): Promise<ImageMeta | null> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(buffer).metadata();
    width = meta.width;
    height = meta.height;
  } catch {
    return null; // not a format sharp can decode
  }
  if (!width || !height) return null;

  const candidates = SRCSET_WIDTHS.filter((w) => w < width!);
  const written: string[] = [];
  try {
    for (const w of candidates) {
      const resized = await sharp(buffer).resize({ width: w }).webp({ quality: 80 }).toBuffer();
      const variantFilename = `${baseFilename}-${w}w.webp`;
      await uploadFile(tenantFolder, variantFilename, Readable.from(resized));
      written.push(variantFilename);
    }
  } catch {
    await Promise.all(written.map((f) => deleteFile(tenantFolder, f).catch(() => {})));
    return null;
  }
  return { width, height };
}

// Deletes every variant a media row's own width could have produced —
// called alongside the original file's own deleteFile so a removed media
// item never leaves orphaned -Nw.webp siblings behind.
export async function deleteImageVariants(tenantFolder: string, baseFilename: string, width: number | null): Promise<void> {
  if (!width) return;
  const candidates = SRCSET_WIDTHS.filter((w) => w < width);
  await Promise.all(candidates.map((w) => deleteFile(tenantFolder, `${baseFilename}-${w}w.webp`).catch(() => {})));
}
