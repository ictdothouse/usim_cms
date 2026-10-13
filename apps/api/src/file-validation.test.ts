import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesAllowedMediaSignature } from "./file-validation.js";

test("media validation matches declared types to file signatures", () => {
  assert.equal(matchesAllowedMediaSignature("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(matchesAllowedMediaSignature("image/png", Buffer.from("<script>alert(1)</script>")), false);
  assert.equal(matchesAllowedMediaSignature("application/pdf", Buffer.from("%PDF-1.7")), true);
  assert.equal(matchesAllowedMediaSignature("application/zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(matchesAllowedMediaSignature("application/zip", Buffer.from("not a zip")), false);
  assert.equal(matchesAllowedMediaSignature("image/svg+xml", Buffer.from("<svg/>")), false);
});
