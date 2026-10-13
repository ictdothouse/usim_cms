import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { verifyAnyUser } from "../plugins/auth.js";
import { mergePermissions } from "./permissions.js";
import {
  findUserByEmail,
  findUserByEntraObjectId,
  createInitialSuperadmin,
  createTenant,
  listUsers,
  findUserById,
  updateUserPassword,
  getRolePermissions,
  isLoginRateLimited,
  recordLoginAttempt,
  getEntraSettings,
  getMfaEnabled,
  getMfaRequired,
  setUserTotpSecret,
  setUserTotpEnabled,
  insertAuditLog,
} from "../db/tenant-pool.js";
import {
  verifyPasswordOrDummy,
  hashPassword,
  signSession,
  verifySession,
  SESSION_TTL_MS,
  generateTotpSecret,
  verifyTotpCode,
  totpAuthUri,
  generateCsrfToken,
  isMfaSetupRequired,
  createAuthStamp,
  matchesAuthStamp,
  validatePasswordInput,
  type SessionPayload,
} from "../db/auth.js";
import { setSessionCookie, clearSessionCookie, setEntraStateCookie, getEntraStateCookie, clearEntraStateCookie } from "../lib/cookies.js";
import { getEntraAuthorizeUrl, exchangeEntraCode, verifyEntraIdToken, isPasswordLoginAllowed, isEntraStateValid } from "../entra.js";

