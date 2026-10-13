import type { FastifyInstance } from "fastify";
import { verifySuperadmin } from "../plugins/auth.js";
import { validatePermissions, mergePermissions } from "./permissions.js";
import { hashPassword, validatePasswordInput } from "../db/auth.js";
import {
  listUsers,
  createUser,
  updateUserRole,
  updateUserPassword,
  updateUserTenantHosts,
  updateUserEntraObjectId,
  findUserById,
  setUserTotpEnabled,
  deleteUser,
  getRolePermissions,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listLanguages,
  createLanguage,
  updateLanguage,
  deleteLanguage,
  insertAuditLog,
} from "../db/tenant-pool.js";

// Superadmin-only users/roles/languages CRUD — moved out of index.ts verbatim
// (god-file breakup, part 6/9).
export function registerUsersRolesLanguagesRoutes(app: FastifyInstance) {
  app.get("/api/portal/users", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return { users: await listUsers() };
  });

  app.post("/api/portal/users", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { email, password, role, tenantHost, tenantHosts, roleId, extraPermissions, entraObjectId } = req.body as {
      email?: string;
      password?: string;
      role?: string;
      tenantHost?: string;
      tenantHosts?: string[];
      roleId?: string | null;
      extraPermissions?: string[];
      entraObjectId?: string | null;
    };
    const hosts = tenantHosts?.length ? tenantHosts : tenantHost ? [tenantHost] : [];
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !role || !["webmaster", "superadmin"].includes(role) || (role === "webmaster" && hosts.length === 0)) {
      reply.code(400);
      return { error: "valid email and role required (at least one site required for webmaster)" };
    }
    const passwordError = validatePasswordInput(password);
    if (passwordError) {
      reply.code(400);
      return { error: passwordError };
    }
    const permError = validatePermissions(extraPermissions);
    if (permError) {
      reply.code(400);
      return { error: permError };
    }
    const normalizedEntraObjectId = typeof entraObjectId === "string" ? entraObjectId.trim().toLowerCase() : null;
    if (normalizedEntraObjectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalizedEntraObjectId)) {
      reply.code(400);
      return { error: "Entra object ID must be a GUID" };
    }
    if (hosts.length > 1) {
      const effective = mergePermissions(await getRolePermissions(roleId ?? null), extraPermissions ?? []);
      if (!effective.includes("sites.multi")) {
        reply.code(400);
        return { error: "role/permissions don't allow multiple sites" };
      }
    }
    const created = await createUser(normalizedEmail, await hashPassword(password!), role, hosts[0] ?? null, roleId ?? null, hosts, extraPermissions ?? [], normalizedEntraObjectId);
    if (!created) {
      reply.code(409);
      return { error: "account already exists" };
    }
    await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "user.create", target: normalizedEmail, meta: { role }, ip: req.ip });
    return { created: true };
  });

  app.patch("/api/portal/users/:id", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { id } = req.params as { id: string };
    const { roleId, extraPermissions, password, tenantHosts, entraObjectId } = req.body as {
      roleId?: string | null;
      extraPermissions?: string[];
      password?: string;
      tenantHosts?: string[];
      entraObjectId?: string | null;
    };
    // Each field only touches its own column when present — omitting roleId
    // (e.g. a password-only edit) must never fall through to `?? null` and
    // wipe an existing role assignment.
    if (roleId !== undefined || extraPermissions !== undefined) {
      const permError = validatePermissions(extraPermissions);
      if (permError) {
        reply.code(400);
        return { error: permError };
      }
      await updateUserRole(id, roleId ?? null, extraPermissions);
    }
    if (password !== undefined) {
      const passwordError = validatePasswordInput(password);
      if (passwordError) {
        reply.code(400);
        return { error: passwordError };
      }
      await updateUserPassword(id, await hashPassword(password));
    }
    if (tenantHosts) {
      if (tenantHosts.length === 0) {
        reply.code(400);
        return { error: "at least one site required" };
      }
      await updateUserTenantHosts(id, tenantHosts);
    }
    if (entraObjectId !== undefined) {
      const normalizedEntraObjectId = typeof entraObjectId === "string" && entraObjectId.trim() ? entraObjectId.trim().toLowerCase() : null;
      if (normalizedEntraObjectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalizedEntraObjectId)) {
        reply.code(400);
        return { error: "Entra object ID must be a GUID" };
      }
      const updated = await updateUserEntraObjectId(id, normalizedEntraObjectId);
      if (!updated) {
        reply.code(409);
        return { error: "user was not found or this Entra object ID is already linked" };
      }
    }
    const changedFields = [
      ...(roleId !== undefined || extraPermissions !== undefined ? ["permissions"] : []),
      ...(password !== undefined ? ["password"] : []),
      ...(tenantHosts !== undefined ? ["tenantHosts"] : []),
      ...(entraObjectId !== undefined ? ["entraObjectId"] : []),
    ];
    if (changedFields.length) {
      await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "user.update", target: id, meta: { changedFields }, ip: req.ip });
    }
    return { saved: true };
  });

  app.post("/api/portal/users/:id/mfa-reset", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { id } = req.params as { id: string };
    if (id === actor.userId) {
      reply.code(400);
      return { error: "cannot reset your own MFA" };
    }
    const { reason } = (req.body && typeof req.body === "object" ? req.body : {}) as { reason?: string };
    const normalizedReason = typeof reason === "string" ? reason.trim() : "";
    if (normalizedReason.length < 10 || normalizedReason.length > 500) {
      reply.code(400);
      return { error: "MFA reset reason must be between 10 and 500 characters" };
    }
    const target = await findUserById(id);
    if (!target) {
      reply.code(404);
      return { error: "user not found" };
    }
    await setUserTotpEnabled(id, false);
    await insertAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "user.mfa_reset",
      target: id,
      meta: { reason: normalizedReason },
      ip: req.ip,
    });
    return { reset: true };
  });

  // Danger Zone-adjacent: irreversible, so refuse deleting the account making
  // the request (a superadmin locking themselves out would have no other way
  // back in).
  app.delete("/api/portal/users/:id", async (req, reply) => {
    const session = verifySuperadmin(req, reply);
    if (!session) return;
    const { id } = req.params as { id: string };
    if (id === session.userId) {
      reply.code(400);
      return { error: "cannot delete your own account" };
    }
    await deleteUser(id);
    await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "user.delete", target: id, ip: req.ip });
    return { deleted: true };
  });

  app.get("/api/portal/roles", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return { roles: await listRoles() };
  });

  app.post("/api/portal/roles", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { name, permissions } = req.body as { name?: string; permissions?: string[] };
    if (!name) {
      reply.code(400);
      return { error: "name required" };
    }
    const permError = validatePermissions(permissions);
    if (permError) {
      reply.code(400);
      return { error: permError };
    }
    await createRole(name, permissions ?? []);
    await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "role.create", target: name, meta: { permissions: permissions ?? [] }, ip: req.ip });
    return { created: true };
  });

  app.patch("/api/portal/roles/:id", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { id } = req.params as { id: string };
    const { permissions, name } = req.body as { permissions?: string[]; name?: string };
    if (name !== undefined && !name.trim()) {
      reply.code(400);
      return { error: "name cannot be empty" };
    }
    const permError = validatePermissions(permissions);
    if (permError) {
      reply.code(400);
      return { error: permError };
    }
    await updateRole(id, permissions ?? [], name);
    await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "role.update", target: id, meta: { name: name ?? null, permissions: permissions ?? [] }, ip: req.ip });
    return { saved: true };
  });

  app.delete("/api/portal/roles/:id", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { id } = req.params as { id: string };
    await deleteRole(id);
    await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "role.delete", target: id, ip: req.ip });
    return { deleted: true, id };
  });

  // Superadmin-curated master language list (i18n Phase 1 — see
  // docs/superpowers/specs/2026-08-06-global-language-registry-design.md).
  // `code` is immutable once created: PATCH silently ignores it, matching how
  // roles' own PATCH treats `name` vs `permissions` distinctly above.
  const LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[a-z]{2,4})?$/;

  app.get("/api/portal/languages", async (req, reply) => {
    if (!verifySuperadmin(req, reply)) return;
    return { languages: await listLanguages() };
  });

  app.post("/api/portal/languages", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { code, label } = req.body as { code?: string; label?: string };
    if (!code || !LANGUAGE_CODE_RE.test(code)) {
      reply.code(400);
      return { error: "code must look like a language code, e.g. \"en\" or \"zh-cn\"" };
    }
    if (!label?.trim()) {
      reply.code(400);
      return { error: "label required" };
    }
    try {
      await createLanguage(code, label);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        reply.code(400);
        return { error: "code already exists" };
      }
      throw err;
    }
    await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "language.create", target: code, meta: { label }, ip: req.ip });
    return { created: true };
  });

  app.patch("/api/portal/languages/:id", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { id } = req.params as { id: string };
    const { label, enabled, sortOrder } = req.body as { label?: string; enabled?: boolean; sortOrder?: number };
    if (label !== undefined && !label.trim()) {
      reply.code(400);
      return { error: "label cannot be empty" };
    }
    const patch: { label?: string; enabled?: boolean; sortOrder?: number } = {};
    if (label !== undefined) patch.label = label;
    if (enabled !== undefined) patch.enabled = enabled;
    if (sortOrder !== undefined) patch.sortOrder = sortOrder;
    const { error } = await updateLanguage(id, patch);
    if (error) {
      reply.code(400);
      return { error };
    }
    await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "language.update", target: id, meta: patch, ip: req.ip });
    return { saved: true };
  });

  app.delete("/api/portal/languages/:id", async (req, reply) => {
    const actor = verifySuperadmin(req, reply);
    if (!actor) return;
    const { id } = req.params as { id: string };
    const { error } = await deleteLanguage(id);
    if (error) {
      reply.code(400);
      return { error };
    }
    await insertAuditLog({ actorUserId: actor.userId, actorEmail: actor.email, action: "language.delete", target: id, ip: req.ip });
    return { deleted: true, id };
  });
}
