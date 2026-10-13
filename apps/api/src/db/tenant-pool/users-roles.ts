import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pool, ensurePublicSchema } from "./internal.js";

export async function findUserByEmail(email: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return user;
  } finally {
    client.release();
  }
}

export async function findUserById(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user;
  } finally {
    client.release();
  }
}

export async function findUserByEntraObjectId(objectId: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.entraObjectId, objectId));
    return user;
  } finally {
    client.release();
  }
}

export async function listUsers() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        entraObjectId: schema.users.entraObjectId,
        role: schema.users.role,
        tenantHost: schema.users.tenantHost,
        tenantHosts: schema.users.tenantHosts,
        roleId: schema.users.roleId,
        extraPermissions: schema.users.extraPermissions,
        totpEnabled: schema.users.totpEnabled,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users);
  } finally {
    client.release();
  }
}

export async function createUser(
  email: string,
  passwordHash: string,
  role: string,
  tenantHost: string | null,
  roleId: string | null = null,
  tenantHosts: string[] = tenantHost ? [tenantHost] : [],
  extraPermissions: string[] = [],
  entraObjectId: string | null = null,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [created] = await db
      .insert(schema.users)
      .values({ email, passwordHash, role, tenantHost, tenantHosts, roleId, extraPermissions, entraObjectId })
      .onConflictDoNothing({ target: schema.users.email })
      .returning({ id: schema.users.id });
    return !!created;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserEntraObjectId(id: string, entraObjectId: string | null): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    try {
      const [updated] = await db
        .update(schema.users)
        .set({ entraObjectId, authVersion: sql`${schema.users.authVersion} + 1` })
        .where(eq(schema.users.id, id))
        .returning({ id: schema.users.id });
      return !!updated;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return false;
      throw error;
    }
  } finally {
    client.release();
  }
}

// First-run setup must be serialized in the database. A process-local mutex
// is insufficient because deployments may run multiple API replicas. The
// transaction advisory lock ensures exactly one request can create the first
// account, and only while the users table is empty.
export async function createInitialSuperadmin(email: string, passwordHash: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [7_518_230_041]);
    const result = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM "public"."users"');
    if (Number(result.rows[0]?.count ?? 0) > 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const db = drizzle(client, { schema });
    const [user] = await db
      .insert(schema.users)
      .values({ email, passwordHash, role: "superadmin", tenantHost: null, tenantHosts: [], roleId: null, extraPermissions: [] })
      .returning({ id: schema.users.id });
    await client.query("COMMIT");
    return user?.id ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserRole(id: string, roleId: string | null, extraPermissions?: string[]) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.users)
      .set(extraPermissions === undefined
        ? { roleId, authVersion: sql`${schema.users.authVersion} + 1` }
        : { roleId, extraPermissions, authVersion: sql`${schema.users.authVersion} + 1` })
      .where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

export async function updateUserPassword(id: string, passwordHash: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.update(schema.users).set({ passwordHash, authVersion: sql`${schema.users.authVersion} + 1` }).where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

// tenantHost (singular) stays in sync as hosts[0] — same convention createUser
// uses, since it's the webmaster's default/first site.
export async function updateUserTenantHosts(id: string, tenantHosts: string[]) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.users)
      .set({ tenantHosts, tenantHost: tenantHosts[0] ?? null, authVersion: sql`${schema.users.authVersion} + 1` })
      .where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

export async function deleteUser(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.delete(schema.users).where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

// Enrollment step 1 (POST /api/auth/totp-setup) — stores the new secret but
// leaves totpEnabled false until confirmed with a real code
// (setUserTotpEnabled below), so a half-finished enrollment never silently
// starts requiring a code the user hasn't confirmed they can generate.
export async function setUserTotpSecret(id: string, secret: string): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.users)
      .set({ totpSecret: secret, totpEnabled: false, authVersion: sql`${schema.users.authVersion} + 1` })
      .where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

