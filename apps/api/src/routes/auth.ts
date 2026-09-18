import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { verifyAnyUser } from "../plugins/auth.js";
import { mergePermissions } from "./permissions.js";
import {
  findUserByEmail,
  createUser,
  createTenant,
  listUsers,
  findUserById,
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
  verifyPassword,
  hashPassword,
  signSession,
  verifySession,
  SESSION_TTL_MS,
  generateTotpSecret,
  verifyTotpCode,
  totpAuthUri,
  generateCsrfToken,
  isMfaSetupRequired,
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

  // First-run bootstrap: creates the very first superadmin (chicken-and-egg —
  // every other user-management route requires an existing superadmin token).
  // Self-disabling: once any user row exists, both routes permanently refuse,
  // so this is only ever a live unauthenticated endpoint on a brand-new install.
  app.get("/api/setup/status", async () => {
    const users = await listUsers();
    return { needsSetup: users.length === 0 };
  });

  app.post("/api/setup", async (req, reply) => {
    const users = await listUsers();
    if (users.length > 0) {
      reply.code(403);
      return { error: "Setup already completed" };
    }
    const { email, password, host, departmentName } = req.body as {
      email?: string;
      password?: string;
      host?: string;
      departmentName?: string;
    };
    if (!email || !password) {
      reply.code(400);
      return { error: "email and password required" };
    }
    if (host && !departmentName) {
      reply.code(400);
      return { error: "departmentName required when host is set" };
    }
    await createUser(email, hashPassword(password), "superadmin", null, null);
    if (host) {
      await createTenant(host, departmentName!, null);
    }
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: (await findUserByEmail(email))!.id,
      email,
      role: "superadmin",
      tenantHost: null,
      permissions: [],
      csrfToken,
      exp: Date.now() + SESSION_TTL_MS,
    });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return { csrfToken, role: "superadmin", tenantHost: null };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      reply.code(400);
      return { error: "email and password required" };
    }
    // Checked BEFORE the password is even compared, so a locked-out caller
    // never gets a fresh timing oracle on top of the lockout itself.
    if (await isLoginRateLimited(email, req.ip)) {
      reply.code(429);
      return { error: "Too many failed attempts — try again later" };
    }
    const user = await findUserByEmail(email);
    const valid = !!user && verifyPassword(password, user.passwordHash);
    await recordLoginAttempt(email, req.ip, valid);
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
    };
    // Mandatory-MFA mode (platformSettings.mfaRequired, superadmin exempt) and
    // this account hasn't enrolled TOTP yet — force enrollment as part of
    // login itself instead of letting them dismiss the Security-tab prompt
    // indefinitely (which is exactly how an account can go a long time
    // "protected" on paper but not actually enrolled). Re-uses the same
    // pendingMfa flag/rejection as the challenge branch below — see
    // POST /api/auth/totp-setup-verify, its one exchange point.
    if (isMfaSetupRequired(user.role as "superadmin" | "webmaster", user.totpEnabled, await getMfaRequired())) {
      const secret = generateTotpSecret();
      await setUserTotpSecret(user.id, secret);
      const pendingToken = signSession({ ...basePayload, pendingMfa: true, exp: Date.now() + 5 * 60 * 1000 });
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
    const token = signSession({ ...basePayload, csrfToken, exp: Date.now() + SESSION_TTL_MS });
    setSessionCookie(reply, token, SESSION_TTL_MS / 1000);
    return { csrfToken, role: user.role, tenantHost: user.tenantHost, tenantHosts: (user.tenantHosts as string[] | null) ?? [] };
  });

  // Public, unauthenticated — the login page needs to know which buttons to
  // show before anyone has signed in.
  app.get("/api/auth/login-methods", async () => {
    const { entraEnabled, entraOnly } = await getEntraSettings();
    return { mfaEnabled: await getMfaEnabled(), entraEnabled, entraOnly };
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
    reply.redirect(getEntraAuthorizeUrl(entraTenantId, entraClientId, redirectUri, state));
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
    let email: string;
    try {
      const { idToken } = await exchangeEntraCode(entraTenantId, entraClientId, clientSecret, redirectUri, code);
      const claims = await verifyEntraIdToken(idToken, entraTenantId, entraClientId);
      email = claims.email.toLowerCase();
    } catch (err) {
      req.log.error({ err }, "entra callback failed");
      await recordLoginAttempt("entra:unknown", req.ip, false);
      return reply.redirect(`${loginPageUrl}?entraError=verification_failed`);
    }
    // No account is ever auto-created here — the users table (control-plane,
    // ~40 rows for USIM) IS the allowlist. Entra only proves "this email
    // really is who they say", never grants an account by itself; anyone else
    // in the org's Entra tenant hits this branch and is turned away.
    const user = await findUserByEmail(email);
    await recordLoginAttempt(email, req.ip, !!user);
    if (!user) {
      return reply.redirect(`${loginPageUrl}?entraError=account_not_found`);
    }
    // Entra login skips the app's own TOTP MFA gate deliberately — this is
    // already a real IdP authentication event, not a bare password.
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: user.id,
      email: user.email,
      role: user.role as "superadmin" | "webmaster",
      tenantHost: user.tenantHost as string | null,
      tenantHosts: (user.tenantHosts as string[] | null) ?? [],
      permissions: mergePermissions(await getRolePermissions(user.roleId as string | null), user.extraPermissions as string[] | null),
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
      csrfToken,
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
    const tenantHosts = pending.tenantHosts ?? [];
    const csrfToken = generateCsrfToken();
    const token = signSession({
      userId: pending.userId,
      email: pending.email,
      role: pending.role,
      tenantHost: pending.tenantHost,
      tenantHosts,
      permissions: pending.permissions,
      csrfToken,
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
      if (!user.totpSecret || !code || !verifyTotpCode(user.totpSecret, code)) {
        reply.code(401);
        return { error: "current MFA code required to re-enroll" };
      }
    }
    const secret = generateTotpSecret();
    await setUserTotpSecret(session.userId, secret);
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
    if (!code || !verifyTotpCode(user.totpSecret, code)) {
      reply.code(401);
      return { error: "invalid code" };
    }
    await setUserTotpEnabled(session.userId, true);
    await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "mfa.enabled_self", ip: req.ip });
    return { enabled: true };
  });

  app.post("/api/auth/totp-disable", async (req, reply) => {
    const session = verifyAnyUser(req, reply);
    if (!session) return;
    const user = await findUserById(session.userId);
    if (!user?.totpEnabled) {
      return { disabled: true };
    }
    // Same reasoning as totp-setup's re-enroll guard: a stolen bearer token
    // alone must never be enough to strip a victim's MFA — the whole point of
    // a second factor is that possessing the token isn't sufficient by
    // itself, so removing it requires proving the second factor too.
    const { code } = req.body as { code?: string };
    if (!user.totpSecret || !code || !verifyTotpCode(user.totpSecret, code)) {
      reply.code(401);
      return { error: "current MFA code required to disable" };
    }
    await setUserTotpEnabled(session.userId, false);
    await insertAuditLog({ actorUserId: session.userId, actorEmail: session.email, action: "mfa.disabled_self", ip: req.ip });
    return { disabled: true };
  });
}
