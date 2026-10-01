import { and, asc, eq, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

// Page Blueprint (Sprint 5 sub-project 2) — control-plane, tenantHost NULL
// means system-wide. See schema.ts's pageBlueprints comment.
export async function listPageBlueprints(tenantHost: string, category?: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const scopeFilter = or(isNull(schema.pageBlueprints.tenantHost), eq(schema.pageBlueprints.tenantHost, tenantHost));
    const where = category ? and(scopeFilter, eq(schema.pageBlueprints.category, category)) : scopeFilter;
    return db.select().from(schema.pageBlueprints).where(where).orderBy(asc(schema.pageBlueprints.name));
  } finally {
    client.release();
  }
}

export async function getPageBlueprint(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db.select().from(schema.pageBlueprints).where(eq(schema.pageBlueprints.id, id));
    return row;
  } finally {
    client.release();
  }
}

export async function createPageBlueprint(input: {
  tenantHost: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  layout: unknown;
  settings?: unknown;
  createdBy?: string | null;
  createdByEmail?: string | null;
}) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [row] = await db
      .insert(schema.pageBlueprints)
      .values({
        tenantHost: input.tenantHost,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        layout: input.layout ?? [],
        settings: input.settings ?? {},
        createdBy: input.createdBy ?? null,
        createdByEmail: input.createdByEmail ?? null,
      })
      .returning();
    return row;
  } finally {
    client.release();
  }
}

export async function updatePageBlueprint(
  id: string,
  patch: { name?: string; description?: string | null; category?: string | null; layout?: unknown; settings?: unknown },
) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.pageBlueprints).set({ ...patch, updatedAt: new Date() }).where(eq(schema.pageBlueprints.id, id));
  } finally {
    client.release();
  }
}

export async function deletePageBlueprint(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.delete(schema.pageBlueprints).where(eq(schema.pageBlueprints.id, id));
  } finally {
    client.release();
  }
}
