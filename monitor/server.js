#!/usr/bin/env node
// Zero-dependency ops dashboard for the usim_cms stack — no npm install,
// just Node's own builtins, so installing it never touches whatever package
// versions any other project on this VPS depends on.
// Started by install.sh as a systemd unit; see monitor/ucms-monitor.service.template.
//
// Two backends, selected by $DEPLOY_MODE (set by install.sh):
//   "docker"  — actions run `docker compose <action> <service>` against the
//               db/api/frontend/admin services in docker-compose.yml.
//   "systemd" — actions run `systemctl <action> ucms-<service>` against
//               the bare-metal install's own units, and Postgres is only
//               ever restarted if $DB_MANAGED=true (this install's own
//               ensure_postgres actually installed it — if it instead
//               reused an already-running cluster, restarting it could take
//               down some other app on this VPS that also depends on it).
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFile, execFileSync, spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { setInterval, setTimeout } from "node:timers";
import { initializeUsers, authenticate, listUsers, changePassword, addUser, removeUser } from "./users.js";
import { getSecurityStatus } from "./security.js";
import { DASHBOARD_HTML } from "./dashboard-html.js";

const PORT = Number(process.env.MONITOR_PORT || 5555);
// The monitor runs as root and can operate the deployment. Bind it to a
// private host interface only; never expose Basic Auth over the public NIC.
// Docker installs set this to the bridge gateway so the API container can
// reach it through host.docker.internal. Bare-metal installs keep loopback.
const MONITOR_HOST = process.env.MONITOR_HOST || "127.0.0.1";
const REPO_DIR = process.env.REPO_DIR || process.cwd();
const MONITOR_USER = process.env.MONITOR_USER || "admin";
const MONITOR_PASSWORD = process.env.MONITOR_PASSWORD || "";
const MACHINE_PRINCIPAL = Symbol("monitor-api");
let monitorAccess = {
  mode: process.env.MONITOR_ACCESS_MODE || "ssh",
  domain: process.env.MONITOR_PUBLIC_DOMAIN || "",
};
try {
  monitorAccess = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "monitor/access/config.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    console.error("Invalid monitor/access/config.json:", error.message);
    process.exit(1);
  }
}
const MONITOR_ACCESS_MODE = monitorAccess.mode;
const MONITOR_PUBLIC_DOMAIN = typeof monitorAccess.domain === "string" ? monitorAccess.domain.toLowerCase() : "";
const validPublicDomain = MONITOR_PUBLIC_DOMAIN.length <= 253 && MONITOR_PUBLIC_DOMAIN.includes(".") &&
  !MONITOR_PUBLIC_DOMAIN.endsWith(".localhost") &&
  MONITOR_PUBLIC_DOMAIN.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const DEPLOY_LOG = path.join(REPO_DIR, ".deploy.log");
const DEPLOY_MODE = process.env.DEPLOY_MODE === "systemd" ? "systemd" : "docker";
const DB_MANAGED = process.env.DB_MANAGED !== "false";
// Only used in systemd mode's "pull latest & rebuild" — install.sh writes
// these into the same env file this process already reads MONITOR_* from.
const NODE_BIN = process.env.NODE_BIN || "node";
// Pinned, not "@latest" — an unpinned global install embedded in an
// automated script is itself a floating supply-chain dependency. Bump this
// deliberately (same as any other dependency upgrade) when corepack cuts a
// new release, rather than always trusting whatever npm resolves right now.
const COREPACK_PIN_VERSION = "0.36.0";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "localhost";
// Alerting is opt-in — unset means no-op, same convention as REDIS_URL/
// PGBOUNCER elsewhere in this project. ALERT_WEBHOOK_URL takes any plain
// HTTP(S) webhook that accepts a JSON POST (Slack/Discord/Teams incoming
// webhooks, or a custom endpoint) — no email/SMTP client here, this file's
// whole point is staying dependency-free (see the header comment).
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const ALERT_POLL_INTERVAL_MS = Number(process.env.ALERT_POLL_INTERVAL_MS) || 60_000;
// Lowered from 85 to 75 (2026-10-10, same disk-hygiene pass as the build-cache
// prune/logging caps) — on a small 40G disk, 85% only left ~6G of runway
// between "alert fires" and "actually out of space"; 75% buys more lead time
// to act. Still overridable per-install via the env var.
const ALERT_DISK_THRESHOLD_PCT = Number(process.env.ALERT_DISK_THRESHOLD_PCT) || 75;
// How often to `git fetch origin main` in the background looking for new commits (Dependabot
// bumps included, once merged) — separate from ALERT_POLL_INTERVAL_MS since a git fetch is a
// network call to GitHub and update freshness doesn't need 60s granularity. GET /api/update-check
// (the dashboard's own on-demand refresh) always fetches fresh regardless of this interval.
const UPDATE_CHECK_INTERVAL_MS = Number(process.env.UPDATE_CHECK_INTERVAL_MS) || 5 * 60_000;
// What "update available" follows: "main" (default) = every commit merged to main; "release"
// (an organisation's server) = the newest vX.Y.Z tag the publisher released. install.sh picks
// "release" when it ran from a release checkout.
const UPDATE_CHANNEL = process.env.UPDATE_CHANNEL === "release" ? "release" : "main";
// Same idea as UPDATE_CHECK_INTERVAL_MS but for upstream stack versions
// (Node/pnpm/Postgres/Redis/Caddy/PgBouncer, see getUpstreamLatest) — those
// move on their own release cadence, not this repo's commits, so they get
// their own interval rather than piggybacking on either of the above.
const VERSION_ALERT_INTERVAL_MS = Number(process.env.VERSION_ALERT_INTERVAL_MS) || 24 * 60 * 60_000;
// Per-tenant uploads live in the named `ucms-uploads` docker volume (docker mode) or a
// plain apps/api/uploads directory (bare-metal) — same resolution rule as
// apps/api/scripts/backup-media.sh's UPLOADS_DIR, reused here so an operator who already
// set one for backups doesn't need to work out a second value for the dashboard.
const UPLOADS_DIR_ENV = process.env.UPLOADS_DIR || "";

// Whitelisted so a service name never reaches child_process from raw user
// input — every route validates against this array before shelling out.
// "proxy" (Caddy) went missing on a live VPS with zero visibility here —
// nothing on the dashboard tracked it, so the outage was invisible until
// scripts/deploy.sh's promote step failed with DNS errors. Tracked the same
// generic way "db" already is (composeArgsFor falls back to base-compose for
// any name not in RELEASE_SERVICES).
const SERVICES =
  DEPLOY_MODE === "docker" ? ["db", "proxy", "api", "frontend", "admin"] : ["api", "frontend", "admin"];
const UNIT_MAP = { api: "ucms-api", frontend: "ucms-frontend", admin: "ucms-admin" };

// api/frontend/admin were split out of docker-compose.yml into
// docker-compose.release.yml so scripts/deploy.sh can blue-green deploy
// them (see CLAUDE.md's Deployment section) — they now run under whichever
// color (`ucms-blue`/`ucms-green`) that script last promoted, tracked in
// .deploy-color, never under this repo's own default compose project the
// way db/proxy still do. Every docker-mode compose call below needs the
// right -p/-f prefix depending on which file a service actually lives in.
const RELEASE_FILE = "docker-compose.release.yml";
const RELEASE_SERVICES = ["api", "frontend", "admin"];
const TRIAL_FILES = ["-f", "docker-compose.yml", "-f", "docker-compose.trial.yml"];
function currentColor() {
  try {
    return fs.readFileSync(path.join(REPO_DIR, ".deploy-color"), "utf8").trim() || "blue";
  } catch {
    return "blue";
  }
}

// A box can also still be in docker-compose.trial.yml's pre-launch shape
// (single api/frontend/admin containers under this repo's own default
// project, no Caddy in front — install-dev.mjs's local-dev stack always is,
// and a real VPS can be too, deliberately, right up until it goes live —
// see CLAUDE.md's Deployment section) rather than ever having gone through
// scripts/deploy.sh's blue-green flow at all. .deploy-color can't tell the
// two apart (it's written once by deploy.sh's first promote and never
// cleared, so a box rolled back to trial containers by hand still has a
// stale one) — checking the trial project's own running container instead
// reflects reality regardless of that history. Only matters for read/
// idempotent actions (status, logs, restart) — handlePull's own deploy-path
// choice does this same check itself, inline in the shell it spawns, since
// a check-then-act gap matters more there (see that function's comment).
function isTrialModeActive(cb) {
  execFile(
    "docker",
    ["compose", ...TRIAL_FILES, "ps", "-q", "api"],
    { cwd: REPO_DIR, timeout: 10_000 },
    // A failed Docker probe must never be interpreted as a verified
    // production blue/green deployment by the update preflight.
    (err, stdout) => cb(Boolean(err) || stdout.trim().length > 0),
  );
}

function composeArgsFor(name, cb) {
  if (!RELEASE_SERVICES.includes(name)) return cb([]);
  isTrialModeActive((trial) =>
    cb(trial ? TRIAL_FILES : ["-p", `ucms-${currentColor()}`, "-f", RELEASE_FILE]),
  );
}

if (!MONITOR_PASSWORD) {
  console.error("MONITOR_PASSWORD is not set — refusing to start with no auth.");
  process.exit(1);
}
if (!["ssh", "public", "cloud"].includes(MONITOR_ACCESS_MODE)) {
  console.error("MONITOR_ACCESS_MODE must be ssh, public or cloud.");
  process.exit(1);
}
if (MONITOR_ACCESS_MODE !== "ssh" &&
    (!validPublicDomain || Buffer.byteLength(MONITOR_PASSWORD) < 24)) {
  console.error("Public/cloud monitor requires a valid MONITOR_PUBLIC_DOMAIN and a password of at least 24 bytes.");
  process.exit(1);
}
try {
  initializeUsers(MONITOR_USER, MONITOR_PASSWORD);
} catch (error) {
  console.error("Monitor user store unavailable:", error.message);
  process.exit(1);
}

const DEPLOY_STATE_FILE = path.join(REPO_DIR, ".deploy-state.json");
let deployState = { running: false, exitCode: null, startedAt: null, finishedAt: null };
try {
  const previous = JSON.parse(fs.readFileSync(DEPLOY_STATE_FILE, "utf8"));
  deployState = previous;
} catch {
  // No prior deploy state on a fresh installation.
}
function saveDeployState() {
  fs.writeFileSync(DEPLOY_STATE_FILE, JSON.stringify(deployState), { mode: 0o600 });
}
function reconcileDeployState() {
  if (!deployState.running) return;
  const pid = deployState.pid;
  if (Number.isInteger(pid) && pid > 1) {
    try {
      process.kill(pid, 0);
      return;
    } catch (error) {
      if (error.code === "EPERM") return;
    }
  }
  // If a worker was replaced during a detached deployment, its exit callback
  // cannot report the result. Treat that outcome as unverified, never as a
  // successful release, and prevent a second deploy until the child ends.
  deployState = { ...deployState, running: false, exitCode: 1, finishedAt: new Date().toISOString(), uncertain: true };
  saveDeployState();
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length so a length mismatch doesn't
    // short-circuit obviously faster than a near-miss of the right length.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function checkAuth(req) {
  const header = req.headers.authorization || "";
  if (header.length > 2048 || !header.startsWith("Basic ")) return null;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return null;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  if (await authenticate(user, pass, header)) return user;
  // The API container still uses the existing env credential for SSL issuance.
  // It is accepted only on the internal Host for this one endpoint; a changed
  // human password therefore never breaks tenant certificate issuance.
  const internalHost = new URL(`http://${req.headers.host}`).hostname.toLowerCase();
  if (req.method === "POST" && req.url?.split("?")[0] === "/api/ssl/issue" &&
      ["host.docker.internal", "localhost", "127.0.0.1", "[::1]"].includes(internalHost) &&
      timingSafeEqualStr(user, MONITOR_USER) && timingSafeEqualStr(pass, MONITOR_PASSWORD)) {
    return MACHINE_PRINCIPAL;
  }
  return null;
}

const AUTH_FAILURE_LIMIT = 8;
const AUTH_WINDOW_MS = 10 * 60_000;
const AUTH_BLOCK_MS = 15 * 60_000;
const AUTH_MAX_CLIENTS = 4096;
const authFailures = new Map();
const sensitiveFailures = new Map();

function authClientKey(req) {
  // Caddy is the only public entry point. It appends the real client address
  // to X-Forwarded-For; the final address prevents one failed login from
  // locking out everyone behind Caddy's shared Docker source address.
  const hostname = new URL(`http://${req.headers.host}`).hostname.toLowerCase();
  if (hostname === MONITOR_PUBLIC_DOMAIN) {
    const forwarded = req.headers["x-forwarded-for"];
    const client = typeof forwarded === "string" ? forwarded.split(",").at(-1).trim() : "";
    if (net.isIP(client)) return client;
  }
  return req.socket.remoteAddress || "unknown";
}

function authBlockRemaining(key, now = Date.now(), failures = authFailures) {
  const state = failures.get(key);
  if (!state) return 0;
  if (state.blockedUntil > now) return state.blockedUntil - now;
  if (now - state.windowStartedAt >= AUTH_WINDOW_MS || state.blockedUntil) {
    failures.delete(key);
    return 0;
  }
  return 0;
}

function recordAuthFailure(key, now = Date.now(), failures = authFailures) {
  let state = failures.get(key);
  if (!state || now - state.windowStartedAt >= AUTH_WINDOW_MS) {
    state = { failures: 0, windowStartedAt: now, blockedUntil: 0 };
  }
  state.failures++;
  if (state.failures >= AUTH_FAILURE_LIMIT) state.blockedUntil = now + AUTH_BLOCK_MS;
  failures.delete(key);
  failures.set(key, state);
  if (failures.size > AUTH_MAX_CLIENTS) {
    const oldestKey = failures.keys().next().value;
    if (oldestKey !== undefined) failures.delete(oldestKey);
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  });
  res.end(data);
}

function readJsonBody(req, res, maxBytes, onValue) {
  let body = "";
  let bytes = 0;
  let tooLarge = false;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      tooLarge = true;
      body = "";
    } else if (!tooLarge) {
      body += chunk.toString("utf8");
    }
  });
  req.on("end", () => {
    if (tooLarge) return sendJson(res, 413, { error: "request body too large" });
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
    onValue(parsed);
  });
  req.on("error", () => {
    if (!res.headersSent) sendJson(res, 400, { error: "request body could not be read" });
  });
}

function handleUserMutation(req, res, operation, audit) {
  readJsonBody(req, res, 4096, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return sendJson(res, 400, { error: "invalid request body" });
    }
    Promise.resolve().then(() => operation(value)).then(() => {
      sensitiveFailures.delete(authClientKey(req));
      console.info(JSON.stringify({ event: "monitor_account_change", actor: audit.actor,
        action: audit.action, target: audit.target(value), ip: authClientKey(req) }));
      sendJson(res, 200, { ok: true });
    }).catch((error) => {
      if (error.message === "Current password is incorrect.") {
        recordAuthFailure(authClientKey(req), Date.now(), sensitiveFailures);
      }
      if (error.code) {
        console.error("Monitor user update failed:", error);
        sendJson(res, 500, { error: "User store could not be updated." });
      } else {
        sendJson(res, 400, { error: error.message });
      }
    });
  });
}

