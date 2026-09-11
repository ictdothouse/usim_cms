import { Redis } from "ioredis";

// Shared cache for public (anonymous) GETs — see generic-crud.ts's public
// list/:id routes and index.ts's GET /api/theme. Distinct from apps/frontend's
// own lib/api.ts Map: that one is a per-process stale-while-revalidate
// FALLBACK (only read after a live fetch already failed) and shares nothing
// across replicas/blue-green colors. This one is read on every anonymous
// request and is genuinely shared, so it actually reduces DB load under
// multiple api replicas.
//
// REDIS_URL unset (default) = every function below is a no-op — a
// single-instance/local-dev deploy needs nothing, same "opt-in
// infrastructure" shape as pgbouncer.
let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return client;
  }
  client = new Redis(url, { maxRetriesPerRequest: 1 });
  // A cache is an optimization, never a hard dependency — log and keep
  // going, every caller below already treats a failure as a cache miss.
  client.on("error", (err: Error) => console.error("redis cache error", err));
  return client;
}

// Shared connection reused by rate-limit.ts's per-tenant budget — same
// REDIS_URL opt-in, no reason to open a second connection for one more
// counter alongside this module's own cache reads/writes.
export function getRedisClient(): Redis | null {
  return getClient();
}

const TTL_SECONDS = 60;

// Per-process counters for GET /metrics — reset on restart, same as every
// other in-memory metric this app exposes (see metrics.ts).
let hits = 0;
let misses = 0;

export function getCacheStats(): { hits: number; misses: number } {
  return { hits, misses };
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const c = getClient();
  if (!c) {
    misses++;
    return undefined;
  }
  try {
    const raw = await c.get(key);
    if (raw === null) {
      misses++;
      return undefined;
    }
    hits++;
    return JSON.parse(raw) as T;
  } catch {
    misses++;
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  } catch {
    // best-effort — a cache write must never fail the request it came from
  }
}

// Coarse: drops every cached response for one tenant+collection (or
// tenant+theme) rather than a single row — a write can't cheaply know every
// cached query-string permutation (?tag=/?from=/?status=/etc) it affected,
// and the TTL above is the backstop if an invalidation call is ever missed.
//
// ponytail: KEYS (not SCAN) — fine at this keyspace (per-tenant, 60s TTL,
// ~100-tenant scale), blocks Redis briefly at a much larger keyspace; switch
// to SCAN+DEL if that ever becomes real.
export async function cacheInvalidate(prefix: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    const keys = await c.keys(`${prefix}*`);
    if (keys.length) await c.del(...keys);
  } catch {
    // best-effort
  }
}
