import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, scryptSync } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  SESSION_TTL_MS,
  generateTotpSecret,
  matchTotpStep,
  totpAuthUri,
  base32Encode,
  isMfaSetupRequired,
  createAuthStamp,
  matchesAuthStamp,
  type SessionPayload,
} from "./auth.js";

const basePayload: SessionPayload = {
  userId: "u1",
  email: "a@b.com",
  role: "webmaster",
  tenantHost: "dept.usim.edu.my",
  permissions: [],
};

test("isMfaSetupRequired: forces enrollment for every role when MFA is mandatory", () => {
  assert.equal(isMfaSetupRequired(false, true), true);
  assert.equal(isMfaSetupRequired(true, true), false, "already enrolled — normal challenge instead");
  assert.equal(isMfaSetupRequired(false, false), false, "mfaRequired off");
});

test("hashPassword/verifyPassword round-trip", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.match(stored, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
});

test("verifyPassword keeps accepting existing legacy scrypt hashes", async () => {
  const salt = "a9d043093a978e9c1f4123888307b51d";
  const legacy = `${salt}:${scryptSync("legacy fixture", salt, 64).toString("hex")}`;
  assert.equal(await verifyPassword("legacy fixture", legacy), true);
});

test("auth stamps revoke sessions monotonically after credential and role changes", () => {
  const user = { passwordHash: "hash", totpSecret: null, totpEnabled: false, authVersion: 1 };
  const stamp = createAuthStamp(user);
  assert.equal(matchesAuthStamp(stamp, user), true);
  assert.equal(matchesAuthStamp(stamp, { ...user, authVersion: 2 }), false);
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
test("matchTotpStep matches the RFC 6238 official SHA1 test vector", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  assert.equal(matchTotpStep(secret, "287082", 59_000), 1, "59s is time step 1");
});

// The replay guard (consumeTotpStep) stores the returned step, so it must be
// the step the code was minted for — not "now" — or a code from the previous
// step could be spent a second time after the clock ticks over.
test("matchTotpStep returns the step a drift-window code belongs to", () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_015_000; // mid-step
  const step = Math.floor(now / 30_000);
  assert.equal(matchTotpStep(secret, computeCodeForTest(secret, now, 0), now), step);
  assert.equal(matchTotpStep(secret, computeCodeForTest(secret, now, -1), now), step - 1);
  assert.equal(matchTotpStep(secret, computeCodeForTest(secret, now, 1), now), step + 1);
  assert.equal(matchTotpStep(secret, computeCodeForTest(secret, now, -2), now), null, "outside the ±1 window");
  assert.equal(matchTotpStep(secret, Number(computeCodeForTest(secret, now, 0)), now), null, "non-string body value");
});

test("totpAuthUri builds a well-formed otpauth:// URI", () => {
  const secret = generateTotpSecret();
  assert.match(totpAuthUri(secret, "x@y.com"), /^otpauth:\/\/totp\/UCMS%3Ax%40y\.com\?secret=[A-Z2-7]+&issuer=UCMS/);
});

test("matchTotpStep rejects a wrong-length code outright", () => {
  const secret = generateTotpSecret();
  assert.equal(matchTotpStep(secret, "12345"), null);
  assert.equal(matchTotpStep(secret, "1234567"), null);
});

test("matchTotpStep round-trips a freshly generated secret", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  // Re-derive the same code matchTotpStep itself would accept, via the
  // public API only (no reach into private helpers) — proves generate +
  // verify agree with each other for a real, random secret.
  const accepted = [-1, 0, 1].some((stepOffset) => matchTotpStep(secret, computeCodeForTest(secret, now, stepOffset), now) !== null);
  assert.equal(accepted, true);
});

function computeCodeForTest(secret: string, now: number, stepOffset: number): string {
  // Independent re-derivation (own base32 decode + HMAC call) of the code
  // matchTotpStep should accept for a random secret, so the round-trip test
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
