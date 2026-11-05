import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { request as pwRequest, type APIRequestContext } from "@playwright/test";

// Points at a real running apps/api instance — see playwright.config.ts's
// own E2E_ADMIN_URL sibling. Not the same port apps/api's real dev
// convention (3000) defaults to, since a shared/already-running instance
// commonly occupies that port; override with E2E_API_URL if needed.
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";
// createTenant() (apps/api's tenant-pool.ts) requires the host to have a REAL
// DNS record (dns.resolve(), not dns.lookup() — an /etc/hosts entry does NOT
// satisfy it) before it'll register — a security hardening added after this
// test was first written with a plain "e2e.localhost" (which has no real DNS
// record on any machine and always 400s). sslip.io is a public wildcard DNS
// service: any "<anything>.<ip-with-dashes>.sslip.io" name really does
// resolve to that IP via a real DNS query, so this passes the check for real
// while every actual HTTP call in this file still goes to plain localhost
// ports — the tenant host is only ever used as an opaque string identifier
// (the x-tenant-host header), never as a real network destination.
const TENANT_HOST = "e2e-127-0-0-1.sslip.io";
const ADMIN_EMAIL = "e2e-admin@example.com";
const ADMIN_PASSWORD = "E2ePassw0rd!1-smoke";


export interface SeedResult {
  pageId: string;
  tenantHost: string;
  // Raw ucms_session cookie value (no Path/HttpOnly/etc attributes) — the
  // spec injects this into the browser context via context.addCookies(),
  // since apps/api's real session lives in an httpOnly cookie, never a
  // bearer token the client can read (see CLAUDE.md's "Session cookie +
  // CSRF migration").
  cookieValue: string;
  // apps/admin's own Session.token field is this CSRF token, not a bearer
  // secret (see apps/admin/src/lib/api.ts) — the spec seeds
  // localStorage["usim_cms_session"] with it so the React app renders as
  // already logged in without going through the login form.
  csrfToken: string;
}

function extractCookieValue(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = header?.match(/ucms_session=([^;]+)/);
  if (!match) throw new Error("seedDesignerPage: no ucms_session cookie in the response");
  return decodeURIComponent(match[1]);
}

/**
 * Seeds a disposable tenant + superadmin user + one draft page directly
 * against apps/api, reusing the same POST /api/setup first-run route the
 * installer scripts use (apps/api/src/index.ts). Idempotent — safe to call
 * on every test run against the same api+db: the very first call creates
 * the superadmin and tenant together (POST /api/setup accepts an optional
 * host/departmentName, see its handler); every call after that hits
 * /api/setup's self-disabling 403 ("Setup already completed") and falls
 * back to logging in with the same fixed credentials, creating the tenant
 * only if it isn't already there.
 */
type SessionCreds = { cookieValue: string; csrfToken: string };

// A superadmin password login always demands TOTP (apps/api routes/auth.ts),
// so the secret handed out at enrollment is kept here for later runs that
// reuse the same database.
const TOTP_SECRET_FILE = path.join(os.tmpdir(), `ucms-e2e-totp-${new URL(API_URL).port || "80"}.txt`);

// RFC 6238, 6 digits / 30 s / SHA-1 — the parameters apps/api enrolls with.
function totpCode(secretBase32: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secretBase32.replace(/=+$/, "").toUpperCase()]
    .map((ch) => alphabet.indexOf(ch).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function exchangeTotp(ctx: APIRequestContext, route: string, pendingToken: string, secret: string): Promise<SessionCreds> {
  const res = await ctx.post(route, { data: { pendingToken, code: totpCode(secret) } });
  if (!res.ok()) throw new Error(`seedDesignerPage: ${route} failed (${res.status()}): ${await res.text()}`);
  return {
    cookieValue: extractCookieValue(res.headers()["set-cookie"]),
    csrfToken: ((await res.json()) as { csrfToken: string }).csrfToken,
  };
}

async function login(ctx: APIRequestContext): Promise<SessionCreds> {
  const res = await ctx.post("/api/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (!res.ok()) throw new Error(`seedDesignerPage: login failed (${res.status()}): ${await res.text()}`);
  const body = (await res.json()) as {
    csrfToken?: string;
    mfaSetupRequired?: boolean;
    mfaRequired?: boolean;
    pendingToken?: string;
    secret?: string;
  };
  if (body.mfaSetupRequired && body.pendingToken && body.secret) {
    writeFileSync(TOTP_SECRET_FILE, body.secret);
    return exchangeTotp(ctx, "/api/auth/totp-setup-verify", body.pendingToken, body.secret);
  }
  if (body.mfaRequired && body.pendingToken) {
    const secret = existsSync(TOTP_SECRET_FILE) ? readFileSync(TOTP_SECRET_FILE, "utf8").trim() : "";
    if (!secret) {
      throw new Error(`seedDesignerPage: the e2e superadmin has TOTP enrolled but ${TOTP_SECRET_FILE} is missing — reset the e2e database`);
    }
    return exchangeTotp(ctx, "/api/auth/totp-verify", body.pendingToken, secret);
  }
  return { cookieValue: extractCookieValue(res.headers()["set-cookie"]), csrfToken: body.csrfToken ?? "" };
}

async function establishSession(ctx: APIRequestContext): Promise<SessionCreds> {
  const setupRes = await ctx.post("/api/setup", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, host: TENANT_HOST, departmentName: "E2E Test" },
  });
  if (setupRes.ok()) {
    return {
      cookieValue: extractCookieValue(setupRes.headers()["set-cookie"]),
      csrfToken: ((await setupRes.json()) as { csrfToken: string }).csrfToken,
    };
  }

  const session = await login(ctx);
  const tenantsRes = await ctx.get("/api/portal/tenants", {
    headers: { cookie: `ucms_session=${session.cookieValue}` },
  });
  const { tenants } = (await tenantsRes.json()) as { tenants: Array<{ host: string }> };
  if (!tenants.some((t) => t.host === TENANT_HOST)) {
    const createRes = await ctx.post("/api/portal/tenants", {
      headers: { cookie: `ucms_session=${session.cookieValue}`, "x-csrf-token": session.csrfToken },
      data: { host: TENANT_HOST, departmentName: "E2E Test" },
    });
    if (!createRes.ok()) {
      throw new Error(`seedDesignerPage: tenant create failed (${createRes.status()}): ${await createRes.text()}`);
    }
  }
  return session;
}

// One session per worker, so a run logs in (and answers TOTP) at most once.
let sessionPromise: Promise<SessionCreds> | undefined;

export async function seedDesignerPage(): Promise<SeedResult> {
  const ctx = await pwRequest.newContext({ baseURL: API_URL });
  try {
    sessionPromise ??= establishSession(ctx).catch((error: unknown) => {
      sessionPromise = undefined;
      throw error;
    });
    const { cookieValue, csrfToken } = await sessionPromise;

    const pageRes = await ctx.post("/api/pages", {
      headers: {
        cookie: `ucms_session=${cookieValue}`,
        "x-csrf-token": csrfToken,
        "x-tenant-host": TENANT_HOST,
      },
      data: { slug: `e2e-designer-${Date.now()}`, title: "E2E Designer Smoke", layout: [] },
    });
    if (!pageRes.ok()) {
      throw new Error(`seedDesignerPage: page create failed (${pageRes.status()}): ${await pageRes.text()}`);
    }
    const { item } = (await pageRes.json()) as { item: { id: string } };

    return { pageId: item.id, tenantHost: TENANT_HOST, cookieValue, csrfToken };
  } finally {
    await ctx.dispose();
  }
}
