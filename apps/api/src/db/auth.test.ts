import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  SESSION_TTL_MS,
  generateTotpSecret,
  verifyTotpCode,
  totpAuthUri,
  base32Encode,
  type SessionPayload,
} from "./auth.js";

const basePayload: SessionPayload = {
  userId: "u1",
  email: "a@b.com",
  role: "webmaster",
  tenantHost: "dept.usim.edu.my",
  permissions: [],
};

test("hashPassword/verifyPassword round-trip", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("wrong password", stored), false);
});

test("signSession/verifySession round-trip preserves payload", () => {
  const token = signSession({ ...basePayload, exp: Date.now() + SESSION_TTL_MS });
  const decoded = verifySession(token);
  assert.equal(decoded?.userId, basePayload.userId);
  assert.equal(decoded?.tenantHost, basePayload.tenantHost);
});

test("verifySession rejects a tampered signature", () => {
  const token = signSession({ ...basePayload, exp: Date.now() + SESSION_TTL_MS });
  const [body] = token.split(".");
  assert.equal(verifySession(`${body}.tampered-signature`), null);
});

test("verifySession rejects an expired token", () => {
  const expired = signSession({ ...basePayload, exp: Date.now() - 1000 });
  assert.equal(verifySession(expired), null);
});

test("verifySession accepts a token that has not yet expired", () => {
  const fresh = signSession({ ...basePayload, exp: Date.now() + 1000 });
  assert.notEqual(verifySession(fresh), null);
});

// RFC 6238 Appendix B's official SHA1 test vector: ASCII key
// "12345678901234567890", Time = 59s -> 8-digit TOTP "94287082". Our
// implementation truncates to 6 digits (Google Authenticator convention),
// which is mathematically just the last 6 digits of the same computation —
// "287082" — so a match here proves the HMAC/counter/truncation logic is
// correct, not just self-consistent with its own encoder.
test("verifyTotpCode matches the RFC 6238 official SHA1 test vector", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  assert.equal(verifyTotpCode(secret, "287082", 59_000), true);
});

test("totpAuthUri builds a well-formed otpauth:// URI", () => {
  const secret = generateTotpSecret();
  assert.match(totpAuthUri(secret, "x@y.com"), /^otpauth:\/\/totp\/UCMS%3Ax%40y\.com\?secret=[A-Z2-7]+&issuer=UCMS/);
});

test("verifyTotpCode rejects a wrong-length code outright", () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotpCode(secret, "12345"), false);
  assert.equal(verifyTotpCode(secret, "1234567"), false);
});

test("verifyTotpCode round-trips a freshly generated secret", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  // Re-derive the same code verifyTotpCode itself would accept, via the
  // public API only (no reach into private helpers) — proves generate +
  // verify agree with each other for a real, random secret.
  const accepted = [-1, 0, 1].some((stepOffset) => verifyTotpCode(secret, computeCodeForTest(secret, now, stepOffset), now));
  assert.equal(accepted, true);
});

function computeCodeForTest(secret: string, now: number, stepOffset: number): string {
  // Independent re-derivation (own base32 decode + HMAC call) of the code
  // verifyTotpCode should accept for a random secret, so the round-trip test
  // above isn't just asserting the function agrees with itself.
  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(bytes);
  const counter = Math.floor(now / 1000 / 30) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}
