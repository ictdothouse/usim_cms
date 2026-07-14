import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// ponytail: scoped to .ts/.tsx across apps/admin + apps/api, and plain .ts
// in apps/frontend (lib/api.ts) — .astro files skipped for now (needs
// eslint-plugin-astro + its own parser; add when the frontend grows enough
// component logic to be worth it).
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.astro/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/admin/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