function isAllowedHost(header) {
  if (typeof header !== "string" || header.length > 255) return false;
  if (new RegExp("[/@?#\\\\\\s]").test(header)) return false;
  let hostname;
  try {
    const parsed = new URL(`http://${header}`);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" ||
    hostname === "host.docker.internal" ||
    (MONITOR_ACCESS_MODE !== "ssh" && hostname === MONITOR_PUBLIC_DOMAIN);
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  // Non-browser callers (the API container and SSH-local automation) do not
  // send Origin. Browsers always do for state-changing requests.
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    const publicHost = MONITOR_ACCESS_MODE !== "ssh" &&
      new URL(`http://${req.headers.host}`).hostname.toLowerCase() === MONITOR_PUBLIC_DOMAIN;
    const expected = new URL(`${publicHost ? "https" : "http"}://${req.headers.host}`).origin;
    return origin === parsed.origin && parsed.origin === expected;
  } catch {
    return false;
  }
}

function runCompose(args, cb) {
  execFile(
    "docker",
    ["compose", ...args],
    { cwd: REPO_DIR, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => cb(err, stdout, stderr),
  );
}

function parseComposePs(stdout) {
  // `docker compose ps --format json` emits one JSON object per line, not
  // a single array — has changed shape across Compose versions, so accept
  // both.
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1 && lines[0].startsWith("[")) return JSON.parse(lines[0]);
  return lines.map((l) => JSON.parse(l));
}

// db/proxy (docker-compose.yml, this repo's default project) and
// api/frontend/admin (docker-compose.release.yml, the currently-promoted
// color's project — see composeArgsFor) are two separate compose
// invocations now, merged into one list for the dashboard.
function getComposeStatus(cb) {
  runCompose(["ps", "--format", "json"], (baseErr, baseOut, baseErrText) => {
    composeArgsFor("api", (args) => {
      runCompose([...args, "ps", "--format", "json"], (relErr, relOut, relErrText) => {
        if (baseErr && relErr) return cb(baseErr, null);
        let services = [];
        try {
          if (!baseErr && baseOut.trim()) services = services.concat(parseComposePs(baseOut));
          if (!relErr && relOut.trim()) services = services.concat(parseComposePs(relOut));
        } catch {
          return cb(
            new Error(`could not parse compose ps output: ${baseErrText || relErrText || baseOut || relOut}`),
            null,
          );
        }
        cb(null, services);
      });
    });
  });
}

function getSystemdStatus(cb) {
  const results = [];
  let pending = SERVICES.length;
  if (pending === 0) return cb(null, results);
  for (const name of SERVICES) {
    execFile("systemctl", ["is-active", UNIT_MAP[name]], { timeout: 5_000 }, (err, stdout) => {
      results.push({ Service: name, State: (stdout || (err ? "inactive" : "unknown")).trim() });
      if (--pending === 0) cb(null, results);
    });
  }
}

function getStatus(cb) {
  if (DEPLOY_MODE === "docker") return getComposeStatus(cb);
  return getSystemdStatus(cb);
}

// Plain `docker ps`, no `-p`/`-f` project scoping — unlike getComposeStatus
// (which only ever asks about this repo's own base + currently-promoted
// blue/green project), this sees every container on the box regardless of
// which compose project (or none at all) started it. Added to hunt an
// orphaned pre-blue-green/trial container that could still be answering
// traffic and re-writing the frontend's Redis html-cache with stale output
// even after a normal deploy correctly rebuilds+promotes a fresh color.
function getAllContainers(cb) {
  if (DEPLOY_MODE !== "docker") return cb(null, []);
  execFile(
    "docker",
    ["ps", "-a", "--format", "json"],
    { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout) => {
      if (err) return cb(null, []);
      try {
        cb(null, parseComposePs(stdout));
      } catch {
        cb(null, []);
      }
    },
  );
}

function getGitInfo(cb) {
  execFile("git", ["log", "-1", "--format=%h %cI %s"], { cwd: REPO_DIR, timeout: 10_000 }, (err, stdout) => {
    cb(err ? null : stdout.trim());
  });
}

function getHostStats(cb) {
  execFile(
    "sh",
    ["-c", "uptime -p; echo ===SPLIT===; df -h / | tail -1; echo ===SPLIT===; free -m | sed -n '2p'"],
    { timeout: 10_000 },
    (err, stdout) => {
      if (err) return cb(null);
      const raw = stdout.trim();
      const [uptime, diskLine, memLine] = raw.split("===SPLIT===").map((s) => (s || "").trim());
      let disk = null;
      let mem = null;
      const dparts = (diskLine || "").split(/\s+/); // dev size used avail use% mount
      if (dparts.length >= 6) {
        disk = {
          total: dparts[1],
          used: dparts[2],
          avail: dparts[3],
          pct: parseInt(dparts[4], 10) || 0,
          mount: dparts[5],
        };
      }
      const mparts = (memLine || "").split(/\s+/); // Mem: total used free shared buff/cache available
      if (mparts.length >= 3) {
        const total = Number(mparts[1]);
        const used = Number(mparts[2]);
        mem = { totalMB: total, usedMB: used, pct: total ? Math.round((used / total) * 100) : 0 };
      }
      cb({ raw, uptime, disk, mem });
    },
  );
}

// Docker: the live api container's own /app/uploads mount — follows a
// storage move (scripts/uploads-volume.sh gives a custom UPLOADS_PATH/
// UPLOADS_NFS location its own volume) with no config here; the default
// volume when no api container runs. Bare-metal: apps/api/.env's UPLOADS_DIR
// (install.sh's media-storage prompt), read as a plain value, never sourced.
function resolveUploadsDir(cb) {
  if (UPLOADS_DIR_ENV) return cb(UPLOADS_DIR_ENV);
  if (DEPLOY_MODE !== "docker") {
    let configured = "";
    try {
      const m = fs.readFileSync(path.join(REPO_DIR, "apps/api/.env"), "utf8").match(/^UPLOADS_DIR=(.+)$/m);
      configured = m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    } catch {
      // no apps/api/.env — default location below
    }
    return cb(configured.startsWith("/") ? configured : path.join(REPO_DIR, "apps/api/uploads"));
  }
  execFile(
    "docker",
    ["ps", "--filter", "label=com.docker.compose.service=api", "--format", "{{.Names}}"],
    { timeout: 10_000 },
    (err, stdout) => {
      const container = err ? "" : stdout.trim().split("\n")[0];
      const args = container
        ? ["inspect", "--format", '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Source}}{{end}}{{end}}', container]
        : ["volume", "inspect", "ucms-uploads", "--format", "{{ .Mountpoint }}"];
      execFile("docker", args, { timeout: 10_000 }, (err2, out) => cb(err2 ? null : out.trim() || null));
    },
  );
}

// Per-tenant folder sizes (apps/api/src/index.ts's tenantFolder() slug, not the raw
// hostname — this process has no DB access to translate it back, same trust boundary
// as backup-media.sh). One `du` per top-level folder rather than a recursive Node walk —
// `du` is already what getHostStats' `df` sibling call relies on being present.
function getSitesUsage(cb) {
  resolveUploadsDir((dir) => {
    if (!dir) return cb([]);
    execFile(
      "sh",
      ["-c", `du -sb "${dir}"/*/ 2>/dev/null || true`],
      { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return cb([]);
        const sites = (stdout || "")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [bytesStr, p] = line.split("\t");
            return { folder: path.basename((p || "").replace(/\/$/, "")), bytes: Number(bytesStr) || 0 };
          })
          .sort((a, b) => b.bytes - a.bytes);
        cb(sites);
      },
    );
  });
}

// Parses `docker system df`'s own table by column position (derived from the
// header line itself, not a fixed offset) rather than splitting on
// whitespace — "Local Volumes"/"Build Cache" are multi-word TYPE values, so a
// naive split would misalign every column after it. Stable since Docker
// 1.13; this is the exact command run by hand to diagnose the 2026-10-10
// disk-full incident (see .claude/skills/deployment/SKILL.md's disk-hygiene
// note) — this just surfaces the same numbers on the dashboard instead of
// needing SSH + `docker system df` every time disk pressure comes up.
function parseDockerSystemDf(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0];
  const cols = ["TYPE", "TOTAL", "ACTIVE", "SIZE", "RECLAIMABLE"];
  const starts = cols.map((c) => header.indexOf(c));
  if (starts.some((i) => i < 0)) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const vals = starts.map((start, idx) => line.slice(start, idx + 1 < starts.length ? starts[idx + 1] : line.length).trim());
    rows.push({ type: vals[0], total: vals[1], active: vals[2], size: vals[3], reclaimable: vals[4] });
  }
  return rows;
}

function getDockerDiskUsage(cb) {
  if (DEPLOY_MODE !== "docker") return cb([]);
  execFile("docker", ["system", "df"], { timeout: 15_000 }, (err, stdout) => {
    if (err) return cb([]);
    cb(parseDockerSystemDf(stdout));
  });
}

// The verbose per-image/per-volume/per-cache-entry breakdown — same command
// used over SSH to find the actual 2026-10-10 culprits (stale build cache +
// leftover images from a prior non-usim_cms setup on that box). Returned
// as-is rather than parsed: it's read-only diagnostic text for a human to
// scan, not data the dashboard needs to act on.
function getDockerDiskUsageVerbose(cb) {
  if (DEPLOY_MODE !== "docker") return cb(null);
  execFile("docker", ["system", "df", "-v"], { timeout: 20_000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
    cb(err ? null : stdout);
  });
}

// Per-database size (control-plane `usim_cms` plus every tenant's own
// `tenant_<host>` database — see apps/api/CLAUDE.md's multi-tenancy section:
// each tenant is a real separate database on this same Postgres instance, not
// a schema). The disk-usage panel above only ever shows OS/Docker-level
// noise (images, logs, build cache); this answers a different question —
// "is one tenant's actual DATA growing" — which `docker system df` can't see
// at all, since to Docker the whole Postgres data directory is just one
// opaque volume. `-U postgres` with no password needed: a `docker compose
// exec` connection goes over the container's local unix socket, which this
// image's default pg_hba.conf trusts regardless of POSTGRES_HOST_AUTH_METHOD
// (that only governs TCP "host" entries — see docker-compose.yml's own
// comment on the `db` service). Bare-metal (DEPLOY_MODE=systemd) has no
// equivalent credential wired into this process yet, so it's docker-only for
// now, same scope line the disk-usage panel above already draws.
function getDbSizes(cb) {
  if (DEPLOY_MODE !== "docker") return cb([]);
  execFile(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-t",
      "-A",
      "-c",
      "SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate ORDER BY pg_database_size(datname) DESC;",
    ],
    { cwd: REPO_DIR, timeout: 15_000 },
    (err, stdout) => {
      if (err) return cb([]);
      const rows = [];
      for (const line of String(stdout || "").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [name, bytes] = line.split("|");
        if (!name || bytes === undefined) continue;
        rows.push({ name, bytes: Number(bytes) || 0 });
      }
      cb(rows);
    },
  );
}

// Posts a plain JSON body to an operator-configured webhook. `content` is
// included alongside `text` so a Discord webhook (which reads `content`)
// and a Slack/Teams-style one (which reads `text`) both work unconfigured.
function postJson(urlStr, obj, cb) {
  let target;
  try {
    target = new URL(urlStr);
  } catch {
    return cb(new Error("invalid webhook URL"));
  }
  const lib = target.protocol === "https:" ? https : http;
  const data = Buffer.from(JSON.stringify(obj));
  const req = lib.request(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: target.pathname + target.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": data.length },
      timeout: 10_000,
    },
    (res) => {
      res.resume();
      cb(null, res.statusCode);
    },
  );
  req.on("error", cb);
  req.on("timeout", () => req.destroy(new Error("webhook request timed out")));
  req.write(data);
  req.end();
}

function sendAlert(text) {
  if (!ALERT_WEBHOOK_URL) return;
  postJson(ALERT_WEBHOOK_URL, { text, content: text }, (err) => {
    if (err) console.error("alert webhook failed:", err.message);
  });
}

// Edge-triggered against getStatus()'s own up/down test (same regex the
// dashboard already renders with, see the `up` const further below) —
// `lastKnownUp[name] === undefined` on the very first poll means "just
// observed, nothing to compare against yet," so a fresh process start never
// fires a false "recovered" alert.
let lastKnownUp = {};
let lastDiskOver = false;
let lastAlertedRemoteSha = null;
// Tracks whether a self-heal restart has already been fired for the current
// outage of each service — cleared the moment it's next seen up. One
// attempt per outage, not a retry loop, so a genuinely broken config (bad
// Caddyfile edit, crashed migration) doesn't get restarted forever; same
// one-shot philosophy as install.sh's own ensure_reachable_or_selfheal.
let selfHealAttempted = {};

// docker compose ps reports an unhealthy container's State as "running
// (unhealthy)" — which the naive /healthy/i regex below would also match,
// since "unhealthy" contains "healthy" as a substring. Checked first so a
// container that's alive-but-failing its healthcheck (e.g. proxy's Caddy
// admin-API probe, see docker-compose.yml) is correctly reported down
// instead of silently passing as up.
function isServiceUp(state) {
  return !/unhealthy/i.test(state || "") && /running|healthy|active/i.test(state || "");
}

// docker-mode only: composeArgsFor already resolves the right compose
// file/project per service (base docker-compose.yml vs the currently
// promoted blue/green color) — restart:unless-stopped can't help here
// because it only fires once a container actually exits, never for one
// that's still running but wedged (see docker-compose.yml's proxy
// healthcheck comment for why that gap mattered specifically for Caddy).
function selfHealRestart(name) {
  composeArgsFor(name, (args) => {
    runCompose([...args, "restart", name], (err) => {
      sendAlert(
        err
          ? `[usim_cms/${PUBLIC_HOST}] self-heal restart of ${name} FAILED: ${String(err.message || err)}`
          : `[usim_cms/${PUBLIC_HOST}] self-healed ${name} (was down/unhealthy) via automatic restart`,
      );
    });
  });
}

// Fetches the update target (origin/main, or the newest release tag on the release channel)
// and reports how far HEAD is behind it — the only signal needed to answer "is there something
// to update": anything merged to main (a green-CI'd Dependabot bump included, see
// .github/dependabot.yml), or a newly pushed vX.Y.Z tag, shows up here the moment it lands, no
// GitHub token/API call needed. null means the fetch itself failed (offline, GitHub down, etc)
// — callers treat that as "unknown", never as "0 updates".
function getRemoteUpdateInfo(cb) {
  const release = UPDATE_CHANNEL === "release";
  // No --force: a published release tag never moves, so one moved on the remote fails this
  // fetch ("Update check unavailable") instead of being followed. --prune-tags drops a release
  // the publisher withdrew.
  const fetchArgs = release
    ? ["fetch", "origin", "--tags", "--prune", "--prune-tags", "--quiet"]
    : ["fetch", "origin", "main", "--quiet"];
  execFile("git", fetchArgs, { cwd: REPO_DIR, timeout: 20_000 }, (fetchErr) => {
    if (fetchErr) return cb(null);
    resolveUpdateTarget(release, (target) => {
      if (!target) return cb(null);
      execFile(
        "git",
        ["log", "--oneline", `HEAD..${target.ref}`, "-20"],
        { cwd: REPO_DIR, timeout: 10_000 },
        (logErr, stdout) => {
          if (logErr) return cb(null);
          const commits = stdout.trim() ? stdout.trim().split("\n") : [];
          execFile("git", ["rev-parse", `${target.ref}^{commit}`], { cwd: REPO_DIR, timeout: 5_000 }, (shaErr, shaOut) => {
            cb({ commitsBehind: commits.length, commits, remoteSha: shaErr ? null : shaOut.trim(), target: target.label });
          });
        },
      );
    });
  });
}

