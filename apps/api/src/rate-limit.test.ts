import { test } from "node:test";
import assert from "node:assert/strict";
import { isTenantRateLimited } from "./rate-limit.js";

// No REDIS_URL in this test process, so isTenantRateLimited exercises the
// in-memory fallback bucket.
test("isTenantRateLimited allows requests under budget, blocks once over", async () => {
  const host = `test-tenant-${Math.random()}`;
  const limit = Number(process.env.TENANT_RATE_LIMIT_PER_MIN ?? 1200);
  for (let i = 0; i < limit; i++) {
    assert.equal(await isTenantRateLimited(host), false);
  }
  assert.equal(await isTenantRateLimited(host), true);
});

test("isTenantRateLimited tracks separate tenants independently", async () => {
  const a = `test-tenant-a-${Math.random()}`;
  const b = `test-tenant-b-${Math.random()}`;
  assert.equal(await isTenantRateLimited(a), false);
  assert.equal(await isTenantRateLimited(b), false);
});
