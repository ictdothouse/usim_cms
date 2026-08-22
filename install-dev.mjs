#!/usr/bin/env node
// One-shot LOCAL DEV installer — Mac, Windows, or Linux, same command:
//   node install-dev.mjs
//
// Docker-only (Docker Desktop or Docker Engine + compose plugin — this
// script never installs Docker for you, unlike install.sh's VPS path).
// Brings up db/api/frontend/admin the same way install.sh's docker mode
// does, minus everything that's exclusively a VPS concern: no public-IP
// detection (always localhost), no systemd/monitor/ufw/firewalld/proxy/cert
// work. See docs/superpowers/specs/2026-08-12-installer-hardening-design.md
// for why this is a separate script rather than install.sh growing a third
// mode.
//
// Flags (same shape as install.sh):
//   --admin-email=<email> --admin-password=<password>
//   --admin-only   Skip the install — just (re)run superadmin creation
//                  against an already-running stack.
//   --diagnose     Skip the install — just re-run the external-reachability
//                  check + diagnostic report against an already-running
//                  stack.

import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";

if (typeof fetch !== "function") {
  console.error("This needs Node 18 or newer (uses the global fetch API).");
  process.exit(1);
}

const REPO_DIR = dirname(fileURLToPath(import.meta.url));
process.chdir(REPO_DIR);

const flags = {
  adminOnly: false,
  diagnose: false,
  email: process.env.SUPERADMIN_EMAIL || "",
  password: process.env.SUPERADMIN_PASSWORD || "",
};
for (const arg of process.argv.slice(2)) {
  if (arg === "--admin-only") flags.adminOnly = true;
  else if (arg === "--diagnose") flags.diagnose = true;
  else if (arg.startsWith("--admin-email=")) flags.email = arg.slice("--admin-email=".length);
  else if (arg.startsWith("--admin-password=")) flags.password = arg.slice("--admin-password=".length);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}
async function findFreePort(start) {
  let port = start;
  while (!(await isPortFree(port))) port++;
  return port;
}

function readEnvFile(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}
function setEnvKv(file, key, value) {
  let content = readEnvFile(file);
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `${key}=${value}\n`;
  }
  writeFileSync(file, content);
}
function fillEnvIfBlank(file, key) {
  const content = readEnvFile(file);
  if (new RegExp(`^${key}=\\s*$`, "m").test(content)) {
    setEnvKv(file, key, randomBytes(24).toString("hex"));
    console.log(`Generated a random ${key} in ${file}.`);
  }
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Byte codes, not literal control characters, so this stays legible/diffable:
// an embedded Ctrl-C/backspace/EOF byte in source is invisible and looks
// identical to an empty string in an editor or diff.
const KEY_CR = 13;
const KEY_LF = 10;
const KEY_ETX = 3; // Ctrl-C
const KEY_BACKSPACE = 8;
const KEY_DEL = 127;

function promptPassword(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setRawMode(true);
    let input = "";
    const onData = (buf) => {
      const code = buf[0];
      if (code === KEY_CR || code === KEY_LF) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
      } else if (code === KEY_ETX) {
        process.exit(1);
      } else if (code === KEY_BACKSPACE || code === KEY_DEL) {
        input = input.slice(0, -1);
      } else {
        input += buf.toString("utf8");
      }
    };
    process.stdin.on("data", onData);
  });
}

async function ensureCredentials() {
  if (!flags.email && process.stdin.isTTY) {
    flags.email = await promptLine("Superadmin email: ");
  }
  if (!flags.password && process.stdin.isTTY) {
    flags.password = await promptPassword("Superadmin password: ");
  }
  if (!flags.email || !flags.password) {
    console.error("Superadmin email/password required — pass --admin-email=/--admin-password=,");
    console.error("set SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD env vars, or run this interactively.");
    process.exit(1);
  }
}