// The release channel follows the newest plain vX.Y.Z tag (a pre-release like v1.3.0-rc1 is
// never offered to an organisation's server); with none released yet, HEAD itself (= up to date).
function resolveUpdateTarget(release, cb) {
  if (!release) return cb({ ref: "origin/main", label: "origin/main" });
  execFile("git", ["tag", "--list", "v*", "--sort=-v:refname"], { cwd: REPO_DIR, timeout: 5_000 }, (err, out) => {
    if (err) return cb(null);
    const tag = out.split("\n").find((t) => /^v\d+\.\d+\.\d+$/.test(t));
    cb(tag ? { ref: `refs/tags/${tag}`, label: tag } : { ref: "HEAD", label: "no release yet" });
  });
}

function handleUpdateCheck(req, res) {
  getRemoteUpdateInfo((info) => {
    if (!info) return sendJson(res, 502, { error: "git fetch failed — check network/GitHub reachability" });
    sendJson(res, 200, info);
  });
}

// Reads the pinned versions straight out of the same config files that actually set them
// (docker-compose.yml's image: tags, apps/api/Dockerfile's base image, each app's own
// package.json) rather than exec-ing into containers — what's pinned here is exactly what's
// running, since compose pulls that tag verbatim. Static file reads only, so this is cheap
// enough to call on every dashboard load.
function getStackVersions(cb) {
  const readJson = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const root = readJson(path.join(REPO_DIR, "package.json"));
  const apiPkg = readJson(path.join(REPO_DIR, "apps/api/package.json"));
  const adminPkg = readJson(path.join(REPO_DIR, "apps/admin/package.json"));
  const frontendPkg = readJson(path.join(REPO_DIR, "apps/frontend/package.json"));
  let dockerImage = null;
  try {
    const dockerfile = fs.readFileSync(path.join(REPO_DIR, "apps/api/Dockerfile"), "utf8");
    dockerImage = (dockerfile.match(/^FROM\s+(\S+)/m) || [])[1] || null;
  } catch {
    // Dockerfile version is optional in bare-metal mode.
  }
  const infra = {};
  if (DEPLOY_MODE === "docker") {
    try {
      const compose = fs.readFileSync(path.join(REPO_DIR, "docker-compose.yml"), "utf8");
      for (const m of compose.matchAll(/^\s*image:\s*(\S+)/gm)) {
        const img = m[1];
        if (/^postgres:/.test(img)) infra.db = img;
        else if (/^redis:/.test(img)) infra.redis = img;
        else if (/pgbouncer/.test(img)) infra.pgbouncer = img;
        else if (/^caddy:/.test(img)) infra.proxy = img;
      }
    } catch {
      // Shared service versions are optional when Compose is unavailable.
    }
  }
  cb({
    appVersion: root ? root.version : null,
    pnpm: root && root.packageManager ? root.packageManager.replace(/^pnpm@/, "") : null,
    node: { runtime: process.version, dockerImage },
    packages: {
      api: apiPkg ? apiPkg.version : null,
      admin: adminPkg ? adminPkg.version : null,
      frontend: frontendPkg ? frontendPkg.version : null,
    },
    infra,
  });
}

function handleVersions(req, res) {
  getStackVersions((v) => sendJson(res, 200, v));
}

// Checks installed versions against upstream for the pieces that actually HAVE an upstream to
// compare to — app packages (api/admin/frontend) are this repo's own semver, already covered by
// the git-commits-behind check in the Update tab, not re-checked here. Split out of
// getStackVersions/handleVersions on purpose: those stay a fast local-file read (dashboard loads
// every time); this one leaves the box (Docker Hub/npm/nodejs.org), so it's its own endpoint,
// cached, and the frontend fetches it after the static cards are already on screen.
const UPSTREAM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let upstreamCache = { data: null, fetchedAt: 0 };

function httpsGetJson(urlStr, cb) {
  let target;
  try {
    target = new URL(urlStr);
  } catch {
    return cb(new Error("invalid URL"));
  }
  const req = https.request(
    {
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: "GET",
      headers: { "User-Agent": "usim-cms-monitor", Accept: "application/json" },
      timeout: 8_000,
    },
    (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          cb(null, JSON.parse(body));
        } catch (e) {
          cb(e);
        }
      });
    },
  );
  req.on("error", cb);
  req.on("timeout", () => req.destroy(new Error("request timed out")));
  req.end();
}

function parseVer(str) {
  const m = String(str || "").match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// floatingMajor: true means the compose/Dockerfile only pins a major (e.g. "16-alpine") and
// always gets the newest patch/minor in that major on the next pull — so "behind" only ever
// means a newer MAJOR exists, never a missed patch (there's no separate patch pin to miss).
function verdict(currentStr, latestStr, floatingMajor) {
  const cur = parseVer(currentStr);
  const lat = parseVer(latestStr);
  if (!cur || !lat) return { status: "unknown", note: "couldn't reach upstream to check" };
  if (floatingMajor) {
    if (cur[0] >= lat[0]) return { status: "latest", note: "newest major — patches apply automatically on next pull" };
    return {
      status: lat[0] - cur[0] >= 2 ? "outdated" : "behind",
      note: `v${lat[0]} available upstream — bumping the major tag isn't automatic, review release notes first`,
    };
  }
  const diff = cmpVer(lat, cur);
  if (diff <= 0) return { status: "latest", note: "up to date" };
  if (lat[0] > cur[0]) return { status: "behind", note: `${latestStr} available — review breaking changes before upgrading` };
  return { status: "behind", note: `${latestStr} available — routine patch/minor bump, low risk` };
}

function maxTagMajor(tags) {
  let best = null;
  for (const t of tags) {
    const m = String(t).match(/^(\d+)$/);
    if (m && (best === null || Number(m[1]) > best)) best = Number(m[1]);
  }
  return best;
}

function maxPgbouncerTag(tags) {
  let best = null;
  let bestParsed = null;
  for (const t of tags) {
    // Percona publishes both 1.26.0 and 1.26.0-1; the latter is a newer
    // immutable image rebuild. Ignore per-architecture tags and moving tags.
    const m = String(t).match(/^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const parsed = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0)];
    const firstDifference = bestParsed && parsed.map((part, i) => part - bestParsed[i]).find((delta) => delta !== 0);
    if (!bestParsed || firstDifference > 0) {
      bestParsed = parsed;
      best = t;
    }
  }
  return best;
}

function dockerHubTags(repo, cb) {
  httpsGetJson(`https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100`, (err, json) => {
    if (err || !json || !Array.isArray(json.results)) return cb(null);
    cb(json.results.map((r) => r.name));
  });
}

function getUpstreamLatest(cb) {
  if (upstreamCache.data && Date.now() - upstreamCache.fetchedAt < UPSTREAM_CACHE_TTL_MS) {
    return cb(upstreamCache.data);
  }
  const result = {};
  let pending = 6;
  const done = () => {
    if (--pending > 0) return;
    upstreamCache = { data: result, fetchedAt: Date.now() };
    cb(result);
  };
  httpsGetJson("https://nodejs.org/dist/index.json", (err, releases) => {
    if (!err && Array.isArray(releases)) {
      const ltsMajors = releases.filter((r) => r.lts).map((r) => Number(String(r.version).replace(/^v/, "").split(".")[0]));
      result.node = ltsMajors.length ? String(Math.max(...ltsMajors)) : null;
    }
    done();
  });
  httpsGetJson("https://registry.npmjs.org/pnpm/latest", (err, json) => {
    result.pnpm = !err && json ? json.version : null;
    done();
  });
  dockerHubTags("library/postgres", (tags) => {
    result.postgres = tags ? maxTagMajor(tags) : null;
    done();
  });
  dockerHubTags("library/redis", (tags) => {
    result.redis = tags ? maxTagMajor(tags) : null;
    done();
  });
  dockerHubTags("library/caddy", (tags) => {
    result.caddy = tags ? maxTagMajor(tags) : null;
    done();
  });
  dockerHubTags("percona/percona-pgbouncer", (tags) => {
    result.pgbouncer = tags ? maxPgbouncerTag(tags) : null;
    done();
  });
}

// Shared by the dashboard's GET /api/version-checks (handleVersionChecks)
// and the background alert poll (maybeAlertOnVersionChecks) — one place
// computing "current vs upstream" so both read the exact same verdicts.
function computeVersionChecks(cb) {
  getStackVersions((v) => {
    getUpstreamLatest((latest) => {
      const checks = {};
      if (v.node.dockerImage) {
        const cur = (v.node.dockerImage.match(/^node:(\d+)/) || [])[1];
        checks.node = { current: cur, latest: latest.node, ...verdict(cur, latest.node, true) };
      }
      if (v.pnpm) checks.pnpm = { current: v.pnpm, latest: latest.pnpm, ...verdict(v.pnpm, latest.pnpm, false) };
      if (v.infra.db) {
        const cur = (v.infra.db.match(/^postgres:(\d+)/) || [])[1];
        checks.postgres = { current: cur, latest: latest.postgres ? String(latest.postgres) : null, ...verdict(cur, latest.postgres, true) };
      }
      if (v.infra.redis) {
        const cur = (v.infra.redis.match(/^redis:(\d+)/) || [])[1];
        checks.redis = { current: cur, latest: latest.redis ? String(latest.redis) : null, ...verdict(cur, latest.redis, true) };
      }
      if (v.infra.proxy) {
        const cur = (v.infra.proxy.match(/^caddy:(\d+)/) || [])[1];
        checks.caddy = { current: cur, latest: latest.caddy ? String(latest.caddy) : null, ...verdict(cur, latest.caddy, true) };
      }
      if (v.infra.pgbouncer) {
        const cur = (v.infra.pgbouncer.match(/^percona\/percona-pgbouncer:(\S+)/) || [])[1];
        const check = verdict(cur, latest.pgbouncer, false);
        if (check.status === "latest" && cur && latest.pgbouncer && cur !== latest.pgbouncer && maxPgbouncerTag([cur, latest.pgbouncer]) === latest.pgbouncer) {
          check.status = "behind";
          check.note = `${latest.pgbouncer} image rebuild available`;
        }
        checks.pgbouncer = { current: cur, latest: latest.pgbouncer, ...check };
      }
      cb(checks);
    });
  });
}

function handleVersionChecks(req, res) {
  computeVersionChecks((checks) => sendJson(res, 200, { checks }));
}

let lastVersionAlertCheck = 0;
const lastAlertedStackVersion = {};

// Edge-triggered per component per version, same one-notice-per-change shape
// as the service up/down and disk-threshold alerts below: fires once when a
// new upstream version first shows up as "behind"/"outdated", never again
// for that SAME version, so a daily check doesn't repeat the same notice
// forever. Gated to run at most once every VERSION_ALERT_INTERVAL_MS
// regardless of pollForAlerts' own tick rate (ALERT_POLL_INTERVAL_MS,
// default 60s) — nodejs.org/npm/Docker Hub don't need checking that often.
// Deliberately read-only/informational: this never triggers an update by
// itself, just tells the operator there's something worth reviewing in the
// Stack & Versions tab (Test button there now actually boot-tests the
// candidate image in isolation — see stagingBootTest — before anyone decides
// to click Update).
function maybeAlertOnVersionChecks() {
  if (Date.now() - lastVersionAlertCheck < VERSION_ALERT_INTERVAL_MS) return;
  lastVersionAlertCheck = Date.now();
  computeVersionChecks((checks) => {
    for (const [key, c] of Object.entries(checks)) {
      if (!c || !c.latest || c.status === "latest" || c.status === "unknown") continue;
      if (lastAlertedStackVersion[key] === c.latest) continue;
      lastAlertedStackVersion[key] = c.latest;
      sendAlert(
        `[usim_cms/${PUBLIC_HOST}] ${key} update available: ${c.current || "?"} -> ${c.latest} — ${c.note}. ` +
          `Review + staging-test in the Stack & Versions tab before updating.`,
      );
    }
  });
}