// First-run bootstrap, password + Entra ID login, session read-back, and TOTP
// MFA enrollment/challenge/disable routes — moved out of index.ts verbatim
// (god-file breakup, part 2/9). See apps/api/CLAUDE.md's Auth hardening
// section for the mandatory-MFA / Entra-ID-SSO design this implements.
export function registerAuthRoutes(app: FastifyInstance, adminOrigins: string[] | undefined) {
  // One admin origin to redirect back to after the Entra round trip — the
  // first of ADMIN_ORIGIN's (possibly comma-separated) list, falling back to
  // the admin dev server's own default port in dev (mirrors the CORS
  // adminOrigins fallback in index.ts, which allows any origin in dev instead).
  const entraRedirectAdminOrigin = adminOrigins?.[0] ?? "http://localhost:5173";

  function reissueCurrentSession(reply: FastifyReply, session: SessionPayload, user: NonNullable<Awaited<ReturnType<typeof findUserById>>>) {
    const token = signSession({ ...session, authStamp: createAuthStamp(user), exp: Date.now() + SESSION_TTL_MS });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
  }

  // First-run bootstrap: creates the very first superadmin (chicken-and-egg —
  // every other user-management route requires an existing superadmin token).
  // Self-disabling: once any user row exists, both routes permanently refuse,
  // so this is only ever a live unauthenticated endpoint on a brand-new install.
  app.get("/api/setup/status", async () => {
    const users = await listUsers();
    return { needsSetup: users.length === 0 };
  });

  app.post("/api/setup", async (req, reply) => {
    if (process.env.NODE_ENV === "production") {
      const supplied = Buffer.from(typeof req.headers["x-setup-secret"] === "string" ? req.headers["x-setup-secret"] : "");
      const expected = Buffer.from(process.env.SETUP_SECRET ?? "");
      const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
      if (!expected.length || !matches) {
        reply.code(403);
        return { error: "setup is installer-only in production" };
      }
    }
    const { email, password, host, departmentName } = (req.body && typeof req.body === "object" ? req.body : {}) as {
      email?: string;
      password?: string;
      host?: string;
      departmentName?: string;
    };
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      reply.code(400);
      return { error: "valid email required" };
    }
    const passwordError = validatePasswordInput(password);
    if (passwordError) {
      reply.code(400);
      return { error: passwordError };
    }
    if (host && !departmentName) {
      reply.code(400);
      return { error: "departmentName required when host is set" };
    }
    const userId = await createInitialSuperadmin(normalizedEmail, await hashPassword(password!));
    if (!userId) {
      reply.code(403);
      return { error: "Setup already completed" };
    }
    if (host) {
      await createTenant(host, departmentName!, null);
    }
    const user = await findUserById(userId);
    if (!user) {
      reply.code(500);
      return { error: "Initial account could not be loaded" };
    }
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId,
      email: normalizedEmail,
      role: "superadmin",
      tenantHost: null,
      permissions: [],
      csrfToken,
      authStamp: createAuthStamp(user),
      exp: Date.now() + SESSION_TTL_MS,
    });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return { csrfToken, role: "superadmin", tenantHost: null };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const { email, password } = (req.body && typeof req.body === "object" ? req.body : {}) as { email?: string; password?: string };
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 1024) {
      reply.code(400);
      return { error: "valid email and password required (maximum 1024 bytes)" };
    }
    // Checked BEFORE the password is even compared, so a locked-out caller
    // never gets a fresh timing oracle on top of the lockout itself.
    const normalizedEmail = email.trim().toLowerCase();
    if (await isLoginRateLimited(normalizedEmail, req.ip)) {
      reply.code(429);
      return { error: "Too many failed attempts — try again later" };
    }
    let user = await findUserByEmail(normalizedEmail);
    const valid = await verifyPasswordOrDummy(password, user?.passwordHash);
    await recordLoginAttempt(normalizedEmail, req.ip, valid);
    if (!user || !valid) {
      reply.code(401);
      return { error: "invalid credentials" };
    }
    // Entra-only mode: password login is for superadmin break-glass only (the
    // person who flipped this toggle must still be able to get back in if
    // Entra itself is misconfigured) — every other role must use Entra.
    const { entraOnly } = await getEntraSettings();
    if (!isPasswordLoginAllowed(user.role as "superadmin" | "webmaster", entraOnly)) {
      reply.code(403);
      return { error: "Password login is disabled — use Microsoft Entra ID to sign in" };
    }
    // Transparently upgrade password hashes created with the older scrypt
    // work factor after a successful authentication. This increments the
    // auth revision and reloads the user before creating the new session.
    if (!user.passwordHash.startsWith("scrypt$")) {
      await updateUserPassword(user.id, await hashPassword(password));
      user = await findUserById(user.id);
      if (!user) {
        reply.code(401);
        return { error: "account no longer exists" };
      }
    }
    const basePayload = {
      userId: user.id,
      email: user.email,
      role: user.role as "superadmin" | "webmaster",
      tenantHost: user.tenantHost,
      tenantHosts: (user.tenantHosts as string[] | null) ?? [],
      permissions: mergePermissions(
        await getRolePermissions(user.roleId as string | null),
        user.extraPermissions as string[] | null,
      ),
      authStamp: createAuthStamp(user),
    };
    // Superadmins always require MFA; other users follow the platform's
    // mandatory-MFA setting. An account without TOTP must enroll as part of
    // login itself instead of letting them dismiss the Security-tab prompt
    // indefinitely (which is exactly how an account can go a long time
    // "protected" on paper but not actually enrolled). Re-uses the same
    // pendingMfa flag/rejection as the challenge branch below — see
    // POST /api/auth/totp-setup-verify, its one exchange point.
    const mfaRequired = user.role === "superadmin" || process.env.NODE_ENV === "production" || await getMfaRequired();
    if (isMfaSetupRequired(user.totpEnabled, mfaRequired)) {
      const secret = generateTotpSecret();
      await setUserTotpSecret(user.id, secret);
      const pendingUser = await findUserById(user.id);
      if (!pendingUser) {
        reply.code(500);
        return { error: "Account could not be loaded" };
      }
      const pendingToken = signSession({ ...basePayload, authStamp: createAuthStamp(pendingUser), pendingMfa: true, exp: Date.now() + 5 * 60 * 1000 });
      return { mfaSetupRequired: true, pendingToken, secret, otpauthUri: totpAuthUri(secret, user.email) };
    }
    // Second factor required — issue a short-lived pending token instead of a
    // real session; POST /api/auth/totp-verify exchanges it once the code
    // checks out. pendingMfa tokens are rejected by every other route (see
    // plugins/auth.ts).
    if (user.totpEnabled) {
      const pendingToken = signSession({ ...basePayload, pendingMfa: true, exp: Date.now() + 5 * 60 * 1000 });
      return { mfaRequired: true, pendingToken };
    }
    const csrfToken = generateCsrfToken();
    const token = signSession({ ...basePayload, csrfToken, mfaVerified: true, exp: Date.now() + SESSION_TTL_MS });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return { csrfToken, role: user.role, tenantHost: user.tenantHost, tenantHosts: (user.tenantHosts as string[] | null) ?? [] };
  });

  // Public, unauthenticated — the login page needs to know which buttons to
  // show before anyone has signed in.
  app.get("/api/auth/login-methods", async () => {
    const { entraEnabled, entraOnly } = await getEntraSettings();
    return { mfaEnabled: process.env.NODE_ENV === "production" || await getMfaEnabled(), entraEnabled, entraOnly };
  });

  app.get("/api/auth/entra/login", async (req, reply) => {
    const { entraEnabled, entraTenantId, entraClientId } = await getEntraSettings();
    const redirectUri = process.env.ENTRA_REDIRECT_URI;
    if (!entraEnabled || !entraTenantId || !entraClientId || !redirectUri) {
      reply.code(404);
      return { error: "Entra ID login is not enabled" };
    }
    // Bound into both a short-lived cookie (this browser only) and the signed
    // state itself — see entra.ts's isEntraStateValid for why a bare signed
    // state isn't enough on its own (login-CSRF).
    const entraNonce = randomBytes(24).toString("base64url");
    setEntraStateCookie(reply, entraNonce);
    const state = signSession({
      userId: "",
      email: "",
      role: "webmaster",
      tenantHost: null,
      permissions: [],
      entraState: true,
      entraNonce,
      exp: Date.now() + 10 * 60 * 1000,
    });
    reply.redirect(getEntraAuthorizeUrl(entraTenantId, entraClientId, redirectUri, state, entraNonce));
  });

  app.get("/api/auth/entra/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const loginPageUrl = `${entraRedirectAdminOrigin}/login`;
    const statePayload = state ? verifySession(state) : null;
    const cookieNonce = getEntraStateCookie(req);
    clearEntraStateCookie(reply); // one-time use regardless of outcome
    if (!code || !isEntraStateValid(cookieNonce, statePayload)) {
      return reply.redirect(`${loginPageUrl}?entraError=invalid_state`);
    }
    const { entraEnabled, entraTenantId, entraClientId } = await getEntraSettings();
    const clientSecret = process.env.ENTRA_CLIENT_SECRET;
    const redirectUri = process.env.ENTRA_REDIRECT_URI;
    if (!entraEnabled || !entraTenantId || !entraClientId || !clientSecret || !redirectUri) {
      return reply.redirect(`${loginPageUrl}?entraError=not_configured`);
    }
    if (await isLoginRateLimited(`entra:${entraTenantId}`, req.ip)) {
      return reply.redirect(`${loginPageUrl}?entraError=rate_limited`);
    }
    let entraObjectId: string;
    try {
      const { idToken } = await exchangeEntraCode(entraTenantId, entraClientId, clientSecret, redirectUri, code);
      const claims = await verifyEntraIdToken(
        idToken,
        entraTenantId,
        entraClientId,
        statePayload!.entraNonce!,
        process.env.NODE_ENV === "production",
      );
      entraObjectId = claims.oid;
    } catch (err) {
      req.log.error({ err }, "entra callback failed");
      await recordLoginAttempt("entra:unknown", req.ip, false);
      return reply.redirect(`${loginPageUrl}?entraError=verification_failed`);
    }
    // Only an administrator-prebound immutable object ID authorizes this account.
    const user = await findUserByEntraObjectId(entraObjectId);
    await recordLoginAttempt(user?.email ?? "entra:unlinked", req.ip, !!user);
    if (!user) {
      return reply.redirect(`${loginPageUrl}?entraError=identity_not_linked`);
    }
    // Production accepts an Entra session only after signed amr=mfa evidence.
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: user.id,
      email: user.email,
      role: user.role as "superadmin" | "webmaster",
      tenantHost: user.tenantHost as string | null,
      tenantHosts: (user.tenantHosts as string[] | null) ?? [],
      permissions: mergePermissions(await getRolePermissions(user.roleId as string | null), user.extraPermissions as string[] | null),
      authStamp: createAuthStamp(user),
      mfaVerified: true,
      csrfToken,
      exp: Date.now() + SESSION_TTL_MS,
    });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    // Deliberately no session data (csrfToken/role/tenantHost) in this
    // redirect's query string — a URL is logged (server access logs) and
    // leaked (Referer header on whatever the SPA fetches next) far more
    // readily than a response body ever is. The httpOnly cookie just set
    // above is the real credential; the SPA calls GET /api/auth/session
    // (below) on landing to read the rest back out, authenticated by that
    // same cookie.
    return reply.redirect(`${entraRedirectAdminOrigin}/entra-callback`);
  });

  // Read-back for the Entra callback above: a real browser navigation can't
  // return a JSON body, so entra/callback sets the session cookie and redirects
  // bare — this is what the SPA calls on landing (cookie-authenticated) to get
  // the csrfToken/role/tenantHost it needs, without ever putting them in a URL.
  app.get("/api/auth/session", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    return {
      csrfToken: session.csrfToken,
      role: session.role,
      tenantHost: session.tenantHost ?? null,
      tenantHosts: session.tenantHosts ?? [],
    };
  });

  app.post("/api/auth/totp-verify", async (req, reply) => {
    const { pendingToken, code } = req.body as { pendingToken?: string; code?: string };
    if (!pendingToken || !code) {
      reply.code(400);
      return { error: "pendingToken and code required" };
    }
    const pending = verifySession(pendingToken);
    if (!pending || !pending.pendingMfa) {
      reply.code(401);
      return { error: "invalid or expired pending token" };
    }
    // A 6-digit code is only ~1M combinations — without a limit here, holding
    // a valid pendingToken (which already proves the password was correct)
    // would let an attacker brute-force the second factor away entirely.
    // Same table/keying as the password step (login route above).
    if (await isLoginRateLimited(pending.email, req.ip)) {
      reply.code(429);
      return { error: "Too many failed attempts — try again later" };
    }
    const user = await findUserById(pending.userId);
    if (!user || !matchesAuthStamp(pending.authStamp, user)) {
      reply.code(401);
      return { error: "credentials or MFA settings changed; sign in again" };
    }
    const valid = !!user?.totpEnabled && !!user.totpSecret && verifyTotpCode(user.totpSecret, code);
    await recordLoginAttempt(pending.email, req.ip, valid);
    if (!user?.totpEnabled || !user.totpSecret) {
      reply.code(401);
      return { error: "MFA is not enabled for this account" };
    }
    if (!valid) {
      reply.code(401);
      return { error: "invalid code" };
    }
    const tenantHosts = pending.tenantHosts ?? [];
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: pending.userId,
      email: pending.email,
      role: pending.role,
      tenantHost: pending.tenantHost,
      tenantHosts,
      permissions: pending.permissions,
      authStamp: createAuthStamp(user),
      csrfToken,
      mfaVerified: true,
      exp: Date.now() + SESSION_TTL_MS,
    });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return { csrfToken, role: pending.role, tenantHost: pending.tenantHost, tenantHosts };
  });

  // Exchanges the pendingToken from a forced-enrollment login (mfaSetupRequired
  // above) for a real session — same shape as totp-verify above, except a
  // correct code here also flips totpEnabled on (this call IS the enrollment,
  // not just a challenge against an already-enrolled account).
  app.post("/api/auth/totp-setup-verify", async (req, reply) => {
    const { pendingToken, code } = req.body as { pendingToken?: string; code?: string };
    if (!pendingToken || !code) {
      reply.code(400);
      return { error: "pendingToken and code required" };
    }
    const pending = verifySession(pendingToken);
    if (!pending || !pending.pendingMfa) {
      reply.code(401);
      return { error: "invalid or expired pending token" };
    }
    if (await isLoginRateLimited(pending.email, req.ip)) {
      reply.code(429);
      return { error: "Too many failed attempts — try again later" };
    }
    const user = await findUserById(pending.userId);
    if (!user || !matchesAuthStamp(pending.authStamp, user)) {
      reply.code(401);
      return { error: "credentials or MFA settings changed; sign in again" };
    }
    const valid = !!user?.totpSecret && verifyTotpCode(user.totpSecret, code);
    await recordLoginAttempt(pending.email, req.ip, valid);
    if (!user?.totpSecret) {
      reply.code(400);
      return { error: "call /api/auth/login first" };
    }
    if (!valid) {
      reply.code(401);
      return { error: "invalid code" };
    }
    await setUserTotpEnabled(pending.userId, true);
    await insertAuditLog({ actorUserId: pending.userId, actorEmail: pending.email, action: "mfa.enabled_self", ip: req.ip });
    const enrolledUser = await findUserById(pending.userId);
    if (!enrolledUser) {
      reply.code(401);
      return { error: "account no longer exists" };
    }
    const tenantHosts = pending.tenantHosts ?? [];
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: pending.userId,
      email: pending.email,
      role: pending.role,
      tenantHost: pending.tenantHost,
      tenantHosts,
      permissions: pending.permissions,
      authStamp: createAuthStamp(enrolledUser),
      csrfToken,
      mfaVerified: true,
      exp: Date.now() + SESSION_TTL_MS,
    });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return { csrfToken, role: pending.role, tenantHost: pending.tenantHost, tenantHosts };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { loggedOut: true };
  });

  // Personal MFA enrollment — any logged-in user, only reachable while the
  // instance-wide switch (platformSettings.mfaEnabled) is on. Two-step
  // (setup then confirm) so a secret is never trusted until the user has
  // proven they can actually generate a matching code with it.
  // Own-account status for the Security tab — whether TOTP is currently
  // enrolled and confirmed, not the instance-wide switch (see
  // GET /api/portal/login-settings for that, superadmin-only).
  app.get("/api/auth/me", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    const user = await findUserById(session.userId);
    return { totpEnabled: !!user?.totpEnabled };
  });

  app.post("/api/auth/totp-setup", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    if (!(await getMfaEnabled())) {
      reply.code(400);
      return { error: "MFA is not enabled for this instance" };
    }
    const user = await findUserById(session.userId);
    // Re-enrolling on an ALREADY-confirmed account must prove possession of
    // the current code first — otherwise a stolen bearer token alone (e.g.
    // via XSS, given the session's own localStorage exposure) would let an
    // attacker silently start overwriting a victim's real MFA secret before
    // it's ever confirmed, with no proof they still hold the original device.
    if (user?.totpEnabled) {
      const { code } = req.body as { code?: string };
      if (await isLoginRateLimited(session.email, req.ip)) {
        reply.code(429);
        return { error: "Too many failed attempts — try again later" };
      }
      const valid = !!user.totpSecret && !!code && verifyTotpCode(user.totpSecret, code);
      await recordLoginAttempt(session.email, req.ip, valid);
      if (!valid) {
        reply.code(401);
        return { error: "current MFA code required to re-enroll" };
      }
    }
    const secret = generateTotpSecret();
    await setUserTotpSecret(session.userId, secret);
    const updatedUser = await findUserById(session.userId);
    if (!updatedUser) {
      reply.code(401);
      return { error: "account no longer exists" };
    }
    reissueCurrentSession(reply, session, updatedUser);
    return { secret, otpauthUri: totpAuthUri(secret, session.email) };
  });

  app.post("/api/auth/totp-confirm", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    const { code } = req.body as { code?: string };
    const user = await findUserById(session.userId);
    if (!user?.totpSecret) {
      reply.code(400);
      return { error: "call /api/auth/totp-setup first" };
    }
    if (await isLoginRateLimited(session.email, req.ip)) {
      reply.code(429);
      return { error: "Too many failed attempts — try again later" };
    }
    const valid = !!code && verifyTotpCode(user.totpSecret, code);
    await recordLoginAttempt(session.email, req.ip, valid);
    if (!valid) {
      reply.code(401);
      return { error: "invalid code" };
    }
    await setUserTotpEnabled(session.userId, true);
    await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "mfa.enabled_self", ip: req.ip });
    const updatedUser = await findUserById(session.userId);
    if (!updatedUser) {
      reply.code(401);
      return { error: "account no longer exists" };
    }
    reissueCurrentSession(reply, session, updatedUser);
    return { enabled: true };
  });

  app.post("/api/auth/totp-disable", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    if (process.env.NODE_ENV === "production") {
      reply.code(403);
      return { error: "MFA cannot be disabled in production; contact your administrator for account recovery" };
    }
    const user = await findUserById(session.userId);
    if (!user?.totpEnabled) {
      return { disabled: true };
    }
    // Same reasoning as totp-setup's re-enroll guard: a stolen bearer token
    // alone must never be enough to strip a victim's MFA — the whole point of
    // a second factor is that possessing the token isn't sufficient by
    // itself, so removing it requires proving the second factor too.
    const { code } = req.body as { code?: string };
    if (await isLoginRateLimited(session.email, req.ip)) {
      reply.code(429);
      return { error: "Too many failed attempts — try again later" };
    }
    const valid = !!user.totpSecret && !!code && verifyTotpCode(user.totpSecret, code);
    await recordLoginAttempt(session.email, req.ip, valid);
    if (!valid) {
      reply.code(401);
      return { error: "current MFA code required to disable" };
    }
    await setUserTotpEnabled(session.userId, false);
    await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "mfa.disabled_self", ip: req.ip });
    const updatedUser = await findUserById(session.userId);
    if (!updatedUser) {
      reply.code(401);
      return { error: "account no longer exists" };
    }
    reissueCurrentSession(reply, session, updatedUser);
    return { disabled: true };
  });
}