function checkDocker() {
  try {
    execFileSync("docker", ["--version"], { stdio: "ignore" });
  } catch {
    console.error("Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/");
    process.exit(1);
  }
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    console.error("Docker is installed but not running — start Docker Desktop first.");
    process.exit(1);
  }
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
  } catch {
    console.error("Docker is installed but the 'compose' plugin is missing.");
    process.exit(1);
  }
}

async function fetchStatusCode(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.status;
  } catch {
    return null;
  }
}
async function waitForApiHealth(port, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if ((await fetchStatusCode(`http://localhost:${port}/health`)) === 200) return true;
    await sleep(2000);
  }
  return false;
}
async function isReachable(url) {
  return (await fetchStatusCode(url)) !== null;
}

// The check this script exists to never skip: "the container started" is not
// the same claim as "a browser could actually load this" — see install.sh's
// own verify_external_reachability for the two real ways those diverged in
// production this same round of work.
async function verifyExternalReachability(apiPort, adminPort, frontendPort) {
  console.log("\nVerifying the stack is reachable (not just \"started\")...");
  let ok = true;
  if (await waitForApiHealth(apiPort)) {
    console.log(`  API (:${apiPort})      — reachable`);
  } else {
    console.error(`  API (:${apiPort})      — NOT reachable`);
    ok = false;
  }
  if (await isReachable(`http://localhost:${adminPort}/`)) {
    console.log(`  Admin (:${adminPort})    — reachable`);
  } else {
    console.error(`  Admin (:${adminPort})    — NOT reachable`);
    ok = false;
  }
  if (await isReachable(`http://localhost:${frontendPort}/`)) {
    console.log(`  Frontend (:${frontendPort}) — reachable`);
  } else {
    console.error(`  Frontend (:${frontendPort}) — NOT reachable`);
    ok = false;
  }
  return ok;
}

function printDiagnostics() {
  console.error("\n---- diagnostic report ----");
  try {
    console.error(
      execFileSync("docker", ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.trial.yml", "ps"], {
        cwd: REPO_DIR,
      }).toString(),
    );
  } catch (err) {
    console.error("Could not run docker compose ps:", err.message);
  }
  console.error("----------------------------");
}

async function ensureReachableOrReport(apiPort, adminPort, frontendPort) {
  if (await verifyExternalReachability(apiPort, adminPort, frontendPort)) return true;
  console.error("\nReachability check failed.");
  printDiagnostics();
  console.error("\nCheck Docker Desktop is fully started, then try: docker compose logs api");
  console.error("Re-run with --diagnose any time to repeat just this check without reinstalling.");
  return false;
}

