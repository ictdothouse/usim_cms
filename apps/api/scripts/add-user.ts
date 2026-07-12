import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { hashPassword } from "../src/db/auth.js";

const [email, password, role, tenantHost] = process.argv.slice(2);
if (!email || !password || !role || (role === "webmaster" && !tenantHost)) {
  console.error(
    "Usage: pnpm --filter @usim-cms/api user:add <email> <password> <superadmin|webmaster> [tenantHost]",
  );
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
  `INSERT INTO "public"."users" (email, password_hash, role, tenant_host) VALUES ($1, $2, $3, $4)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, tenant_host = EXCLUDED.tenant_host`,
  [email, hashPassword(password), role, tenantHost ?? null],
);
await client.end();

console.log(`User created: ${email} (${role}${tenantHost ? `, ${tenantHost}` : ""})`);