// The actual safe-update machinery (test gate in each Dockerfile build, health-checked
// blue-green promote, smoke test, one-click rollback — see scripts/deploy.sh /
// CLAUDE.md's "Blue-green zero-downtime deploys") already exists and runs unconditionally
// on every "Pull latest & deploy" click. What's missing is telling the operator BEFORE they
// click whether this particular update is a routine zero-downtime flip or something that
// needs a closer look — reusing the same signals getRemoteUpdateInfo/isTrialModeActive/
// getHostStats/deployState already compute elsewhere in this file.
function getPreflightCheck(cb) {
  reconcileDeployState();
  getRemoteUpdateInfo((updateInfo) => {
    if (!updateInfo) return cb({ error: "git fetch failed — check network/GitHub reachability" });
    if (!/^[0-9a-f]{40}$/.test(updateInfo.remoteSha || "")) return cb({ error: `Could not verify the ${updateInfo.target} revision.` });
    execFile(
      "git",
      ["diff", "--name-only", "HEAD", updateInfo.remoteSha],
      { cwd: REPO_DIR, timeout: 10_000 },
      (diffErr, diffOut) => {
        if (diffErr) return cb({ error: "Could not inspect incoming changes." });
        const files = diffOut.trim().split("\n").filter(Boolean);
        // A base-tier change can interrupt the live color while deploy.sh
        // recreates db/proxy/pgbouncer/redis. A new migration file is fine (every
        // migration in this repo is additive, IF NOT EXISTS/idempotent — see CLAUDE.md), it's
        // just worth calling out explicitly rather than silently applying on first request.
        const baseTierChanged = files.some((f) => /^(docker-compose\.ya?ml|Caddyfile|pgbouncer\/)/.test(f));
        const deployControlChanged = files.some((f) =>
          ["scripts/deploy.sh", "monitor/supervisor.js", "monitor/ucms-monitor.service.template"].includes(f));
        const migrationAdded = files.some((f) => /^apps\/api\/src\/db\/migrations\//.test(f));
        isTrialModeActive((trial) => {
          getHostStats((host) => {
            const diskPct = host && host.disk ? host.disk.pct : null;
            const reasons = [];
            let verdict = "safe";
            const raise = (level) => {
              if (verdict === "blocked") return;
              if (level === "blocked" || verdict !== "caution") verdict = level;
            };
            if (deployState.running) {
              raise("blocked");
              reasons.push("A deploy is already running — wait for it to finish before starting another.");
            }
            try {
              execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", updateInfo.remoteSha],
                { cwd: REPO_DIR, timeout: 5000 });
            } catch {
              raise("blocked");
              reasons.push(`Local checkout diverged from ${updateInfo.target}; review it before updating.`);
            }
            try {
              execFileSync("git", ["diff", "--quiet"], { cwd: REPO_DIR, timeout: 5000 });
              execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: REPO_DIR, timeout: 5000 });
            } catch {
              raise("blocked");
              reasons.push("Local tracked changes would be overwritten by the update.");
            }
            if (deployState.uncertain) {
              raise("blocked");
              reasons.push("A previous deploy lost its worker before reporting a result. Verify the live color and deployment log on the VPS before another update.");
            }
            const noZeroDowntime = DEPLOY_MODE !== "docker" || trial;
            if (noZeroDowntime) {
              raise("blocked");
              reasons.push(
                DEPLOY_MODE === "docker"
                  ? "Trial mode cannot meet zero downtime. Promote a blue/green release before updating."
                  : "Systemd mode cannot meet zero downtime for the app tier. Use Docker blue/green deployment.",
              );
            }
            if (baseTierChanged) {
              raise("blocked");
              reasons.push(
                "Changes shared database, proxy, or pooler configuration. Review and apply that change separately; this update requires uninterrupted service.",
              );
            }
            if (deployControlChanged) {
              raise("blocked");
              reasons.push("Deployment or monitor supervisor control code changed. Review and install that change separately before one-click updates resume.");
            }
            if (migrationAdded) {
              reasons.push(
                "Includes a new DB migration — applied automatically on the next tenant request after deploy (every migration here is additive/idempotent, safe to run unattended).",
              );
            }
            if (diskPct !== null && diskPct >= 85) {
              raise("blocked");
              reasons.push(`Disk is at ${diskPct}% used — a fresh image build may not have enough room.`);
            }
            if (diskPct === null) {
              raise("blocked");
              reasons.push("Disk capacity could not be verified.");
            }
            if (DEPLOY_MODE === "docker") {
              try {
                const color = fs.readFileSync(path.join(REPO_DIR, ".deploy-color"), "utf8").trim();
                if (!["blue", "green"].includes(color)) throw new Error("invalid color");
                for (const service of ["api", "frontend", "admin"]) {
                  const cid = execFileSync("docker", ["compose", "-p", `ucms-${color}`, "-f", RELEASE_FILE, "ps", "-q", service],
                    { cwd: REPO_DIR, encoding: "utf8", timeout: 5000 }).trim().split("\n")[0];
                  if (!cid) throw new Error(`${service} is missing`);
                  const health = execFileSync("docker", ["inspect", "-f", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Running}}{{end}}", cid],
                    { encoding: "utf8", timeout: 5000 }).trim();
                  if (health !== "healthy" && !(service === "admin" && health === "true")) {
                    throw new Error(`${service} is ${health || "unavailable"}`);
                  }
                }
                const proxyCid = execFileSync("docker", ["compose", "ps", "-q", "proxy"],
                  { cwd: REPO_DIR, encoding: "utf8", timeout: 5000 }).trim().split("\n")[0];
                if (!proxyCid) throw new Error("Caddy proxy is missing");
                const proxyRunning = execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", proxyCid],
                  { encoding: "utf8", timeout: 5000 }).trim();
                if (proxyRunning !== "true") throw new Error("Caddy proxy is stopped");
              } catch (error) {
                raise("blocked");
                reasons.push(`Live blue/green release could not be verified: ${error.message}`);
              }
              try {
                const envText = fs.readFileSync(path.join(REPO_DIR, ".env"), "utf8");
                if (!/^SMOKE_TEST_HOST=\S+/m.test(envText)) {
                  raise("blocked");
                  reasons.push("SMOKE_TEST_HOST is required to check a real tenant page before promotion.");
                }
              } catch {
                raise("blocked");
                reasons.push("Could not read the deployment configuration for the real-page smoke test.");
              }
            }
            if (DEPLOY_MODE === "docker") {
              try {
                const unit = execFileSync("systemctl", ["show", "ucms-monitor", "-p", "ExecStart", "-p", "ExecReload"],
                  { encoding: "utf8", timeout: 5000 });
                const mainPid = execFileSync("systemctl", ["show", "ucms-monitor", "-p", "MainPID", "--value"],
                  { encoding: "utf8", timeout: 5000 }).trim();
                const runningCommand = /^[1-9][0-9]*$/.test(mainPid) ? fs.readFileSync(`/proc/${mainPid}/cmdline`, "utf8") : "";
                if (!unit.includes("monitor/supervisor.js") || !unit.includes("USR2") || !runningCommand.includes("monitor/supervisor.js")) {
                  raise("blocked");
                  reasons.push("Monitor rolling reload is not installed. Run scripts/monitor-enable-rolling.sh once before updating.");
                }
              } catch {
                raise("blocked");
                reasons.push("Could not verify the monitor rolling service; update is blocked.");
              }
            }
            if (verdict === "safe") {
              reasons.push(
                "Routine update — zero-downtime blue-green deploy (new color is built, test-gated, health-checked, and smoke-tested before traffic switches; the old color stays up for instant rollback).",
              );
            }
            if (updateInfo.commitsBehind === 0) reasons.unshift("Already on the latest commit; this action would redeploy the current revision.");
            cb({
              commitsBehind: updateInfo.commitsBehind,
              commits: updateInfo.commits,
              remoteSha: updateInfo.remoteSha,
              target: updateInfo.target,
              verdict,
              reasons,
              trial,
              diskPct,
            });
          });
        });
      },
    );
  });
}

function handlePreflight(req, res) {
  getPreflightCheck((result) => {
    if (result.error) return sendJson(res, 502, result);
    sendJson(res, 200, result);
  });
}

async function handleSecurity(req, res, force) {
  try {
    sendJson(res, 200, await getSecurityStatus(REPO_DIR, NODE_BIN, force));
  } catch (error) {
    sendJson(res, 503, { error: `Security status unavailable: ${error.message}` });
  }
}

// Edge-triggered on remoteSha the same way service up/down and disk-threshold alerts are above —
// fires once when a new update target first appears (origin/main's HEAD, or a new release tag),
// not on every single poll while it's still there unpulled. Piggybacks the existing ALERT_WEBHOOK_URL wiring (sendAlert no-ops when
// unset), so this needs no new secret/config beyond what alerting already asks for.
function pollForUpdateAlert() {
  getRemoteUpdateInfo((info) => {
    if (!info || info.commitsBehind === 0) return;
    if (info.remoteSha === lastAlertedRemoteSha) return;
    lastAlertedRemoteSha = info.remoteSha;
    sendAlert(
      `[usim_cms/${PUBLIC_HOST}] ${info.commitsBehind} update(s) available on ${info.target}:\n` +
        info.commits.slice(0, 5).join("\n"),
    );
  });
}
function pollForAlerts() {
  maybeAlertOnVersionChecks();
  getStatus((err, services) => {
    if (err) return; // transient poll failure — not itself alert-worthy
    for (const name of SERVICES) {
      const s = (services || []).find((x) => (x.Service || x.Name) === name);
      const up = !!s && isServiceUp(s.State || s.Health || "");
      const prev = lastKnownUp[name];
      if (prev !== undefined && prev !== up) {
        sendAlert(`[usim_cms/${PUBLIC_HOST}] ${name} is ${up ? "back UP" : "DOWN"}`);
      }
      lastKnownUp[name] = up;

      if (DEPLOY_MODE === "docker") {
        if (!up && !selfHealAttempted[name]) {
          selfHealAttempted[name] = true;
          selfHealRestart(name);
        } else if (up) {
          selfHealAttempted[name] = false;
        }
      }
    }
  });
  // Edge-triggered the same way as the service up/down checks above — fires once on
  // crossing ALERT_DISK_THRESHOLD_PCT, once again when it drops back below, not on
  // every single poll while it stays over.
  getHostStats((host) => {
    if (!host || !host.disk) return;
    const over = host.disk.pct >= ALERT_DISK_THRESHOLD_PCT;
    if (over !== lastDiskOver) {
      sendAlert(
        `[usim_cms/${PUBLIC_HOST}] disk usage ${over ? `crossed ${ALERT_DISK_THRESHOLD_PCT}%` : `back under ${ALERT_DISK_THRESHOLD_PCT}%`} (now ${host.disk.pct}%, ${host.disk.used}/${host.disk.total})`,
      );
    }
    lastDiskOver = over;
  });
}

function handleAlertTest(req, res) {
  if (!ALERT_WEBHOOK_URL) return sendJson(res, 400, { error: "ALERT_WEBHOOK_URL is not set" });
  postJson(
    ALERT_WEBHOOK_URL,
    { text: `[usim_cms/${PUBLIC_HOST}] test alert`, content: `[usim_cms/${PUBLIC_HOST}] test alert` },
    (err, status) => {
      if (err) return sendJson(res, 500, { error: err.message });
      sendJson(res, 200, { ok: true, status });
    },
  );
}

function handleConfig(req, res) {
  sendJson(res, 200, {
    mode: DEPLOY_MODE,
    services: SERVICES,
    dbManaged: DEPLOY_MODE === "docker" ? true : DB_MANAGED,
    alertWebhookConfigured: Boolean(ALERT_WEBHOOK_URL),
  });
}

function handleSites(req, res) {
  getSitesUsage((sites) => sendJson(res, 200, { sites }));
}

function handleDiskUsage(req, res) {
  getDockerDiskUsage((rows) => sendJson(res, 200, { rows }));
}

function handleDiskUsageVerbose(req, res) {
  getDockerDiskUsageVerbose((text) => {
    if (text == null) return sendJson(res, 502, { error: "docker system df -v failed (docker mode only)" });
    sendJson(res, 200, { text });
  });
}

function handleDbSizes(req, res) {
  getDbSizes((rows) => sendJson(res, 200, { rows }));
}

function handleStatus(req, res) {
  getStatus((err, services) => {
    if (err) return sendJson(res, 500, { error: String(err.message || err) });
    // git/host/containers are three independent shell-outs — run them
    // concurrently rather than nested, so this endpoint's total latency is
    // the slowest ONE of them (max ~15s, getAllContainers' own timeout)
    // instead of all three added up in sequence.
    let pending = 3;
    let git = null;
    let host = null;
    let containers = [];
    const done = () => {
      if (--pending === 0) sendJson(res, 200, { services, git, host, deploy: deployState, containers });
    };
    getGitInfo((g) => {
      git = g;
      done();
    });
    getHostStats((h) => {
      host = h;
      done();
    });
    getAllContainers((_err2, c) => {
      containers = c;
      done();
    });
  });
}

function handleServiceAction(req, res, name, action) {
  if (!SERVICES.includes(name)) return sendJson(res, 400, { error: "unknown service" });
  if (!["start", "stop", "restart"].includes(action)) return sendJson(res, 400, { error: "unknown action" });
  if (DEPLOY_MODE === "docker") {
    return composeArgsFor(name, (args) => {
      runCompose([...args, action, name], (err, stdout, stderr) => {
        if (err) return sendJson(res, 500, { error: String(err.message || err), stderr });
        sendJson(res, 200, { ok: true, stdout, stderr });
      });
    });
  }
  execFile("systemctl", [action, UNIT_MAP[name]], { timeout: 30_000 }, (err, stdout, stderr) => {
    if (err) return sendJson(res, 500, { error: String(err.message || err), stderr });
    sendJson(res, 200, { ok: true, stdout, stderr });
  });
}

function handleLogs(req, res, name, tail) {
  if (!SERVICES.includes(name)) return sendJson(res, 400, { error: "unknown service" });
  const n = String(Math.min(Math.max(Number(tail) || 200, 1), 2000));
  const respond = (err, stdout, stderr) => {
    if (err && !stdout) return sendJson(res, 500, { error: String(err.message || err), stderr });
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(stdout || stderr || "(no output)");
  };
  if (DEPLOY_MODE === "docker") {
    return composeArgsFor(name, (args) => {
      execFile(
        "docker",
        ["compose", ...args, "logs", "--no-color", "--tail", n, name],
        { cwd: REPO_DIR, timeout: 20_000, maxBuffer: 10 * 1024 * 1024 },
        respond,
      );
    });
  }
  execFile(
    "journalctl",
    ["-u", UNIT_MAP[name], "-n", n, "--no-pager"],
    { timeout: 20_000, maxBuffer: 10 * 1024 * 1024 },
    respond,
  );
}

function handleDbStatus(req, res) {
  if (DEPLOY_MODE === "docker") {
    return execFile(
      "docker",
      ["compose", "exec", "-T", "db", "pg_isready", "-U", "postgres"],
      { cwd: REPO_DIR, timeout: 10_000 },
      (err, stdout, stderr) => sendJson(res, 200, { ok: !err, output: (stdout || stderr || "").trim() }),
    );
  }
  execFile("pg_isready", ["-h", "127.0.0.1", "-p", "5432"], { timeout: 10_000 }, (err, stdout, stderr) => {
    sendJson(res, 200, { ok: !err, output: (stdout || stderr || "").trim(), managed: DB_MANAGED });
  });
}

function handleDbRestart(req, res) {
  if (DEPLOY_MODE === "docker") return handleServiceAction(req, res, "db", "restart");
  if (!DB_MANAGED) {
    return sendJson(res, 409, {
      error:
        "This install reused an already-running PostgreSQL cluster instead of installing its own — restarting it here could affect other apps on this VPS, so it's not offered.",
    });
  }
  execFile("systemctl", ["restart", "postgresql"], { timeout: 30_000 }, (err, stdout, stderr) => {
    if (err) return sendJson(res, 500, { error: String(err.message || err), stderr });
    sendJson(res, 200, { ok: true, stdout, stderr });
  });
}

// git pull + rebuild + redeploy takes a while — run detached, log to a
// file, and let the dashboard poll /api/pull/status + /api/pull/log instead
// of holding the HTTP request open.
function handlePull(req, res) {
  reconcileDeployState();
  if (deployState.running) return sendJson(res, 409, { error: "a deploy is already running" });
  if (deployState.uncertain) return sendJson(res, 409, { error: "Previous deploy outcome is unverified; inspect the VPS before another update." });
  getPreflightCheck((pre) => {
    if (pre.error) return sendJson(res, 502, { error: pre.error });
    if (pre.verdict !== "safe" || !/^[0-9a-f]{40}$/.test(pre.remoteSha || "")) {
      return sendJson(res, 409, { error: `Update blocked: ${pre.reasons.join(" ")}` });
    }
    if (deployState.running) return sendJson(res, 409, { error: "a deploy is already running" });
    deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
    saveDeployState();
    const logFd = fs.openSync(DEPLOY_LOG, "a");
    fs.writeSync(logFd, `\n\n=== deploy started ${deployState.startedAt} ===\n`);
    const script = `
      set -e
      NODE_DIR="$(dirname "${NODE_BIN}")"
      export PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
      if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "Tracked local changes exist; refusing to overwrite them." >&2
        exit 1
      fi
      old_head="$(git rev-parse HEAD)"
      git merge-base --is-ancestor "$old_head" "${pre.remoteSha}" || {
        echo "The update target diverged from this checkout; refusing a destructive reset." >&2
        exit 1
      }
      trap 'result=$?; if [ "$result" -ne 0 ]; then git reset --hard "$old_head"; fi' EXIT
      echo "--- checking out approved revision ${pre.remoteSha} ---"
      git reset --hard "${pre.remoteSha}"
      echo "--- blue-green deploy: dependency audit, build tests, readiness and real-page smoke test before promotion ---"
      bash scripts/deploy.sh
      trap - EXIT
      echo "--- app release promoted; monitor worker will roll after deploy state is saved ---"
    `;
    const child = spawn("sh", ["-c", script], { cwd: REPO_DIR, stdio: ["ignore", logFd, logFd], detached: true });
    deployState.pid = child.pid;
    saveDeployState();
    child.unref();
    child.on("exit", (code) => {
      deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
      saveDeployState();
      fs.appendFileSync(DEPLOY_LOG, `=== deploy finished, exit ${code} ===\n`);
      fs.closeSync(logFd);
      if (code === 0) {
        execFile("systemctl", ["reload", "ucms-monitor"], { timeout: 10_000 }, (error) => {
          if (error) fs.appendFileSync(DEPLOY_LOG, `WARNING: monitor rolling reload failed: ${error.message}\n`);
        });
      }
    });
    sendJson(res, 202, { ok: true, started: true });
  });
}

