import { defineConfig } from "@playwright/test";

// E2E_ADMIN_URL points at a real running admin dev server wired to the
// isolated e2e api (VITE_API_URL=http://localhost:3001, see apps/api/.env
// and e2e/seed.ts). 5173 is plain `vite`'s own default port (apps/admin's
// "dev" script has no --port override) — set E2E_ADMIN_URL if a different
// port is already in use on your machine.
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: ADMIN_URL,
  },
  webServer: {
    command: "pnpm dev",
    url: ADMIN_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
