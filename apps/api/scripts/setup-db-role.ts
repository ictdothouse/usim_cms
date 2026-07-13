import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

// Run once per database, connected as a superuser/admin (whatever
// DATABASE_URL is set to right now) — see setup-db-role.sql for why.
const sql = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "setup-db-role.sql"),
  "utf8",
);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(sql);
await client.end();

console.log("usim_cms_app role ready. Point DATABASE_URL at it (see .env.example) and restart the API.");
