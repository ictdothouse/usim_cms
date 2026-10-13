import type { FastifyInstance } from "fastify";
import { verifySuperadmin, verifyAnyUser } from "../plugins/auth.js";
import { mergePermissions } from "./permissions.js";
import { findUserById, getRolePermissions, findUserByEmail, insertAuditLog } from "../db/tenant-pool.js";
import { signSession, SESSION_TTL_MS, generateCsrfToken, createAuthStamp } from "../db/auth.js";
import { setSessionCookie } from "../lib/cookies.js";

// "View as" impersonation + its reverse — moved out of index.ts verbatim
// (god-file breakup, index.ts).
export function registerImpersonationRoutes(app: FastifyInstance) {
  // "View as" — issues a token that IS the target webmaster's real session
  // (their userId/permissions), so the superadmin sees exactly what that
  // person sees (their own media, their own role's tab visibility), not a
  // synthetic all-access preview. impersonatedBy rides along in the token for
  // audit; nothing today reads it back out, but every mutating route already
  // takes req.user.userId off the token, so it lands in the DB for free the
  // moment something needs it.
  app.post("/api/portal/impersonate", async (req, reply) => {
    const admin = verifySuperadmin(req, reply);
    if (!admin) return;
    const { userId } = req.body as { userId?: string };
    if (!userId) {
      reply.code(400);
      return { error: "userId required" };
    }
    const target = await findUserById(userId);
    if (!target) {
      reply.code(404);
      return { error: "user not found" };
    }
    if (target.role !== "webmaster") {
      reply.code(400);
      return { error: "can only impersonate a webmaster" };
    }
    const permissions = mergePermissions(
      await getRolePermissions(target.roleId as string | null),
      target.extraPermissions as string[] | null,
    );
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: target.id as string,
      email: target.email as string,
      role: "webmaster",
      tenantHost: target.tenantHost as string | null,
      tenantHosts: (target.tenantHosts as string[] | null) ?? [],
      permissions,
      authStamp: createAuthStamp(target),
      mfaVerified: true,
      impersonatedBy: admin.email,
      csrfToken,
      exp: Date.now() + SESSION_TTL_MS,
    });
    await insertAuditLog({ actorUserId: admin.userId, actorEmail: admin.email, action: "impersonation.start", target: target.id, ip: req.ip });
    // Overwrites the superadmin's own session cookie with the target's — see
    // exit-impersonation below for how the admin gets their own session back
    // (the old cookie's raw value is gone the moment this response lands, so
    // it can't just be restored client-side the way a bearer-token model
    // could).
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return {
      csrfToken,
      role: "webmaster" as const,
      tenantHost: target.tenantHost as string | null,
      tenantHosts: (target.tenantHosts as string[] | null) ?? [],
    };
  });

  // Reverses /api/portal/impersonate: re-signs the original superadmin's own
  // session from the impersonatedBy email the impersonation token carries, and
  // overwrites the cookie back to it. Must be a real server round-trip, not a
  // client-side restore — the superadmin's original cookie value was already
  // overwritten by impersonate above and was never readable by JS anyway.
  app.post("/api/portal/exit-impersonation", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    if (!session.impersonatedBy) {
      reply.code(400);
      return { error: "not currently impersonating" };
    }
    const admin = await findUserByEmail(session.impersonatedBy);
    if (!admin || admin.role !== "superadmin") {
      reply.code(404);
      return { error: "original superadmin account not found" };
    }
    await insertAuditLog({ actorUserId: admin.id, actorEmail: admin.email, action: "impersonation.end", target: session.userId, ip: req.ip });
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: admin.id,
      email: admin.email,
      role: "superadmin",
      tenantHost: null,
      permissions: [],
      authStamp: createAuthStamp(admin),
      mfaVerified: true,
      csrfToken,
      exp: Date.now() + SESSION_TTL_MS,
    });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return { csrfToken, role: "superadmin" as const, tenantHost: null, tenantHosts: [] };
  });
}
