import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { matchesAllowedMediaSignature } from "./file-validation.js";

test("media validation matches declared types to file signatures", () => {
  assert.equal(matchesAllowedMediaSignature("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(matchesAllowedMediaSignature("image/png", Buffer.from("<script>alert(1)</script>")), false);
  assert.equal(matchesAllowedMediaSignature("application/pdf", Buffer.from("%PDF-1.7")), true);
  assert.equal(matchesAllowedMediaSignature("application/zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(matchesAllowedMediaSignature("application/zip", Buffer.from("not a zip")), false);
  assert.equal(matchesAllowedMediaSignature("image/svg+xml", Buffer.from("<svg/>")), false);
});

test("Office Open XML types need a real package, not just the ZIP magic", () => {
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const docx = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<w:document/>") });
  const plainZip = zipSync({ "notes.txt": strToU8("hello") });
  assert.equal(matchesAllowedMediaSignature(DOCX, docx), true);
  assert.equal(matchesAllowedMediaSignature(DOCX, plainZip), false, "plain zip renamed to .docx");
  assert.equal(matchesAllowedMediaSignature(XLSX, docx), false, "a docx is not an xlsx");
  assert.equal(matchesAllowedMediaSignature(DOCX, Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), false, "magic only, no directory");
  assert.equal(matchesAllowedMediaSignature("application/zip", plainZip), true);
});
