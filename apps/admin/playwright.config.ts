import { defineConfig } from "@playwright/test";

// E2E_ADMIN_URL points at a real running admin dev server wired to the
// isolated e2e api (VITE_API_URL=http://localhost:3001, see apps/api/.env
// and e2e/seed.ts). 5173 is plain `vite`'s own default port (apps/admin's
// "dev" script has no --port override) — set E2E_ADMIN_URL if a different
// port is already in use on your machine.
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:5173";
// Derived from ADMIN_URL rather than hardcoded — webServer.command below must
// bind the SAME port Playwright is told to wait on, or a custom E2E_ADMIN_URL
// (a different port from the default) would make it spawn `pnpm dev` on 5173
// while waiting on the configured port forever, timing out for no visible
// reason.
const ADMIN_PORT = new URL(ADMIN_URL).port || "5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: ADMIN_URL,
  },
  webServer: {
    command: `pnpm dev -- --port ${ADMIN_PORT}`,
    url: ADMIN_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
