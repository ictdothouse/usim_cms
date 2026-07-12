import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const [json] = process.argv.slice(2);
if (!json) {
  console.error(`Usage: pnpm --filter @usim-cms/api theme:set-global '{"primaryColor":"#0a5c36"}'`);
  process.exit(1);
}

let settings: unknown;
try {
  settings = JSON.parse(json);
} catch {
  console.error("Invalid JSON");
  process.exit(1);
}

const bootstrapSql = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/bootstrap-public.sql"),
  "utf8",
);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(bootstrapSql);
await client.query(
  `INSERT INTO "public"."site_theme" (tenant_host, settings) VALUES ('', $1)
   ON CONFLICT (tenant_host) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
  [JSON.stringify(settings)],
);
await client.end();

console.log("Global theme updated:", settings);