// Flips back to whichever color scripts/deploy.sh last left stopped-but-not-
// removed (see that script's own comment) — no rebuild, just a health-check
// + Caddy promote. Blue-green only exists in docker mode (systemd/bare-metal
// has no color concept at all) and only once a box has actually gone live
// (trial mode's single containers aren't blue-green either) — both refused
// with a clear message rather than shelling out to something meaningless.
function handleRollback(req, res) {
  if (DEPLOY_MODE !== "docker") {
    return sendJson(res, 501, {
      error: "rollback needs blue-green (docker mode), this box runs systemd mode",
    });
  }
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/rollback is already running" });
  isTrialModeActive((trial) => {
    if (trial) {
      return sendJson(res, 400, {
        error: "still in trial mode (no blue-green deploy has run yet) — nothing to roll back to",
      });
    }
    deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
    saveDeployState();
    const logFd = fs.openSync(DEPLOY_LOG, "a");
    fs.writeSync(logFd, `\n\n=== rollback started ${deployState.startedAt} ===\n`);
    const child = spawn("bash", ["scripts/deploy.sh", "rollback"], {
      cwd: REPO_DIR,
      stdio: ["ignore", logFd, logFd],
      detached: true,
    });
    deployState.pid = child.pid;
    saveDeployState();
    child.unref();
    child.on("exit", (code) => {
      deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
      saveDeployState();
      fs.appendFileSync(DEPLOY_LOG, `=== rollback finished, exit ${code} ===\n`);
      fs.closeSync(logFd);
    });
    sendJson(res, 202, { ok: true, started: true });
  });
}

// Shared db/proxy/pooler/cache are single instances. Updating them from this
// console would violate the zero-downtime update policy.
function handleApplyBaseTier(req, res) {
  sendJson(res, 409, { error: "Shared database, proxy, pooler and cache updates require redundant infrastructure or a maintenance window." });
}

function handlePullStatus(req, res) {
  reconcileDeployState();
  sendJson(res, 200, deployState);
}

function handlePullLog(req, res) {
  fs.readFile(DEPLOY_LOG, "utf8", (err, data) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err ? "(no deploy log yet)" : data.slice(-20_000));
  });
}

// The safe half of the 2026-10-17 divergence incident, done from the
// dashboard instead of over SSH: pushes commit(s) this VPS already built and
// deployed (e.g. startSourceBumpDeploy's own post-deploy "git push" failing)
// up to GitHub. Deliberately refuses when origin/main has ALSO moved ahead —
// pulling those commits in here, without running them through the real
// preflight/build/test/deploy gate handlePull uses, would silently fast-
// forward this box's git ref past code it never actually ran, which then
// makes handlePull's own "commits behind" count lie. That two-way case stays
// a manual (or Claude-assisted) fetch+rebase+push, same as the incident.
function handleGitSync(req, res) {
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
  execFile("git", ["fetch", "origin", "main"], { cwd: REPO_DIR, timeout: 30_000 }, (fetchErr, fetchOut, fetchErrText) => {
    if (fetchErr) return sendJson(res, 502, { error: `git fetch failed: ${(fetchErrText || fetchErr.message || "").trim()}` });
    execFile(
      "git",
      ["rev-list", "--left-right", "--count", "origin/main...HEAD"],
      { cwd: REPO_DIR, timeout: 10_000, encoding: "utf8" },
      (countErr, countOut) => {
        if (countErr) return sendJson(res, 500, { error: "couldn't compare local HEAD against origin/main" });
        const [behind, ahead] = countOut.trim().split(/\s+/).map(Number);
        if (!ahead) return sendJson(res, 200, { ok: true, message: "already in sync with GitHub — nothing local to push" });
        if (behind) {
          return sendJson(res, 409, {
            error: `${ahead} local commit(s) aren't on GitHub, but origin/main also has ${behind} commit(s) this VPS hasn't deployed — pushing blindly would desync "Pull latest & deploy"'s commit tracking. Ask Claude to reconcile this (same as the 2026-10-17 incident) or fix it over SSH.`,
          });
        }
        // Re-checked here (not just at entry) for the same reason
        // startSourceBumpDeploy does: fetch+rev-list above is async, leaving
        // a window where a real deploy could start and begin its own commit
        // concurrently. git itself can't corrupt a ref from a concurrent
        // push (ref updates are atomic), but refusing keeps this action's
        // own "N commit(s) pushed" count honest instead of racing a number
        // computed before the deploy's commit landed.
        if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
        execFile("git", ["push", "origin", "main"], { cwd: REPO_DIR, timeout: 30_000 }, (pushErr, pushOut, pushErrText) => {
          if (pushErr) return sendJson(res, 502, { error: `push failed: ${(pushErrText || pushErr.message || "").trim()}` });
          fs.appendFileSync(DEPLOY_LOG, `\n\n=== git sync ${new Date().toISOString()} ===\npushed ${ahead} local commit(s) to GitHub\n`);
          sendJson(res, 200, { ok: true, message: `pushed ${ahead} local commit(s) to GitHub` });
        });
      },
    );
  });
}

// --- Stack version updates: a "test" (download/verify only, never touches the
// running container) then an "update" (apply, health-check, auto-rollback on
// failure) for the Stack tab items that have a safe, scriptable path.
// Deliberately NOT offered here: Postgres MAJOR version jumps (16->18 etc) —
// that changes the on-disk data format and needs a real dump/restore or
// pg_upgrade, never a plain image-tag swap. postgres:16-alpine only ever
// floats within the 16.x series, so nothing below can cause one by accident.
// App packages (api/admin/frontend) aren't included either — those are this
// repo's own semver, not an upstream dependency to bump.

// docker-compose.yml only pins the MAJOR for these three (e.g. "16-alpine"),
// so re-pulling the same tag always gets the newest patch/minor already in
// that major — there's no separate patch pin to bump.
const STACK_FLOATING_TARGETS = { postgres: "db", redis: "redis", caddy: "proxy" };

function stackImageRef(v, key) {
  if (key === "postgres") return v.infra.db;
  if (key === "redis") return v.infra.redis;
  if (key === "caddy") return v.infra.proxy;
  if (key === "pgbouncer") return v.infra.pgbouncer;
  return null;
}

// Polls the same getComposeStatus/isServiceUp the dashboard already renders
// with, same one-shot-not-a-retry-loop shape as selfHealRestart. If the
// freshly recreated container isn't healthy within the timeout, tags the
// previously-running image back onto the target name and recreates again —
// the container ends up back on exactly what it was running before this
// update started. `oldImageId` null (pgbouncer's case, see below) means
// there's nothing to re-tag; the caller handles that by restoring the
// compose file text instead.
function pollHealthThenMaybeRollback(service, imageRef, oldImageId, logLine, done) {
  const deadline = Date.now() + 90_000;
  const tick = () => {
    getComposeStatus((err, services) => {
      const entry = !err && services ? services.find((s) => s.Service === service) : null;
      logLine(`health check (${service}): ${entry ? entry.State : "(not found)"}`);
      if (entry && isServiceUp(entry.State)) {
        if (service !== "pgbouncer") return done(true);
        // PgBouncer's own image has no psql. Its TCP listener can be healthy
        // while every server login fails, so probe through it from the db
        // container before accepting an update as successful.
        return runCompose(
          ["exec", "-T", "db", "sh", "-ec", 'PGPASSWORD="$POSTGRES_APP_PASSWORD" psql -h pgbouncer -p 6432 -U usim_cms_app -d usim_cms -Atq -c "SELECT 1"'],
          (authErr, authOut, authErrText) => {
            if (!authErr && String(authOut).trim() === "1") {
              logLine("PgBouncer backend login: healthy");
              return done(true);
            }
            logLine(`PgBouncer backend login failed: ${(authErrText || authErr?.message || "unexpected response").trim().slice(-300)}`);
            if (Date.now() >= deadline) return done(false);
            setTimeout(tick, 3000);
          },
        );
      }
      if (Date.now() >= deadline) {
        if (!oldImageId) {
          logLine(`timed out waiting for ${service} to become healthy`);
          return done(false);
        }
        logLine(`timed out waiting for ${service} to become healthy — rolling back to previous image (${oldImageId})`);
        execFile("docker", ["tag", oldImageId, imageRef], { timeout: 10_000 }, () => {
          runCompose(["up", "-d", "--force-recreate", service], (rbErr, rbOut, rbErrText) => {
            logLine(rbOut || rbErrText || (rbErr ? rbErr.message : "rollback recreate issued"));
            done(false);
          });
        });
        return;
      }
      setTimeout(tick, 3000);
    });
  };
  tick();
}

function finishStackDeploy(label, logFd, code) {
  deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
  fs.appendFileSync(DEPLOY_LOG, `=== ${label} finished, exit ${code} ===\n`);
  fs.closeSync(logFd);
}

// Boots the candidate image in complete isolation — its own throwaway,
// never-published container (or, for Caddy, no running container at all) —
// and reports whether it actually works, before anyone decides to click
// Update. This is the real "would this be OK" signal: /update's own
// health-check-with-rollback only runs AFTER the real service has already
// been swapped, so it protects against a bad update but can't warn ahead of
// time the way this can.
function stagingBootTest(key, imageRef, cb) {
  const name = `ucms-staging-test-${key}-${Date.now()}`;
  if (key === "caddy") {
    const caddyfile = path.join(REPO_DIR, "Caddyfile");
    execFile(
      "docker",
      ["run", "--rm", "-v", `${caddyfile}:/etc/caddy/Caddyfile:ro`, imageRef, "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) return cb(false, `Caddyfile failed to validate against the new version: ${(stderr || err.message).trim().slice(-400)}`);
        cb(true, "Caddyfile validates against the new version (no traffic/ports involved)");
      },
    );
    return;
  }
  if (key === "redis") {
    execFile("docker", ["run", "-d", "--rm", "--name", name, imageRef], { timeout: 30_000 }, (startErr, _o, startStderr) => {
      if (startErr) return cb(false, `container failed to start: ${(startStderr || startErr.message).trim()}`);
      setTimeout(() => {
        execFile("docker", ["exec", name, "redis-cli", "ping"], { timeout: 10_000 }, (pingErr, pingOut) => {
          const ok = !pingErr && String(pingOut).trim() === "PONG";
          execFile("docker", ["stop", "-t", "2", name], { timeout: 15_000 }, () => {
            cb(ok, ok ? "booted in isolation and responded to PING" : `didn't respond to PING: ${(pingErr ? pingErr.message : pingOut || "").trim()}`);
          });
        });
      }, 1500);
    });
    return;
  }
  if (key === "postgres") {
    execFile(
      "docker",
      ["run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=staging-test-only", imageRef],
      { timeout: 30_000 },
      (startErr, _o, startStderr) => {
        if (startErr) return cb(false, `container failed to start: ${(startStderr || startErr.message).trim()}`);
        const deadline = Date.now() + 30_000;
        const poll = () => {
          execFile("docker", ["exec", name, "pg_isready", "-U", "postgres"], { timeout: 5_000 }, (readyErr) => {
            if (!readyErr) {
              return execFile("docker", ["stop", "-t", "2", name], { timeout: 15_000 }, () =>
                cb(
                  true,
                  "new image boots and accepts connections on this host — note: this only proves the image itself runs here, " +
                    "NOT that a MAJOR version upgrade of a live database can read its existing data; that needs its own dump/restore test (apps/api/scripts/backup.sh)",
                ),
              );
            }
            if (Date.now() >= deadline) {
              return execFile("docker", ["stop", "-t", "2", name], { timeout: 15_000 }, () => cb(false, "timed out waiting for the new image to accept connections"));
            }
            setTimeout(poll, 2000);
          });
        };
        setTimeout(poll, 1500);
      },
    );
    return;
  }
  if (key === "pgbouncer") {
    const ini = path.join(REPO_DIR, "pgbouncer", "pgbouncer.ini");
    const userlist = path.join(REPO_DIR, "pgbouncer", "userlist.txt");
    execFile(
      "docker",
      [
        "run", "-d", "--rm", "--name", name, "--network", "none",
        "--user", "70:70", "--entrypoint", "/usr/bin/pgbouncer",
        "-v", `${ini}:/etc/pgbouncer/pgbouncer.ini:ro`,
        "-v", `${userlist}:/etc/pgbouncer/userlist.txt:ro`,
        imageRef, "/etc/pgbouncer/pgbouncer.ini",
      ],
      { timeout: 30_000 },
      (startErr, _o, startStderr) => {
        if (startErr) return cb(false, `container failed to start: ${(startStderr || startErr.message).trim()}`);
        setTimeout(() => {
          execFile("docker", ["inspect", "-f", "{{.State.Running}}", name], { timeout: 10_000 }, (inspErr, out) => {
            const running = !inspErr && String(out).trim() === "true";
            if (running) {
              return execFile("docker", ["stop", "-t", "2", name], { timeout: 15_000 }, () =>
                cb(true, "booted with the real pgbouncer.ini/userlist.txt (read-only copies) and stayed up"),
              );
            }
            execFile("docker", ["logs", name], { timeout: 10_000 }, (_e, logOut, logErr) => {
              cb(false, `crashed on boot: ${(logOut || logErr || "").toString().trim().slice(-400)}`);
            });
          });
        }, 2500);
      },
    );
    return;
  }
  cb(false, "no staging test defined for this component");
}

// Every staging test result goes to DEPLOY_LOG too (same viewer as every
// other deploy/update action, see handleDepsCheck's own comment above) — the
// inline stackMsg span only ever shows a one-line summary, and without this
// an admin who gets told "outdated"/"test failed" has nowhere to see WHY.
function logStackTestResult(key, imageRef, ok, note) {
  fs.appendFileSync(DEPLOY_LOG, `\n\n=== staging test: ${key} (${imageRef}) ${new Date().toISOString()} ===\n${ok ? "PASS" : "FAIL"}: ${note}\n`);
}

