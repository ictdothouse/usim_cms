import { unzipSync } from "fflate";

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

// .docx/.xlsx/.pptx are ZIP containers, so the ZIP magic alone also let any
// plain .zip be stored as a .docx. A real Office Open XML package carries
// [Content_Types].xml plus its own application's part folder.
const OOXML_PART_PREFIX: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word/",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt/",
};

function beginsWith(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function isOoxmlPackage(bytes: Uint8Array, partPrefix: string): boolean {
  const names: string[] = [];
  try {
    // A filter that returns false walks the central directory without
    // inflating any entry, so a zip bomb costs nothing here.
    unzipSync(bytes, { filter: (file) => (names.push(file.name), false) });
  } catch {
    return false; // no readable central directory
  }
  return names.includes("[Content_Types].xml") && names.some((name) => name.startsWith(partPrefix));
}

/** Check content signatures; multipart Content-Type is supplied by the client. */
export function matchesAllowedMediaSignature(mime: string, bytes: Uint8Array): boolean {
  switch (mime) {
    case "image/jpeg":
      return beginsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return beginsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return beginsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
    case "image/webp":
      return bytes.length >= 12 && beginsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case "video/mp4":
      return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    case "video/webm":
      return beginsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case "application/pdf":
      return beginsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return beginsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return ZIP_SIGNATURES.some((signature) => beginsWith(bytes, signature)) && isOoxmlPackage(bytes, OOXML_PART_PREFIX[mime]);
    case "application/zip":
      return ZIP_SIGNATURES.some((signature) => beginsWith(bytes, signature));
    default:
      return false;
  }
}
