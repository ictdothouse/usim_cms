import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const [host, ...nameParts] = process.argv.slice(2);
const departmentName = nameParts.join(" ");

if (!host || !departmentName) {
  console.error("Usage: pnpm --filter @ucms/api tenant:add <host> <department name>");
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
  `INSERT INTO "public"."tenants" (host, department_name) VALUES ($1, $2)
   ON CONFLICT (host) DO UPDATE SET department_name = EXCLUDED.department_name, active = true`,
  [host, departmentName],
);
await client.end();

console.log(`Registered tenant: ${host} (${departmentName})`);
