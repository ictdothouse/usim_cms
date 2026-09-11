import { getRedisClient } from "./cache.js";

// Per-tenant request budget — protects one tenant's traffic spike (or an
// attack against ordinary /api/* routes) from starving every other tenant on
// this single instance. Keyed on tenantHost alone, not IP/email: the goal is
// a shared ceiling per tenant, distinct from isLoginRateLimited in
// tenant-pool.ts which already covers per-IP/email login-specific abuse.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.TENANT_RATE_LIMIT_PER_MIN ?? 1200);

// In-memory fallback when REDIS_URL is unset — same "opt-in infrastructure"
// shape as cache.ts. A single-instance deploy still gets real protection
// from this Map; a multi-replica deploy needs REDIS_URL for the budget to
// actually be shared across replicas (same tradeoff cache.ts documents).
const memoryBuckets = new Map<string, { bucket: number; count: number }>();

export async function isTenantRateLimited(tenantHost: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const redis = getRedisClient();
  if (redis) {
    const key = `ucms:ratelimit:${tenantHost}:${bucket}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, WINDOW_MS * 2);
      return count > MAX_PER_WINDOW;
    } catch {
      // A rate limit is a safety net, never a hard dependency — same stance
      // as cache.ts: Redis being down must not take the API down with it.
      return false;
    }
  }
  const entry = memoryBuckets.get(tenantHost);
  if (!entry || entry.bucket !== bucket) {
    memoryBuckets.set(tenantHost, { bucket, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > MAX_PER_WINDOW;
}