// POST /api/stack/:key/test — pulls the candidate image, then boot-tests it
// in isolation (stagingBootTest). Never touches the running container; the
// separate risk /update guards against (a bad image breaking the live
// service) still gets its own health-check-with-rollback there regardless of
// what this test reported.
function handleStackTest(req, res, key) {
  // Dependency check is a read-only `pnpm outdated` — unlike everything else
  // here it never touches docker/containers at all, so it works regardless
  // of DEPLOY_MODE and must be checked before the docker-mode gate below.
  if (key === "deps") return handleDepsCheck(req, res);
  if (key === "node" || key === "pnpm") {
    return sendJson(res, 400, {
      error: "no separate test step here — Update already builds and test-gates the new image before switching traffic",
    });
  }
  if (DEPLOY_MODE !== "docker") {
    return sendJson(res, 501, { error: "stack version checks need docker mode — this box runs systemd mode" });
  }
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
  getStackVersions((v) => {
    if (STACK_FLOATING_TARGETS[key]) {
      const imageRef = stackImageRef(v, key);
      if (!imageRef) return sendJson(res, 400, { error: `${key} isn't running under docker-compose.yml on this box` });
      execFile("docker", ["pull", imageRef], { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) {
          logStackTestResult(key, imageRef, false, stderr || err.message);
          return sendJson(res, 502, { ok: false, error: stderr || err.message });
        }
        stagingBootTest(key, imageRef, (ok, note) => {
          logStackTestResult(key, imageRef, ok, note);
          if (!ok) return sendJson(res, 502, { ok: false, error: `pulled ${imageRef} but staging test failed: ${note}` });
          sendJson(res, 200, { ok: true, message: `${imageRef}: ${note}. Nothing in production touched.` });
        });
      });
      return;
    }
    if (key === "pgbouncer") {
      getUpstreamLatest((latest) => {
        if (!latest.pgbouncer) return sendJson(res, 502, { error: "couldn't resolve latest PgBouncer tag" });
        const newRef = `percona/percona-pgbouncer:${latest.pgbouncer}`;
        execFile("docker", ["pull", newRef], { timeout: 120_000 }, (err, stdout, stderr) => {
          if (err) {
            logStackTestResult("pgbouncer", newRef, false, stderr || err.message);
            return sendJson(res, 502, { ok: false, error: stderr || err.message });
          }
          stagingBootTest("pgbouncer", newRef, (ok, note) => {
            logStackTestResult("pgbouncer", newRef, ok, note);
            if (!ok) return sendJson(res, 502, { ok: false, error: `pulled ${newRef} but staging test failed: ${note}` });
            sendJson(res, 200, { ok: true, message: `${newRef}: ${note}. Nothing in production touched.` });
          });
        });
      });
      return;
    }
    sendJson(res, 404, { error: "unknown stack item" });
  });
}

// POST /api/stack/:key/update — applies the version, health-checks, and
// auto-rolls-back on failure. Runs through the same deployState/DEPLOY_LOG
// single-flight gate as "Pull latest & deploy" (handlePull), so it can never
// race with that or with another stack update.
function handleStackUpdate(req, res, key) {
  if (["postgres", "redis", "pgbouncer", "caddy"].includes(key)) {
    return sendJson(res, 409, { error: "Shared infrastructure cannot be updated without an HA peer while zero downtime is required." });
  }
  if (key === "node") return handleNodeUpdate(req, res);
  if (key === "pnpm") return handlePnpmUpdate(req, res);
  if (key === "deps") return handleDepsUpdate(req, res);

  if (DEPLOY_MODE !== "docker") {
    return sendJson(res, 501, { error: "stack version updates need docker mode — this box runs systemd mode" });
  }
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });

  getStackVersions((v) => {
    if (STACK_FLOATING_TARGETS[key]) {
      const service = STACK_FLOATING_TARGETS[key];
      const imageRef = stackImageRef(v, key);
      if (!imageRef) return sendJson(res, 400, { error: `${key} isn't running under docker-compose.yml on this box` });

      deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
      const logFd = fs.openSync(DEPLOY_LOG, "a");
      const logLine = (s) => fs.appendFileSync(DEPLOY_LOG, s + "\n");
      logLine(`\n\n=== ${key} patch refresh started ${deployState.startedAt} ===`);
      sendJson(res, 202, { ok: true, started: true });

      runCompose(["ps", "-q", service], (psErr, psOut) => {
        const cid = (psOut || "").trim().split("\n")[0];
        execFile("docker", ["inspect", "--format", "{{.Image}}", cid], { timeout: 10_000 }, (inspectErr, oldImageId) => {
          const oldImage = inspectErr ? null : oldImageId.trim();
          logLine(`previous image id: ${oldImage || "(unknown)"}`);
          logLine(`--- pulling ${imageRef} ---`);
          runCompose(["pull", service], (pullErr, pullOut, pullErrText) => {
            logLine(pullOut || pullErrText || "");
            if (pullErr) {
              logLine(`pull failed: ${pullErr.message}`);
              return finishStackDeploy(`${key} patch refresh`, logFd, 1);
            }
            logLine(`--- recreating ${service} ---`);
            runCompose(["up", "-d", service], (upErr, upOut, upErrText) => {
              logLine(upOut || upErrText || "");
              if (upErr) {
                logLine(`recreate failed: ${upErr.message}`);
                return finishStackDeploy(`${key} patch refresh`, logFd, 1);
              }
              pollHealthThenMaybeRollback(service, imageRef, oldImage, logLine, (ok) =>
                finishStackDeploy(`${key} patch refresh`, logFd, ok ? 0 : 1),
              );
            });
          });
        });
      });
      return;
    }

    if (key === "pgbouncer") {
      if (!v.infra.pgbouncer) {
        return sendJson(res, 400, { error: "pgbouncer isn't running under docker-compose.yml on this box" });
      }
      getUpstreamLatest((latest) => {
        if (!latest.pgbouncer) return sendJson(res, 502, { error: "couldn't resolve latest PgBouncer tag" });
        const newRef = `percona/percona-pgbouncer:${latest.pgbouncer}`;
        if (newRef === v.infra.pgbouncer) return sendJson(res, 400, { error: "already on the latest PgBouncer tag" });

        const composePath = path.join(REPO_DIR, "docker-compose.yml");
        let oldContent;
        try {
          oldContent = fs.readFileSync(composePath, "utf8");
        } catch (e) {
          return sendJson(res, 500, { error: `couldn't read docker-compose.yml: ${e.message}` });
        }
        const re = /^(\s*image:\s*)percona\/percona-pgbouncer:\S+/m;
        if (!re.test(oldContent)) {
          return sendJson(res, 500, { error: "pgbouncer image: line not found in docker-compose.yml" });
        }
        const newContent = oldContent.replace(re, `$1${newRef}`);

        deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
        const logFd = fs.openSync(DEPLOY_LOG, "a");
        const logLine = (s) => fs.appendFileSync(DEPLOY_LOG, s + "\n");
        logLine(`\n\n=== pgbouncer update started ${deployState.startedAt} (${v.infra.pgbouncer} -> ${newRef}) ===`);
        sendJson(res, 202, { ok: true, started: true });

        const restore = (cb) => fs.writeFile(composePath, oldContent, "utf8", cb);
        fs.writeFile(composePath, newContent, "utf8", (writeErr) => {
          if (writeErr) {
            logLine(`couldn't write docker-compose.yml: ${writeErr.message}`);
            return finishStackDeploy("pgbouncer update", logFd, 1);
          }
          logLine(`--- pulling ${newRef} ---`);
          runCompose(["pull", "pgbouncer"], (pullErr, pullOut, pullErrText) => {
            logLine(pullOut || pullErrText || "");
            if (pullErr) {
              logLine(`pull failed: ${pullErr.message} — reverting docker-compose.yml`);
              return restore(() => finishStackDeploy("pgbouncer update", logFd, 1));
            }
            logLine(`--- recreating pgbouncer ---`);
            runCompose(["up", "-d", "pgbouncer"], (upErr, upOut, upErrText) => {
              logLine(upOut || upErrText || "");
              if (upErr) {
                logLine(`recreate failed: ${upErr.message} — reverting docker-compose.yml`);
                return restore(() =>
                  runCompose(["up", "-d", "pgbouncer"], () => finishStackDeploy("pgbouncer update", logFd, 1)),
                );
              }
              pollHealthThenMaybeRollback("pgbouncer", newRef, null, logLine, (ok) => {
                if (ok) return finishStackDeploy("pgbouncer update", logFd, 0);
                logLine(`rolling back docker-compose.yml to ${v.infra.pgbouncer}`);
                restore(() =>
                  runCompose(["up", "-d", "pgbouncer"], () => finishStackDeploy("pgbouncer update", logFd, 1)),
                );
              });
            });
          });
        });
      });
      return;
    }

    sendJson(res, 404, { error: "unknown stack item" });
  });
}

// Node/pnpm live in source files (Dockerfiles, package.json), not
// docker-compose.yml — bumping them means editing tracked files and
// redeploying through scripts/deploy.sh's existing blue-green pipeline,
// which already builds+tests+typechecks the new image before ever
// switching traffic to it (see apps/api/Dockerfile's build-stage RUN pnpm
// test/typecheck) — that IS the test step here, not a separate dry run.
// Docker mode only: on systemd/bare-metal, Node/pnpm are host-level tools
// this box may share with other projects, same reasoning CLAUDE.md gives
// for never restarting a reused Postgres.
// deploy.sh builds straight from this box's own working tree (it never
// does its own git pull/fetch), so reaching a git remote is NOT required
// for the bump to actually take effect — only a local commit is, for an
// audit trail/rollback-via-git-history. Pushing to origin is therefore
// best-effort and runs AFTER the real deploy, never blocking it: installs
// on other orgs' VPSes shouldn't need a GitHub credential wired up just to
// click Update, and a missing/broken remote must never strand a bump that
// otherwise succeeded (see the exit-128 "could not read Username" case).
// oldContents: { "relative/path": originalFileContent } — every file this
// bump touched, captured BEFORE the edit, so a failure anywhere in the
// pipeline (lockfile regen, commit, build/test gate, deploy) can put the
// working tree back exactly how it was. Mirrors the pgbouncer update's
// own restore-on-failure pattern. A failure after the commit already
// landed leaves that commit in git history (harmless — just not what's
// deployed) but still reverts the files on disk, since getStackVersions
// reads "current" straight off disk, not off git HEAD — without this, a
// failed bump would look "already latest" forever and silently block retries.
function startSourceBumpDeploy(label, oldContents, commitMsg, res, preCommitScript) {
  // Every caller (handleNodeUpdate/handlePnpmUpdate/handleDepsUpdate) does
  // async work — a registry lookup, getOutdatedBreakdown's two pnpm calls —
  // between its OWN initial deployState.running check and this call, leaving
  // a window for a second request to slip past that first check. Re-checking
  // here, with nothing async between this line and the set below, is what
  // actually makes the check-and-claim atomic (same second-check-right-
  // before-the-set pattern handlePull uses around its own preflight check).
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
  const files = Object.keys(oldContents);
  deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
  saveDeployState();
  const logFd = fs.openSync(DEPLOY_LOG, "a");
  fs.writeSync(logFd, `\n\n=== ${label} started ${deployState.startedAt} ===\n`);
  const quotedFiles = files.map((f) => `"${f}"`).join(" ");
  const script = `
    set -e
    ${preCommitScript || ""}
    echo "--- committing ${quotedFiles} ---"
    git add ${quotedFiles}
    if git diff --cached --quiet -- ${quotedFiles}; then
      echo "--- nothing to commit (no file changed) — skipping commit and deploy ---"
    else
      git commit -m "$(cat <<'COMMITMSG'
${commitMsg}
COMMITMSG
)"
      echo "--- deploying (blue-green, zero-downtime — builds+tests the new image before switching) ---"
      bash scripts/deploy.sh
      echo "--- syncing to git remote (best effort, never blocks the deploy above) ---"
      if git remote get-url origin >/dev/null 2>&1; then
        git push origin main || echo "WARNING: push to origin failed — the bump is already deployed and committed locally, just not synced to the remote. Fix git credentials then run: git push origin main"
      else
        echo "no git remote configured — skipping push, commit stays local-only"
      fi
    fi
    echo "--- done ---"
  `;
  const child = spawn("sh", ["-c", script], { cwd: REPO_DIR, stdio: ["ignore", logFd, logFd], detached: true });
  deployState.pid = child.pid;
  saveDeployState();
  child.unref();
  child.on("exit", (code) => {
    deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
    saveDeployState();
    fs.appendFileSync(DEPLOY_LOG, `=== ${label} finished, exit ${code} ===\n`);
    if (code !== 0) {
      for (const [rel, oldContent] of Object.entries(oldContents)) {
        try {
          fs.writeFileSync(path.join(REPO_DIR, rel), oldContent, "utf8");
        } catch {
          // Keep reporting the original deployment failure.
        }
      }
      fs.appendFileSync(
        DEPLOY_LOG,
        `restored ${files.join(", ")} on disk to their pre-bump content (any partial local commit stays in git history, just isn't what's deployed)\n`,
      );
    }
    fs.closeSync(logFd);
  });
  sendJson(res, 202, { ok: true, started: true });
}