async function createSuperadmin(apiPort, email, password) {
  console.log("\nCreating superadmin account...");
  let status;
  try {
    status = await (await fetch(`http://localhost:${apiPort}/api/setup/status`)).json();
  } catch {
    console.error(`Warning: could not reach /api/setup/status on port ${apiPort} — skipping.`);
    console.error("Re-run with --admin-only once the API is reachable to create it.");
    return;
  }
  if (!status.needsSetup) {
    console.log("Setup already completed — skipping (log in with the existing account).");
    return;
  }
  try {
    const res = await fetch(`http://localhost:${apiPort}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.token) {
      console.log(`Superadmin created: ${email}`);
    } else {
      console.error("Warning: superadmin creation failed — create one later from the admin's Setup Wizard.");
      console.error("  Response:", JSON.stringify(data));
    }
  } catch (err) {
    console.error("Warning: superadmin creation request failed:", err.message);
  }
}

function resolveRunningPorts() {
  const content = readEnvFile(join(REPO_DIR, ".env"));
  const get = (key) => {
    const m = content.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const apiPort = get("API_PORT");
  if (!apiPort) {
    console.error("Could not find an existing API_PORT in .env — is the stack installed?");
    console.error("Run `node install-dev.mjs` with no flags first.");
    process.exit(1);
  }
  return { apiPort, adminPort: get("ADMIN_PORT"), frontendPort: get("FRONTEND_PORT") };
}

async function install() {
  checkDocker();
  await ensureCredentials();

  const apiPort = await findFreePort(3000);
  const frontendPort = await findFreePort(4321);
  const adminPort = await findFreePort(5173);
  console.log("Ports chosen (auto-picked next free one if the default was taken):");
  console.log(`  api      -> ${apiPort}`);
  console.log(`  frontend -> ${frontendPort}`);
  console.log(`  admin    -> ${adminPort}`);

  const envFile = join(REPO_DIR, ".env");
  if (!existsSync(envFile)) {
    console.log("Creating .env from .env.example...");
    copyFileSync(join(REPO_DIR, ".env.example"), envFile);
  }
  fillEnvIfBlank(envFile, "POSTGRES_SUPERUSER_PASSWORD");
  fillEnvIfBlank(envFile, "SESSION_SECRET");
  setEnvKv(envFile, "VITE_API_URL", `http://localhost:${apiPort}`);
  setEnvKv(envFile, "VITE_FRONTEND_URL", `http://localhost:${frontendPort}`);
  // Without this, apps/api's CORS check rejects the admin panel's own
  // origin (or worse, silently keeps whatever ADMIN_ORIGIN a previous run —
  // or a stale .env from an unrelated earlier setup — happened to leave
  // behind, e.g. a Caddy-mode "http://admin.localhost"), and every request
  // fails client-side with a bare "Failed to fetch", no server-side error
  // to grep for. install.sh's docker-mode path already does this.
  setEnvKv(envFile, "ADMIN_ORIGIN", `http://localhost:${adminPort}`);
  setEnvKv(envFile, "API_PORT", String(apiPort));
  setEnvKv(envFile, "FRONTEND_PORT", String(frontendPort));
  setEnvKv(envFile, "ADMIN_PORT", String(adminPort));
  const overrideFile = join(REPO_DIR, "docker-compose.override.yml");
  if (existsSync(overrideFile)) rmSync(overrideFile);

  console.log("\nBuilding and starting containers (first run can take a few minutes)...");
  // api/frontend/admin no longer live in docker-compose.yml alone (moved to
  // docker-compose.release.yml for install.sh's blue-green flow) — this -f
  // pair is install.sh's own docker-mode trial overlay, mirrored here since
  // local dev has no go-live/blue-green step of its own. See that file's
  // header for why this is the right one to use pre-launch.
  execFileSync(
    "docker",
    ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.trial.yml", "up", "-d", "--build", "db", "api", "frontend", "admin"],
    { cwd: REPO_DIR, stdio: "inherit" },
  );

  if (!(await ensureReachableOrReport(apiPort, adminPort, frontendPort))) {
    console.error("\nAborting — the stack is up but not reachable, so it wouldn't work in a browser either.");
    process.exit(1);
  }

  await createSuperadmin(apiPort, flags.email, flags.password);

  console.log("\n================================================================");
  console.log(" Done.");
  console.log(`   Admin panel:  http://localhost:${adminPort}`);
  console.log(`   Public site:  http://localhost:${frontendPort}`);
  console.log(`   API:          http://localhost:${apiPort}`);
  console.log("");
  console.log(" First time here? Open the admin panel URL above.");
  console.log("================================================================");
}

async function main() {
  if (flags.diagnose) {
    const { apiPort, adminPort, frontendPort } = resolveRunningPorts();
    if (await verifyExternalReachability(apiPort, adminPort, frontendPort)) {
      console.log("\nEverything's reachable — no problem found.");
      process.exit(0);
    }
    printDiagnostics();
    process.exit(1);
  }

  if (flags.adminOnly) {
    await ensureCredentials();
    const { apiPort } = resolveRunningPorts();
    console.log("Waiting for the API to become healthy...");
    await waitForApiHealth(apiPort, 30);
    await createSuperadmin(apiPort, flags.email, flags.password);
    process.exit(0);
  }

  await install();
}

main();
