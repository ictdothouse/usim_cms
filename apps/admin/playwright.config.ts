import { defineConfig } from "@playwright/test";

// E2E_ADMIN_URL points at a real running admin dev server wired to the
// isolated e2e api (VITE_API_URL=http://localhost:3001, see apps/api/.env
// and e2e/seed.ts). 5180 is the port this worktree's dev server has been
// using — override via env if a different port is free on your machine.
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:5180";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: ADMIN_URL,
  },
  webServer: {
    command: "pnpm dev -- --port 5180",
    url: ADMIN_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