function handleNodeUpdate(req, res) {
  if (DEPLOY_MODE !== "docker") {
    return sendJson(res, 501, { error: "Node base-image updates need docker mode — this box runs systemd mode" });
  }
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
  getUpstreamLatest((latest) => {
    if (!latest.node) return sendJson(res, 502, { error: "couldn't resolve latest Node LTS major" });
    getStackVersions((v) => {
      const curMajor = v.node.dockerImage ? (v.node.dockerImage.match(/^node:(\d+)/) || [])[1] : null;
      if (curMajor && Number(curMajor) >= Number(latest.node)) {
        return sendJson(res, 400, { error: `already on node:${curMajor} — nothing to bump` });
      }
      const dockerfiles = ["apps/api/Dockerfile", "apps/admin/Dockerfile", "apps/frontend/Dockerfile"];
      const oldContents = {};
      for (const rel of dockerfiles) {
        const full = path.join(REPO_DIR, rel);
        let content;
        try {
          content = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const updated = content.replace(/^FROM node:\d+(-\S+)?/m, (m) => m.replace(/\d+/, latest.node));
        if (updated !== content) {
          fs.writeFileSync(full, updated, "utf8");
          oldContents[rel] = content;
        }
      }
      if (!Object.keys(oldContents).length) return sendJson(res, 400, { error: 'no "FROM node:" line found to bump' });
      startSourceBumpDeploy(
        "Node base image bump",
        oldContents,
        `chore(deps): bump Node base image to node:${latest.node}-alpine\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`,
        res,
      );
    });
  });
}

function handlePnpmUpdate(req, res) {
  if (DEPLOY_MODE !== "docker") {
    return sendJson(res, 501, { error: "pnpm updates need docker mode — this box runs systemd mode" });
  }
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
  getUpstreamLatest((latest) => {
    if (!latest.pnpm) return sendJson(res, 502, { error: "couldn't resolve latest pnpm version" });
    // This value is interpolated into the source-bump shell script below.
    // Treat registry metadata as untrusted input even though it arrived over
    // HTTPS; only a plain release version is valid in these command arguments.
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(latest.pnpm)) {
      return sendJson(res, 502, { error: "npm registry returned an invalid pnpm version" });
    }
    const full = path.join(REPO_DIR, "package.json");
    const content = fs.readFileSync(full, "utf8");
    const re = /"packageManager":\s*"pnpm@[^"]+"/;
    if (!re.test(content)) {
      return sendJson(res, 400, { error: 'no "packageManager": "pnpm@..." field found in package.json' });
    }
    const curPnpm = (content.match(re) || [])[0];
    if (curPnpm && curPnpm.includes(`pnpm@${latest.pnpm}"`)) {
      return sendJson(res, 400, { error: `already on pnpm@${latest.pnpm} — nothing to bump` });
    }
    const updated = content.replace(re, `"packageManager": "pnpm@${latest.pnpm}"`);
    fs.writeFileSync(full, updated, "utf8");

    const lockPath = path.join(REPO_DIR, "pnpm-lock.yaml");
    const oldContents = { "package.json": content };
    try {
      oldContents["pnpm-lock.yaml"] = fs.readFileSync(lockPath, "utf8");
    } catch {
      // A missing lockfile is handled by the regeneration step below.
    }

    // The lockfile pins package-manager-version-specific metadata, not just
    // dependency versions — a bumped packageManager field with a stale
    // lockfile fails Dockerfile's `pnpm install --frozen-lockfile` build gate
    // outright (ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE), which is
    // exactly what happened the first time this ran. Regenerate it with the
    // NEW pnpm (via corepack, same NODE_DIR trick scripts/update.sh already
    // uses) before committing, so the committed lockfile actually matches.
    // Don't trust whatever PATH this process inherited (a systemd unit with
    // no explicit Environment= can end up with a thin one) — hardcode the
    // usual system bin dirs alongside NODE_DIR so a system-package pnpm
    // (e.g. /usr/bin/pnpm) or a corepack-provisioned shim are both found
    // regardless of how this box's service unit is configured.
    // A host whose bundled corepack ships signing keys from whenever that
    // Node release was cut can fail signature verification outright on fresh
    // registry metadata once npm rotates its keys ("Cannot find matching
    // keyid"), hit live on this box's Node 20.20.2. Real fix: update corepack
    // itself first (current keys) — `npm install -g corepack@latest` is a
    // plain npm install, not subject to corepack's own broken check. If the
    // regen still fails after that, this fails the whole bump hard rather
    // than silently retrying with COREPACK_INTEGRITY_KEYS=0 — a supply-chain
    // verification step should never auto-bypass itself on failure; an
    // operator can still set that env var by hand after confirming why
    // verification failed. Neither step touches the Docker build — each
    // Dockerfile's own `corepack enable` runs its own, separately current
    // corepack from that image's node:*-alpine base.
    const preCommit = `
    NODE_DIR="$(dirname "${NODE_BIN}")"
    export PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
    echo "--- updating corepack (old bundled corepack can carry stale npm signing keys) ---"
    npm install -g corepack@${COREPACK_PIN_VERSION} >/dev/null 2>&1 || echo "corepack self-update failed, continuing with bundled corepack"
    "$NODE_DIR/corepack" enable >/dev/null 2>&1 || true
    COREPACK_CACHE="\${COREPACK_HOME:-$HOME/.cache/node/corepack}"
    PINNED_PNPM="${latest.pnpm}"
    if [ -n "$COREPACK_CACHE" ] && [ -n "$PINNED_PNPM" ]; then
      rm -rf "$COREPACK_CACHE/v1/pnpm/$PINNED_PNPM" 2>/dev/null || true
    fi
    echo "--- regenerating pnpm-lock.yaml for pnpm@${latest.pnpm} ---"
    if ! pnpm install --lockfile-only; then
      echo "pnpm install failed — possible corepack signature verification failure even after updating corepack. Not auto-bypassing integrity checks: investigate (e.g. 'corepack enable' output above, registry reachability) before retrying, or re-run with COREPACK_INTEGRITY_KEYS=0 by hand once you've confirmed why verification failed." >&2
      exit 1
    fi
    `;

    startSourceBumpDeploy(
      "pnpm bump",
      oldContents,
      `chore(deps): bump pnpm to ${latest.pnpm}\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`,
      res,
      preCommit,
    );
  });
}

// `pnpm outdated --compatible` filters down to only the packages that have a
// newer version satisfying their ALREADY-DECLARED package.json range (pnpm's
// own semver-range matching, not hand-rolled here) — exactly the subset
// `pnpm -r update` (no --latest, see handleDepsUpdate below) will actually
// touch. Diffing that count against the full outdated count is what lets
// Test/Update report a real "N updatable, M need a manual major-version
// bump" breakdown instead of a generic "outdated packages found". This
// needs two registry reads, not one — --compatible changes which packages
// are LISTED, not just a column, and `pnpm outdated --format json`'s own
// "wanted" field was checked against this repo's real outdated packages and
// found to just mirror "current" rather than the highest in-range version,
// so it can't be used as a shortcut.
function getOutdatedBreakdown(cb) {
  const prefix = `NODE_DIR="$(dirname "${NODE_BIN}")"; export PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH";`;
  const countNames = (extraArgs, done) => {
    execFile(
      "sh",
      ["-c", `${prefix} pnpm -r outdated --format json ${extraArgs}`],
      { cwd: REPO_DIR, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        // Same "exit 1 just means outdated packages exist" convention as the
        // plain-text check below — only a JSON parse failure is a real error.
        try {
          done(null, Object.keys(JSON.parse(stdout || "{}")).length);
        } catch (e) {
          done(e);
        }
      },
    );
  };
  countNames("", (totalErr, totalCount) => {
    if (totalErr) return cb(totalErr);
    if (!totalCount) return cb(null, { totalCount: 0, compatibleCount: 0 });
    countNames("--compatible", (compatErr, compatibleCount) => {
      cb(null, { totalCount, compatibleCount: compatErr ? null : compatibleCount });
    });
  });
}

// "" (no claim either way) when the breakdown couldn't be computed, so a
// registry hiccup degrades to the old generic message instead of a wrong count.
function outdatedBreakdownNote(b) {
  if (!b || !b.totalCount || typeof b.compatibleCount !== "number") return "";
  const blocked = b.totalCount - b.compatibleCount;
  if (b.compatibleCount === 0) return ` — all ${b.totalCount} need a manual major-version bump`;
  if (blocked === 0) return ` — all ${b.compatibleCount} can update within their declared range`;
  return ` — ${b.compatibleCount} can update within range, ${blocked} need a manual major-version bump`;
}

// Read-only — `pnpm outdated` only reads the registry and compares against
// what's already declared/locked, never writes anything. Works regardless
// of DEPLOY_MODE, unlike everything else in this file. The full table goes
// to DEPLOY_LOG (same viewer as every other deploy/update action) rather
// than the small inline stackMsg span, since a workspace-wide outdated
// report can be long.
function handleDepsCheck(req, res) {
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
  const script = `NODE_DIR="$(dirname "${NODE_BIN}")"; export PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; pnpm -r outdated`;
  execFile("sh", ["-c", script], { cwd: REPO_DIR, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    // `pnpm outdated` exits 1 when there ARE outdated packages — that's the
    // normal "found something" case here, not a failure.
    const ansiColor = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    const output = (stdout || stderr || "").replace(ansiColor, "").trim();
    fs.appendFileSync(
      DEPLOY_LOG,
      `\n\n=== dependency check ${new Date().toISOString()} ===\n${output || "(nothing outdated within declared ranges)"}\n`,
    );
    if (!output) {
      return sendJson(res, 200, { ok: true, message: "all dependencies already match their declared ranges" });
    }
    getOutdatedBreakdown((breakdownErr, breakdown) => {
      sendJson(res, 200, {
        ok: true,
        message: `outdated packages found${outdatedBreakdownNote(breakdown)} — see Deployments log for the full list`,
      });
    });
  });
}

// Deliberately scoped to "update within each package.json's own declared
// semver range" (`pnpm -r update`, no --latest) — the same safety posture as
// the floating Docker tags: a caret/tilde range already states what the
// project considers compatible, so resolving to the newest version inside
// it is routine-risk, not a version a human needs to review first. Jumping
// a dependency's major (or past its declared range) is a separate, far
// riskier operation and isn't offered here — same reasoning as excluding
// Postgres major upgrades from one-click automation.
function handleDepsUpdate(req, res) {
  if (DEPLOY_MODE !== "docker") {
    return sendJson(res, 501, { error: "dependency updates need docker mode — this box runs systemd mode" });
  }
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/update is already running" });
  // Checked upfront, same "already on latest — nothing to bump" shape as
  // handleNodeUpdate/handlePnpmUpdate above: without this, a workspace where
  // every outdated package is a major/out-of-range bump (the common case —
  // see outdatedBreakdownNote) falls through to `pnpm -r update` changing
  // zero files, leaving `git commit` with nothing staged. A breakdown
  // failure (registry hiccup) never blocks the attempt — it just falls back
  // to the old unconditional behavior, same "don't strand a bump over a
  // diagnostic-only step" reasoning as the git-push-is-best-effort comment
  // in startSourceBumpDeploy above.
  getOutdatedBreakdown((breakdownErr, breakdown) => {
    const haveBreakdown = !breakdownErr && breakdown && typeof breakdown.compatibleCount === "number";
    if (haveBreakdown && breakdown.compatibleCount === 0) {
      return sendJson(res, 400, {
        error: breakdown.totalCount
          ? `already up to date within declared ranges — ${breakdown.totalCount} package(s) need a manual major-version bump (see Test)`
          : "already on the latest versions within declared ranges — nothing to bump",
      });
    }
    // `pnpm -r update` can rewrite the specifier in ANY workspace's
    // package.json (not just the lockfile) when it resolves to a newer
    // version within the declared range — every tracked package.json must be
    // captured (for revert-on-failure) and committed alongside the lockfile,
    // or a later `git reset --hard` discards the uncommitted package.json
    // change while the lockfile (committed) keeps referencing it, leaving the
    // two permanently out of sync.
    let pkgPaths;
    try {
      pkgPaths = execFileSync("git", ["ls-files", "--", "*package.json"], { cwd: REPO_DIR, encoding: "utf8" })
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch (e) {
      return sendJson(res, 500, { error: `couldn't list workspace package.json files: ${e.message}` });
    }
    const oldContents = {};
    try {
      for (const rel of pkgPaths) oldContents[rel] = fs.readFileSync(path.join(REPO_DIR, rel), "utf8");
      oldContents["pnpm-lock.yaml"] = fs.readFileSync(path.join(REPO_DIR, "pnpm-lock.yaml"), "utf8");
    } catch (e) {
      return sendJson(res, 500, { error: `couldn't read workspace files: ${e.message}` });
    }
    const note = haveBreakdown
      ? `echo "${breakdown.compatibleCount} package(s) have an in-range update; ${breakdown.totalCount - breakdown.compatibleCount} need a manual major-version bump (see the dependency check above for the list)"`
      : "";
    const preCommit = `
    NODE_DIR="$(dirname "${NODE_BIN}")"
    export PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
    echo "--- updating dependencies within their declared package.json ranges (pnpm -r update) ---"
    ${note}
    pnpm -r update
    echo "--- auditing updated dependency graph before commit or deployment ---"
    pnpm audit
    `;
    startSourceBumpDeploy(
      "dependency update",
      oldContents,
      `chore(deps): update ${haveBreakdown ? breakdown.compatibleCount + " " : ""}dependencies within declared ranges\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`,
      res,
      preCommit,
    );
  });
}

// Auto-SSL for the nginx-fronted enterprise pattern (see CLAUDE.md's
// "Going live" section): Caddy's own auto-cert only applies when Caddy owns
// port 80/443 directly, which an org running its own IT-managed edge won't
// do. certbot's official --nginx plugin edits the matching server block in
// place and reloads nginx itself — no template/regeneration logic needed
// here, and its package install already wires its own renewal timer/cron,
// so this is a one-shot "issue" action, nothing to schedule. Lives in the
// monitor (not apps/api) because nginx is a host-level resource this
// process already has shell access to manage — apps/api runs in a
// container with no route to the host's nginx/certbot at all.
const HOSTNAME_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function handleSslIssue(req, res) {
  readJsonBody(req, res, 16 * 1024, (parsed) => {
    const domain = String(parsed.domain || "").trim();
    const email = String(parsed.email || "").trim();
    if (!HOSTNAME_RE.test(domain)) return sendJson(res, 400, { error: "invalid domain" });
    if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: "invalid email" });
    // Array-form execFile — args never pass through a shell, so domain/email
    // can't break out into another command even though they're user input.
    execFile(
      "certbot",
      ["--nginx", "-d", domain, "-m", email, "--agree-tos", "-n", "--redirect"],
      { timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return sendJson(res, 500, { error: String(err.message || err), stdout, stderr });
        sendJson(res, 200, { ok: true, stdout, stderr });
      },
    );
  });
}

// Backup destination (superadmin-configurable off-site push target for the
// nightly backup cron), stored in the control-plane DB's
// platform_settings.backup_destination column — same row apps/admin's
// Settings tab edits (see apps/api/src/routes/portal-settings.ts). This file
// has no pg npm driver (see the header comment's "zero-dependency" promise),
// so it reads/writes that row by shelling out to psql instead of adding one.
// In docker mode, db's port is never published to the host (see
// docker-compose.yml's own comment on the db service) — only a container on
// ucms-net can reach it — so the query runs inside a one-off
// postgres:16-alpine container, same trick install.sh's generated
// /opt/ucms/backup/run.sh already uses for the nightly dump itself. In
// systemd mode it runs straight against the host's own psql client (already
// guaranteed present there by install.sh's ensure_postgres). PGHOST/PGPORT/
// PGUSER/PGPASSWORD/PGDATABASE here are the exact same control-plane
// connection install.sh snapshots into /opt/ucms/backup/backup.env —
// install_backup_cron's own finish_backup_destination_setup() sets them
// into this process's own env file (/etc/ucms-monitor.env) too, as discrete
// fields rather than one connection URI (see below for why).
const PG_HOST = process.env.PGHOST || "";
const PG_PORT = process.env.PGPORT || "5432";
const PG_USER = process.env.PGUSER || "";
const PG_PASSWORD = process.env.PGPASSWORD || "";
const PG_DATABASE = process.env.PGDATABASE || "";

