import { randomBytes } from "node:crypto";
import { getRedisClient } from "./cache.js";

// Ephemeral, unsaved-draft canvas content for Designer's Preview/Live-Edit
// flows (pages/blueprints/siteChrome) — never written to the pages/
// blueprints/site_chrome tables, just held long enough for one preview tab/
// iframe to read it back once (see index.ts's *-preview-token routes and
// GET /api/live-preview). Same opt-in-Redis-else-in-process-Map shape as
// rate-limit.ts's per-tenant budget: a single-instance/no-REDIS_URL deploy
// still works (this process only), multi-replica needs Redis to actually
// share a mint on one replica with a read on another.
const TTL_SECONDS = 600;
const memoryStore = new Map<string, { value: unknown; expires: number }>();

function sweepExpiredMemoryEntries(): void {
  const now = Date.now();
  for (const [id, entry] of memoryStore) {
    if (entry.expires < now) memoryStore.delete(id);
  }
}

export function newLivePreviewId(): string {
  return randomBytes(16).toString("hex");
}

export async function setLivePreview(id: string, value: unknown): Promise<void> {
  const client = getRedisClient();
  if (client) {
    try {
      await client.set(`ucms:livepreview:${id}`, JSON.stringify(value), "EX", TTL_SECONDS);
      return;
    } catch {
      // best-effort — fall through to the in-memory store below
    }
  }
  sweepExpiredMemoryEntries();
  memoryStore.set(id, { value, expires: Date.now() + TTL_SECONDS * 1000 });
}

export async function getLivePreview<T>(id: string): Promise<T | undefined> {
  const client = getRedisClient();
  if (client) {
    try {
      const raw = await client.get(`ucms:livepreview:${id}`);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // best-effort — fall through to the in-memory store below
    }
  }
  const entry = memoryStore.get(id);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    memoryStore.delete(id);
    return undefined;
  }
  return entry.value as T;
}
