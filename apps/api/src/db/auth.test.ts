import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, signSession, verifySession, SESSION_TTL_MS, type SessionPayload } from "./auth.js";

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
