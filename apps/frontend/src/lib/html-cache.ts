import { Redis } from "ioredis";

// Edge/HTML cache for this SSR frontend's own rendered output — closes the
// "Astro still renders every request fresh" gap apps/api's Redis cache
// (apps/api/src/cache.ts) never covered (that one only caches JSON API
// responses, not the render+network hop itself). Same REDIS_URL, same
// no-op-when-unset shape, same 60s-TTL-as-backstop convention — a separate
// client because this is a different process/package (Astro's own
// @astrojs/node server), not something apps/api's module can be imported
// into directly. Invalidated on publish via apps/api's own cacheInvalidate
// calls against the `ucms:htmlcache:<tenantHost>:` prefix (generic-crud.ts,
// index.ts's theme/tenant-languages routes) — same Redis instance, sibling
// keyspace, no code here needs to know about those writes.
let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return client;
  }
  client = new Redis(url, { maxRetriesPerRequest: 1 });
  client.on("error", (err: Error) => console.error("html cache error", err));
  return client;
}

const TTL_SECONDS = 60;

export async function htmlCacheGet(key: string): Promise<string | undefined> {
  const c = getClient();
  if (!c) return undefined;
  try {
    const raw = await c.get(key);
    return raw === null ? undefined : raw;
  } catch {
    return undefined;
  }
}

export async function htmlCacheSet(key: string, html: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, html, "EX", TTL_SECONDS);
  } catch {
    // best-effort — a cache write must never fail the request it came from
  }
}