// Runs a SQL script file through psql and returns stdout. The query text is
// written to a throwaway file (fs.writeFileSync — a real file write, not a
// shell command). The connection is passed entirely via environment
// variables (execFile's own `env` option), never as a URI argv element —
// an argv is visible to ANY local user on this box via `ps aux`, not just
// root, which a bare `postgres://user:password@host/db` string would
// expose outright (caught by an automated security review). In docker
// mode, `-e PGPASSWORD` etc. with no `=value` tells docker to forward
// whatever that name already holds in ITS OWN process environment (set via
// the `env` option below) into the container — the value itself never
// appears in the `docker run` command line either. Neither value is ever
// re-parsed as shell syntax the way install.sh's own `source backup.env`
// bug was (see that file's install_backup_cron comment for the full
// writeup) — this is a plain execFile argv array, no shell involved at all.
function runPsql(sql) {
  return new Promise((resolve, reject) => {
    if (!PG_HOST || !PG_USER || !PG_DATABASE) {
      reject(new Error("PGHOST/PGUSER/PGDATABASE not set for this monitor — re-run install.sh to pick up backup-destination support"));
      return;
    }
    const tmpFile = path.join(os.tmpdir(), `ucms-pgquery-${crypto.randomUUID()}.sql`);
    fs.writeFileSync(tmpFile, sql, { mode: 0o600 });
    const cleanup = () => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Temporary file may already have been removed.
      }
    };
    const pgEnv = { ...process.env, PGHOST: PG_HOST, PGPORT: PG_PORT, PGUSER: PG_USER, PGPASSWORD: PG_PASSWORD, PGDATABASE: PG_DATABASE };
    const cmd = DEPLOY_MODE === "docker" ? "docker" : "psql";
    const args =
      DEPLOY_MODE === "docker"
        ? [
            "run", "--rm", "--network", "ucms-net",
            "-e", "PGHOST", "-e", "PGPORT", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE",
            "-v", `${tmpFile}:/query.sql:ro`, "postgres:16-alpine", "psql", "-tAq", "-f", "/query.sql",
          ]
        : ["-tAq", "-f", tmpFile];
    execFile(cmd, args, { timeout: 15_000, maxBuffer: 1024 * 1024, env: pgEnv }, (err, stdout, stderr) => {
      cleanup();
      if (err) return reject(new Error(String(stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

// SQL string-literal escaping (double a single quote), NOT shell escaping —
// this value is embedded in a .sql file psql reads with -f, never a shell
// command line. Standard, well-known Postgres literal-quoting rule.
function sqlStringLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// Requires an actual [user@]host:path shape, not just "no leading dash" —
// see the matching SSH_TARGET_RE comment in apps/api/src/routes/
// portal-settings.ts for the full reasoning (a charset-only check still let
// a `..`-riddled, colon-less value through, which combined with rsync
// --delete could point root's nightly cron at an arbitrary directory).
// Duplicated there, not shared — two separate deployables, no shared module.
const BACKUP_SSH_TARGET_RE = /^(?:[A-Za-z0-9][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9_./-]*$/;
const BACKUP_GDRIVE_FOLDER_RE = /^[A-Za-z0-9_-]+$/;

// Same masking apps/api/src/db/tenant-pool/backup-destination.ts does
// independently (duplicated, not shared — this file and apps/api are
// separate deployables with no shared module) — secrets never round-trip to
// this dashboard's browser in plaintext once saved.
function maskBackupDestination(cfg) {
  const out = { type: cfg.type || "local" };
  if (cfg.ssh) out.ssh = { target: cfg.ssh.target || "" };
  if (cfg.s3) {
    out.s3 = {
      endpoint: cfg.s3.endpoint || "",
      bucket: cfg.s3.bucket || "",
      region: cfg.s3.region || "",
      accessKeyId: cfg.s3.accessKeyId || "",
      secretAccessKeySet: Boolean(cfg.s3.secretAccessKey),
    };
  }
  if (cfg.gdrive) {
    out.gdrive = { folderId: cfg.gdrive.folderId || "", serviceAccountConfigured: Boolean(cfg.gdrive.serviceAccountJson) };
  }
  return out;
}

// Mirrors apps/api's validateBackupDestination (portal-settings.ts) — same
// rules, duplicated for the same "no shared module across these two
// deployables" reason as the masking function above. `existing` lets a blank
// secret/JSON field on an edit mean "keep what's already stored".
function validateBackupDestinationPatch(body, existing) {
  const type = body.type;
  if (type === "local") return { merged: { type } };
  if (type === "ssh") {
    const target = String((body.ssh && body.ssh.target) || "").trim();
    if (!target || !BACKUP_SSH_TARGET_RE.test(target) || target.includes("..")) return { error: "ssh.target must look like user@host:/path" };
    return { merged: { type, ssh: { target } } };
  }
  if (type === "s3") {
    const s3 = body.s3 || {};
    const endpoint = String(s3.endpoint || "").trim();
    const bucket = String(s3.bucket || "").trim();
    const region = String(s3.region || "").trim();
    const accessKeyId = String(s3.accessKeyId || "").trim();
    const secretAccessKey = String(s3.secretAccessKey || "");
    if (!endpoint || !bucket || !accessKeyId) return { error: "s3 endpoint/bucket/accessKeyId are required" };
    for (const v of [endpoint, bucket, region, accessKeyId, secretAccessKey]) {
      if (/[\r\n]/.test(v)) return { error: "s3 fields cannot contain newlines" };
    }
    const keptSecret = secretAccessKey || (existing.s3 && existing.s3.secretAccessKey) || "";
    if (!keptSecret) return { error: "s3.secretAccessKey is required" };
    return { merged: { type, s3: { endpoint, bucket, region, accessKeyId, secretAccessKey: keptSecret } } };
  }
  if (type === "gdrive") {
    const gdrive = body.gdrive || {};
    const folderId = String(gdrive.folderId || "").trim();
    const serviceAccountJson = String(gdrive.serviceAccountJson || "");
    if (!folderId || !BACKUP_GDRIVE_FOLDER_RE.test(folderId)) return { error: "gdrive.folderId must be a plain Google Drive folder ID" };
    const keptJson = serviceAccountJson || (existing.gdrive && existing.gdrive.serviceAccountJson) || "";
    if (!keptJson) return { error: "gdrive.serviceAccountJson is required" };
    if (keptJson.length > 20_000) return { error: "gdrive.serviceAccountJson is too large" };
    try {
      JSON.parse(keptJson);
    } catch {
      return { error: "gdrive.serviceAccountJson must be valid JSON" };
    }
    return { merged: { type, gdrive: { folderId, serviceAccountJson: keptJson } } };
  }
  return { error: "type must be one of local/ssh/s3/gdrive" };
}

async function getBackupDestinationRow() {
  const out = await runPsql("SELECT backup_destination FROM public.platform_settings WHERE id = 'singleton';");
  const trimmed = out.trim();
  if (!trimmed) return { type: "local" };
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && parsed.type ? parsed : { type: "local" };
  } catch {
    return { type: "local" };
  }
}

function handleGetBackupDestination(req, res) {
  getBackupDestinationRow()
    .then((cfg) => sendJson(res, 200, maskBackupDestination(cfg)))
    .catch((e) => sendJson(res, 500, { error: String(e.message || e) }));
}

function handleSetBackupDestination(req, res) {
  readJsonBody(req, res, 32 * 1024, async (parsed) => {
    try {
      const existing = await getBackupDestinationRow();
      const { error, merged } = validateBackupDestinationPatch(parsed, existing);
      if (error) return sendJson(res, 400, { error });
      const literal = sqlStringLiteral(JSON.stringify(merged));
      await runPsql(
        `INSERT INTO public.platform_settings (id, backup_destination) VALUES ('singleton', ${literal}::jsonb) ` +
          `ON CONFLICT (id) DO UPDATE SET backup_destination = EXCLUDED.backup_destination, updated_at = now();`,
      );
      sendJson(res, 200, maskBackupDestination(merged));
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) });
    }
  });
}

// Whether /opt/ucms/backup's generated scripts predate a feature the
// currently checked-out install.sh already knows about — e.g. this VPS was
// set up before off-site-push/PG* support existed, so this card can't
// actually do anything useful yet. installedVersion comes straight out of
// backup.env (BACKUP_CRON_VERSION, written by install.sh's own
// _apply_backup_cron_files); expectedVersion is read directly out of
// install.sh itself (BACKUP_CRON_VERSION="N" near the top) rather than
// duplicated as a second constant here — one source of truth, nothing to
// forget to bump in two places. A plain file read, not a network/DB call,
// so this is cheap enough to run on every dashboard load (see this
// feature's own "only run when needed" requirement — the actual re-run of
// install.sh only ever happens when the recommendation button is clicked,
// never automatically).
function getBackupCronStatus() {
  let expectedVersion = "";
  try {
    const installSh = fs.readFileSync(path.join(REPO_DIR, "install.sh"), "utf8");
    const m = installSh.match(/^BACKUP_CRON_VERSION="([^"]*)"/m);
    expectedVersion = m ? m[1] : "";
  } catch {
    // No generated cron template yet.
  }
  let cronExists = false;
  let installedVersion = "";
  try {
    const envContent = fs.readFileSync("/opt/ucms/backup/backup.env", "utf8");
    cronExists = true;
    const m = envContent.match(/^BACKUP_CRON_VERSION=(.*)$/m);
    installedVersion = m ? m[1].trim() : "";
  } catch {
    // Cron has not been installed yet.
  }
  const pgConfigured = Boolean(PG_HOST);
  const needsUpdate = cronExists && (!pgConfigured || installedVersion !== expectedVersion);
  return { cronExists, pgConfigured, installedVersion, expectedVersion, needsUpdate };
}

function handleBackupCronStatus(req, res) {
  sendJson(res, 200, getBackupCronStatus());
}

// Runs `install.sh --reapply-backup-cron` — a non-interactive re-run of just
// the backup-cron file/cron generation (see that flag's own comment in
// install.sh), never the full installer, and never from a timer — only ever
// in direct response to this POST, i.e. an operator clicking "Apply update"
// after the recommendation banner above told them to. This process already
// runs as root (same as every other privileged action this dashboard
// already performs — docker compose, systemctl, certbot), so no sudo needed.
function handleApplyBackupCronUpdate(req, res) {
  const mode = DEPLOY_MODE === "docker" ? "docker" : "bare-metal";
  execFile(
    "bash",
    [path.join(REPO_DIR, "install.sh"), "--reapply-backup-cron", `--mode=${mode}`],
    { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
    (err, stdout, stderr) => {
      if (err) {
        sendJson(res, 500, { error: String(stderr || err.message).trim(), stdout });
        return;
      }
      sendJson(res, 200, { ok: true, stdout, reloading: true });
      // The reapply just wrote fresh PGHOST/etc into /etc/ucms-monitor.env —
      // The supervisor reads the updated environment for a new worker and
      // drains the old worker after the replacement starts listening.
      setTimeout(() => {
        execFile("systemctl", ["reload", "ucms-monitor"], () => {});
      }, 500);
    },
  );
}

const server = http.createServer(async (req, res) => {
  if (!isAllowedHost(req.headers.host)) {
    res.writeHead(421, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Misdirected request");
    return;
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !isAllowedOrigin(req)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Cross-origin request denied");
    return;
  }
  const authKey = authClientKey(req);
  const retryMs = authBlockRemaining(authKey);
  const sensitiveRetryMs = authBlockRemaining(authKey, Date.now(), sensitiveFailures);
  if (retryMs > 0 || sensitiveRetryMs > 0) {
    res.writeHead(429, {
      "Retry-After": String(Math.ceil(Math.max(retryMs, sensitiveRetryMs) / 1000)),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    res.end("Too many failed authentication attempts");
    return;
  }
  let principal;
  try {
    principal = await checkAuth(req);
  } catch (error) {
    console.error("Monitor authentication failed:", error);
    sendJson(res, 503, { error: "Monitor user store unavailable." });
    return;
  }
  if (!principal) {
    recordAuthFailure(authKey);
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="usim_cms monitor", charset="UTF-8"',
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    res.end("Auth required");
    return;
  }
  authFailures.delete(authKey);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  if (principal === MACHINE_PRINCIPAL && (req.method !== "POST" || url.pathname !== "/api/ssl/issue")) {
    sendJson(res, 403, { error: "Machine credential is limited to SSL issuance." });
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/") {
      const nonce = crypto.randomBytes(18).toString("base64");
      const dashboardHtml = DASHBOARD_HTML.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
      });
      res.end(dashboardHtml);
    } else if (req.method === "GET" && url.pathname === "/api/config") {
      handleConfig(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/users") {
      sendJson(res, 200, { currentUser: principal, users: listUsers() });
    } else if (req.method === "POST" && url.pathname === "/api/users/password") {
      handleUserMutation(req, res, (body) => changePassword(principal, body.currentPassword, body.newPassword),
        { actor: principal, action: "change_password", target: () => principal });
    } else if (req.method === "POST" && url.pathname === "/api/users") {
      handleUserMutation(req, res, (body) => addUser(principal, body.currentPassword, body.username, body.password),
        { actor: principal, action: "add_user", target: (body) => body.username });
    } else if (req.method === "POST" && url.pathname === "/api/users/remove") {
      handleUserMutation(req, res, (body) => removeUser(principal, body.currentPassword, body.username),
        { actor: principal, action: "remove_user", target: (body) => body.username });
    } else if (req.method === "GET" && url.pathname === "/api/status") {
      handleStatus(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/sites") {
      handleSites(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/disk-usage") {
      handleDiskUsage(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/disk-usage/verbose") {
      handleDiskUsageVerbose(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/db-sizes") {
      handleDbSizes(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/update-check") {
      handleUpdateCheck(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/versions") {
      handleVersions(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/version-checks") {
      handleVersionChecks(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/preflight") {
      handlePreflight(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/security") {
      handleSecurity(req, res, url.searchParams.get("refresh") === "1");
    } else if (req.method === "POST" && parts[0] === "api" && parts[1] === "service" && parts[3]) {
      handleServiceAction(req, res, parts[2], parts[3]);
    } else if (req.method === "GET" && parts[0] === "api" && parts[1] === "logs" && parts[2]) {
      handleLogs(req, res, parts[2], url.searchParams.get("tail"));
    } else if (req.method === "GET" && url.pathname === "/api/db/status") {
      handleDbStatus(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/db/restart") {
      handleDbRestart(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/pull") {
      handlePull(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/rollback") {
      handleRollback(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/git/sync") {
      handleGitSync(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/base/apply") {
      handleApplyBaseTier(req, res);
    } else if (req.method === "POST" && parts[0] === "api" && parts[1] === "stack" && parts[2] && parts[3] === "test") {
      handleStackTest(req, res, parts[2]);
    } else if (req.method === "POST" && parts[0] === "api" && parts[1] === "stack" && parts[2] && parts[3] === "update") {
      if (["node", "pnpm", "deps"].includes(parts[2])) {
        getPreflightCheck((pre) => {
          if (pre.error) return sendJson(res, 502, { error: pre.error });
          if (pre.verdict !== "safe") return sendJson(res, 409, { error: `Update blocked: ${pre.reasons.join(" ")}` });
          handleStackUpdate(req, res, parts[2]);
        });
      } else {
        handleStackUpdate(req, res, parts[2]);
      }
    } else if (req.method === "GET" && url.pathname === "/api/pull/status") {
      handlePullStatus(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/pull/log") {
      handlePullLog(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/ssl/issue") {
      handleSslIssue(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/alerts/test") {
      handleAlertTest(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/backup-destination") {
      handleGetBackupDestination(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/backup-destination") {
      handleSetBackupDestination(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/backup-cron-status") {
      handleBackupCronStatus(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/backup-cron/apply-update") {
      handleApplyBackupCronUpdate(req, res);
    } else {
      sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, MONITOR_HOST, () => {
  console.log(`usim_cms monitor listening on ${MONITOR_HOST}:${PORT} (repo: ${REPO_DIR}, mode: ${DEPLOY_MODE})`);
});

// The cluster supervisor first starts a healthy replacement, then drains
// this worker's HTTP connections. Polling timers would otherwise keep the
// disconnected worker alive after its listener has closed.
process.on("disconnect", () => process.exit(0));

if (ALERT_WEBHOOK_URL) {
  console.log(`alerting enabled: polling every ${ALERT_POLL_INTERVAL_MS}ms`);
  setInterval(pollForAlerts, ALERT_POLL_INTERVAL_MS);
  pollForAlerts();
}

console.log(`update checks: polling ${UPDATE_CHANNEL === "release" ? "release tags" : "origin/main"} every ${UPDATE_CHECK_INTERVAL_MS}ms`);
setInterval(pollForUpdateAlert, UPDATE_CHECK_INTERVAL_MS);
pollForUpdateAlert();