// enabled=false also clears totpSecret (a user turning MFA off, or a
// superadmin resetting a locked-out user's MFA for recovery, should require
// a fresh enrollment next time, not silently reactivate an old secret).
export async function setUserTotpEnabled(id: string, enabled: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.users)
      .set(enabled
        ? { totpEnabled: true, authVersion: sql`${schema.users.authVersion} + 1` }
        : { totpEnabled: false, totpSecret: null, authVersion: sql`${schema.users.authVersion} + 1` })
      .where(eq(schema.users.id, id));
  } finally {
    client.release();
  }
}

export async function listRoles() {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    return db.select().from(schema.roles);
  } finally {
    client.release();
  }
}

export async function createRole(name: string, permissions: string[]) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.insert(schema.roles).values({ name, permissions });
  } finally {
    client.release();
  }
}

export async function updateRole(id: string, permissions: string[], name?: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db
      .update(schema.roles)
      .set(name === undefined ? { permissions } : { permissions, name })
      .where(eq(schema.roles.id, id));
  } finally {
    client.release();
  }
}

export async function deleteRole(id: string) {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
  } finally {
    client.release();
  }
}

// Superadmin sessions never consult this (hasPermission in index.ts always
// bypasses); webmasters with no role assigned get zero permissions.
export async function getRolePermissions(roleId: string | null): Promise<string[]> {
  if (!roleId) return [];
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
    return (role?.permissions as string[] | undefined) ?? [];
  } finally {
    client.release();
  }
}

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ACCOUNT_IP_FAILURES = 10;
const LOGIN_RATE_LIMIT_MAX_ACCOUNT_FAILURES = 50;
const LOGIN_RATE_LIMIT_MAX_IP_FAILURES = 30;
const LOGIN_ATTEMPTS_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.insert(schema.loginAttempts).values({ email, ip, success });
    // Lazy prune, piggybacked on the same write — no separate cleanup cron.
    await client.query("DELETE FROM login_attempts WHERE created_at < $1", [
      new Date(Date.now() - LOGIN_ATTEMPTS_RETENTION_MS),
    ]);
  } finally {
    client.release();
  }
}

// True once either this email or this IP has LOGIN_RATE_LIMIT_MAX_FAILURES
// failed attempts within LOGIN_RATE_LIMIT_WINDOW_MS — checked BEFORE the
// password is even compared, so a locked-out caller never gets a fresh
// timing oracle either. Keying on email OR ip (not just one) catches both a
// single account under brute force AND one IP enumerating many emails.
export async function isLoginRateLimited(email: string, ip: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const cutoff = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS);
    const { rows } = await client.query(
      "SELECT count(*) FILTER (WHERE email = $2 AND ip = $3)::int AS account_ip_failures, count(*) FILTER (WHERE email = $2)::int AS account_failures, count(*) FILTER (WHERE ip = $3)::int AS ip_failures FROM login_attempts WHERE success = false AND created_at > $1 AND (email = $2 OR ip = $3)",
      [cutoff, email, ip],
    );
    return (rows[0]?.account_ip_failures ?? 0) >= LOGIN_RATE_LIMIT_MAX_ACCOUNT_IP_FAILURES ||
      (rows[0]?.account_failures ?? 0) >= LOGIN_RATE_LIMIT_MAX_ACCOUNT_FAILURES ||
      (rows[0]?.ip_failures ?? 0) >= LOGIN_RATE_LIMIT_MAX_IP_FAILURES;
  } finally {
    client.release();
  }
}

// Control-plane audit trail — see schema.ts's audit_log comment for what
// this is (and isn't) meant to cover.
export async function insertAuditLog(entry: {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await ensurePublicSchema(client);
    const db = drizzle(client, { schema });
    await db.insert(schema.auditLog).values({
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      target: entry.target ?? null,
      meta: entry.meta ?? {},
      ip: entry.ip ?? null,
    });
  } finally {
    client.release();
  }
}
