import { request as pwRequest } from "@playwright/test";

// Points at a real running apps/api instance — see playwright.config.ts's
// own E2E_ADMIN_URL sibling. Not the same port apps/api's real dev
// convention (3000) defaults to, since a shared/already-running instance
// commonly occupies that port; override with E2E_API_URL if needed.
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";
const TENANT_HOST = "e2e.localhost";
const ADMIN_EMAIL = "e2e-admin@example.com";
const ADMIN_PASSWORD = "E2ePassw0rd!1";


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
export async function seedDesignerPage(): Promise<SeedResult> {
  const ctx = await pwRequest.newContext({ baseURL: API_URL });
  try {
    let cookieValue: string;
    let csrfToken: string;

    const setupRes = await ctx.post("/api/setup", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, host: TENANT_HOST, departmentName: "E2E Test" },
    });

    if (setupRes.ok()) {
      cookieValue = extractCookieValue(setupRes.headers()["set-cookie"]);
      csrfToken = ((await setupRes.json()) as { csrfToken: string }).csrfToken;
    } else {
      const loginRes = await ctx.post("/api/auth/login", {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      if (!loginRes.ok()) {
        throw new Error(`seedDesignerPage: login failed (${loginRes.status()}): ${await loginRes.text()}`);
      }
      cookieValue = extractCookieValue(loginRes.headers()["set-cookie"]);
      csrfToken = ((await loginRes.json()) as { csrfToken: string }).csrfToken;

      const tenantsRes = await ctx.get("/api/portal/tenants", {
        headers: { cookie: `ucms_session=${cookieValue}` },
      });
      const { tenants } = (await tenantsRes.json()) as { tenants: Array<{ host: string }> };
      if (!tenants.some((t) => t.host === TENANT_HOST)) {
        const createRes = await ctx.post("/api/portal/tenants", {
          headers: { cookie: `ucms_session=${cookieValue}`, "x-csrf-token": csrfToken },
          data: { host: TENANT_HOST, departmentName: "E2E Test" },
        });
        if (!createRes.ok()) {
          throw new Error(`seedDesignerPage: tenant create failed (${createRes.status()}): ${await createRes.text()}`);
        }
      }
    }

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
