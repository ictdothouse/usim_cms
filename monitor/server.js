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
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { setInterval } from "node:timers";

const PORT = Number(process.env.MONITOR_PORT || 5555);
const REPO_DIR = process.env.REPO_DIR || process.cwd();
const MONITOR_USER = process.env.MONITOR_USER || "admin";
const MONITOR_PASSWORD = process.env.MONITOR_PASSWORD || "";
const DEPLOY_LOG = path.join(REPO_DIR, ".deploy.log");
const DEPLOY_MODE = process.env.DEPLOY_MODE === "systemd" ? "systemd" : "docker";
const DB_MANAGED = process.env.DB_MANAGED !== "false";
// Only used in systemd mode's "pull latest & rebuild" — install.sh writes
// these into the same env file this process already reads MONITOR_* from.
const NODE_BIN = process.env.NODE_BIN || "node";
const API_PORT = process.env.API_PORT || "3000";
const FRONTEND_PORT = process.env.FRONTEND_PORT || "4321";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "localhost";
// Alerting is opt-in — unset means no-op, same convention as REDIS_URL/
// PGBOUNCER elsewhere in this project. ALERT_WEBHOOK_URL takes any plain
// HTTP(S) webhook that accepts a JSON POST (Slack/Discord/Teams incoming
// webhooks, or a custom endpoint) — no email/SMTP client here, this file's
// whole point is staying dependency-free (see the header comment).
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const ALERT_POLL_INTERVAL_MS = Number(process.env.ALERT_POLL_INTERVAL_MS) || 60_000;
const ALERT_DISK_THRESHOLD_PCT = Number(process.env.ALERT_DISK_THRESHOLD_PCT) || 85;
// How often to `git fetch origin main` in the background looking for new commits (Dependabot
// bumps included, once merged) — separate from ALERT_POLL_INTERVAL_MS since a git fetch is a
// network call to GitHub and update freshness doesn't need 60s granularity. GET /api/update-check
// (the dashboard's own on-demand refresh) always fetches fresh regardless of this interval.
const UPDATE_CHECK_INTERVAL_MS = Number(process.env.UPDATE_CHECK_INTERVAL_MS) || 30 * 60_000;
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
    (err, stdout) => cb(!err && stdout.trim().length > 0),
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

let deployState = { running: false, exitCode: null, startedAt: null, finishedAt: null };

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

function checkAuth(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return timingSafeEqualStr(user, MONITOR_USER) && timingSafeEqualStr(pass, MONITOR_PASSWORD);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
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

function resolveUploadsDir(cb) {
  if (UPLOADS_DIR_ENV) return cb(UPLOADS_DIR_ENV);
  if (DEPLOY_MODE !== "docker") return cb(path.join(REPO_DIR, "apps/api/uploads"));
  execFile(
    "docker",
    ["volume", "inspect", "ucms-uploads", "--format", "{{ .Mountpoint }}"],
    { timeout: 10_000 },
    (err, stdout) => cb(err ? null : stdout.trim()),
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

// Fetches origin/main and reports how far HEAD is behind it — the only signal needed to answer
// "is there something to update": anything merged to main (a green-CI'd Dependabot bump included,
// see .github/dependabot.yml) shows up here the moment it lands, no GitHub token/API call needed.
// null means the fetch itself failed (offline, GitHub down, etc) — callers treat that as
// "unknown", never as "0 updates".
function getRemoteUpdateInfo(cb) {
  execFile("git", ["fetch", "origin", "main", "--quiet"], { cwd: REPO_DIR, timeout: 20_000 }, (fetchErr) => {
    if (fetchErr) return cb(null);
    execFile(
      "git",
      ["log", "--oneline", "HEAD..origin/main", "-20"],
      { cwd: REPO_DIR, timeout: 10_000 },
      (logErr, stdout) => {
        if (logErr) return cb(null);
        const commits = stdout.trim() ? stdout.trim().split("\n") : [];
        execFile("git", ["rev-parse", "origin/main"], { cwd: REPO_DIR, timeout: 5_000 }, (shaErr, shaOut) => {
          cb({ commitsBehind: commits.length, commits, remoteSha: shaErr ? null : shaOut.trim() });
        });
      },
    );
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
  } catch {}
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
    } catch {}
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

function maxSemverTag(tags, re) {
  let best = null;
  let bestParsed = null;
  for (const t of tags) {
    const m = String(t).match(re);
    if (!m) continue;
    const parsed = [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
    if (!bestParsed || cmpVer(parsed, bestParsed) > 0) {
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
  dockerHubTags("edoburu/pgbouncer", (tags) => {
    result.pgbouncer = tags ? maxSemverTag(tags, /^v?(\d+)\.(\d+)\.(\d+)/) : null;
    done();
  });
}

function handleVersionChecks(req, res) {
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
        const cur = (v.infra.pgbouncer.match(/^edoburu\/pgbouncer:(\S+)/) || [])[1];
        checks.pgbouncer = { current: cur, latest: latest.pgbouncer, ...verdict(cur, latest.pgbouncer, false) };
      }
      sendJson(res, 200, { checks });
    });
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
  getRemoteUpdateInfo((updateInfo) => {
    if (!updateInfo) return cb({ error: "git fetch failed — check network/GitHub reachability" });
    if (updateInfo.commitsBehind === 0) {
      return cb({ commitsBehind: 0, verdict: "up-to-date", reasons: ["Already on the latest commit."] });
    }
    execFile(
      "git",
      ["diff", "--name-only", "HEAD", "origin/main"],
      { cwd: REPO_DIR, timeout: 10_000 },
      (diffErr, diffOut) => {
        const files = diffErr ? [] : diffOut.trim().split("\n").filter(Boolean);
        // These are the two change classes the existing deploy pipeline does NOT fully cover
        // on its own: docker-compose.yml/Caddyfile/pgbouncer config lives in the always-on
        // base tier that "Pull latest & deploy" deliberately never touches (see
        // handleApplyBaseTier's comment) — a tenant-facing symptom only shows up if someone
        // assumes the Update button applied it. A new migration file is actually fine (every
        // migration in this repo is additive, IF NOT EXISTS/idempotent — see CLAUDE.md), it's
        // just worth calling out explicitly rather than silently applying on first request.
        const baseTierChanged = files.some((f) => /^(docker-compose.*\.ya?ml|Caddyfile|pgbouncer\/)/.test(f));
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
            const noZeroDowntime = DEPLOY_MODE !== "docker" || trial;
            if (noZeroDowntime) {
              raise("caution");
              reasons.push(
                DEPLOY_MODE === "docker"
                  ? "Still in trial mode (no Caddy/blue-green promoted yet) — this rebuild briefly interrupts the site instead of a zero-downtime flip."
                  : "This install runs in systemd/bare-metal mode (no blue-green here) — deploying briefly restarts ucms-api/ucms-frontend/ucms-admin.",
              );
            }
            if (baseTierChanged) {
              raise("caution");
              reasons.push(
                "Touches docker-compose/Caddyfile/pgbouncer config — \"Pull latest & deploy\" only redeploys api/frontend/admin, it won't apply this. Review the change, then run \"Apply base-tier config\" separately afterwards.",
              );
            }
            if (migrationAdded) {
              reasons.push(
                "Includes a new DB migration — applied automatically on the next tenant request after deploy (every migration here is additive/idempotent, safe to run unattended).",
              );
            }
            if (diskPct !== null && diskPct >= 85) {
              raise("caution");
              reasons.push(`Disk is at ${diskPct}% used — a fresh image build may not have enough room.`);
            }
            if (verdict === "safe") {
              reasons.push(
                "Routine update — zero-downtime blue-green deploy (new color is built, test-gated, health-checked, and smoke-tested before traffic switches; the old color stays up for instant rollback).",
              );
            }
            cb({
              commitsBehind: updateInfo.commitsBehind,
              commits: updateInfo.commits,
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

// Edge-triggered on remoteSha the same way service up/down and disk-threshold alerts are above —
// fires once when a new HEAD first appears on origin/main, not on every single poll while it's
// still there unpulled. Piggybacks the existing ALERT_WEBHOOK_URL wiring (sendAlert no-ops when
// unset), so this needs no new secret/config beyond what alerting already asks for.
function pollForUpdateAlert() {
  getRemoteUpdateInfo((info) => {
    if (!info || info.commitsBehind === 0) return;
    if (info.remoteSha === lastAlertedRemoteSha) return;
    lastAlertedRemoteSha = info.remoteSha;
    sendAlert(
      `[usim_cms/${PUBLIC_HOST}] ${info.commitsBehind} update(s) available on main:\n` +
        info.commits.slice(0, 5).join("\n"),
    );
  });
}
function pollForAlerts() {
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
  });
}

function handleSites(req, res) {
  getSitesUsage((sites) => sendJson(res, 200, { sites }));
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

const TRIAL_FILES_SH = TRIAL_FILES.join(" ");

// git pull + rebuild + redeploy takes a while — run detached, log to a
// file, and let the dashboard poll /api/pull/status + /api/pull/log instead
// of holding the HTTP request open.
function handlePull(req, res) {
  if (deployState.running) return sendJson(res, 409, { error: "a deploy is already running" });
  deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
  const logFd = fs.openSync(DEPLOY_LOG, "a");
  fs.writeSync(logFd, `\n\n=== deploy started ${deployState.startedAt} ===\n`);

  const pullStep = "git fetch origin && git reset --hard origin/main";
  const script =
    DEPLOY_MODE === "docker"
      ? `
    set -e
    echo "--- git pull ---"
    ${pullStep}
    # Distinguishes "pre-launch trial" (docker-compose.trial.yml's single
    # api/frontend/admin containers, no Caddy in front) from "gone live"
    # (scripts/deploy.sh's blue-green flow, Caddy fronting 80/443) from
    # what's actually running right now, checked right here rather than
    # earlier in this process — .deploy-color can't be trusted for this
    # (written once by deploy.sh's first promote, never cleared, so a box
    # rolled back to trial containers by hand still has a stale one), and
    # checking any earlier than the instant before acting on it would
    # reopen the same check-then-act gap this line is closing.
    if [ -n "$(docker compose ${TRIAL_FILES_SH} ps -q api)" ]; then
      echo "--- trial rebuild (no Caddy/proxy touched — see docker-compose.trial.yml) ---"
      docker compose ${TRIAL_FILES_SH} up -d --build api frontend admin
    else
      echo "--- blue-green deploy (zero-downtime, see scripts/deploy.sh) ---"
      bash scripts/deploy.sh
    fi
    echo "--- restarting monitor ---"
    systemctl restart ucms-monitor
    echo "--- done ---"
  `
      : `
    set -e
    NODE_DIR="$(dirname "${NODE_BIN}")"
    export PATH="$NODE_DIR:$PATH"
    "$NODE_DIR/corepack" enable
    echo "--- git pull ---"
    ${pullStep}
    echo "--- pnpm install ---"
    pnpm install --frozen-lockfile
    echo "--- build api ---"
    pnpm --filter @ucms/api build
    echo "--- build admin ---"
    VITE_API_URL="http://${PUBLIC_HOST}:${API_PORT}" VITE_FRONTEND_URL="http://${PUBLIC_HOST}:${FRONTEND_PORT}" \\
      pnpm --filter @ucms/admin build
    echo "--- build frontend ---"
    API_URL="http://127.0.0.1:${API_PORT}" pnpm --filter @ucms/frontend build
    echo "--- restarting services ---"
    systemctl restart ucms-api ucms-frontend ucms-admin
    echo "--- restarting monitor ---"
    systemctl restart ucms-monitor
    echo "--- done ---"
  `;
  const child = spawn("sh", ["-c", script], {
    cwd: REPO_DIR,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  child.unref();
  child.on("exit", (code) => {
    deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
    fs.appendFileSync(DEPLOY_LOG, `=== deploy finished, exit ${code} ===\n`);
    fs.closeSync(logFd);
  });
  sendJson(res, 202, { ok: true, started: true });
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
    const logFd = fs.openSync(DEPLOY_LOG, "a");
    fs.writeSync(logFd, `\n\n=== rollback started ${deployState.startedAt} ===\n`);
    const child = spawn("bash", ["scripts/deploy.sh", "rollback"], {
      cwd: REPO_DIR,
      stdio: ["ignore", logFd, logFd],
      detached: true,
    });
    child.unref();
    child.on("exit", (code) => {
      deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
      fs.appendFileSync(DEPLOY_LOG, `=== rollback finished, exit ${code} ===\n`);
      fs.closeSync(logFd);
    });
    sendJson(res, 202, { ok: true, started: true });
  });
}

// Deliberately separate from handlePull/scripts/deploy.sh: db/proxy/
// pgbouncer/redis are the always-on "base" every blue/green color shares,
// so a normal redeploy must never touch them (that's the whole point of the
// split). This is the one-off manual step for when docker-compose.yml
// itself changed (e.g. a new mem_limit) — `up -d` only recreates a
// container whose own config actually changed, but any of these four is a
// single instance, so expect a few seconds of interruption per container
// recreated. Docker-mode only: systemd/bare-metal mode has no containers
// here at all.
function handleApplyBaseTier(req, res) {
  if (DEPLOY_MODE !== "docker") {
    return sendJson(res, 501, {
      error: "base-tier apply needs docker mode — this box runs systemd mode",
    });
  }
  if (deployState.running) return sendJson(res, 409, { error: "a deploy/rollback is already running" });
  deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
  const logFd = fs.openSync(DEPLOY_LOG, "a");
  fs.writeSync(logFd, `\n\n=== base-tier apply started ${deployState.startedAt} ===\n`);
  const script = `
    set -e
    echo "--- git pull ---"
    git fetch origin && git reset --hard origin/main
    echo "--- recreating db/proxy/pgbouncer/redis (only containers whose config actually changed are touched) ---"
    docker compose up -d db proxy pgbouncer redis
    echo "--- done ---"
  `;
  const child = spawn("sh", ["-c", script], {
    cwd: REPO_DIR,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  child.unref();
  child.on("exit", (code) => {
    deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
    fs.appendFileSync(DEPLOY_LOG, `=== base-tier apply finished, exit ${code} ===\n`);
    fs.closeSync(logFd);
  });
  sendJson(res, 202, { ok: true, started: true });
}

function handlePullStatus(req, res) {
  sendJson(res, 200, deployState);
}

function handlePullLog(req, res) {
  fs.readFile(DEPLOY_LOG, "utf8", (err, data) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err ? "(no deploy log yet)" : data.slice(-20_000));
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
      if (entry && isServiceUp(entry.State)) return done(true);
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

// POST /api/stack/:key/test — pulls the candidate image only, never touches
// the running container. Safe to call any time; the real risk (a bad image
// taking the service down) only happens in /update, which always
// health-checks and auto-rolls-back.
function handleStackTest(req, res, key) {
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
        if (err) return sendJson(res, 502, { ok: false, error: stderr || err.message });
        sendJson(res, 200, { ok: true, message: `pulled ${imageRef} — nothing restarted yet` });
      });
      return;
    }
    if (key === "pgbouncer") {
      getUpstreamLatest((latest) => {
        if (!latest.pgbouncer) return sendJson(res, 502, { error: "couldn't resolve latest PgBouncer tag" });
        const newRef = `edoburu/pgbouncer:${latest.pgbouncer}`;
        execFile("docker", ["pull", newRef], { timeout: 120_000 }, (err, stdout, stderr) => {
          if (err) return sendJson(res, 502, { ok: false, error: stderr || err.message });
          sendJson(res, 200, { ok: true, message: `pulled ${newRef} — nothing restarted yet` });
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
  if (key === "node") return handleNodeUpdate(req, res);
  if (key === "pnpm") return handlePnpmUpdate(req, res);

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
        const newRef = `edoburu/pgbouncer:${latest.pgbouncer}`;
        if (newRef === v.infra.pgbouncer) return sendJson(res, 400, { error: "already on the latest PgBouncer tag" });

        const composePath = path.join(REPO_DIR, "docker-compose.yml");
        let oldContent;
        try {
          oldContent = fs.readFileSync(composePath, "utf8");
        } catch (e) {
          return sendJson(res, 500, { error: `couldn't read docker-compose.yml: ${e.message}` });
        }
        const re = /^(\s*image:\s*)edoburu\/pgbouncer:\S+/m;
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
  const files = Object.keys(oldContents);
  deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
  const logFd = fs.openSync(DEPLOY_LOG, "a");
  fs.writeSync(logFd, `\n\n=== ${label} started ${deployState.startedAt} ===\n`);
  const quotedFiles = files.map((f) => `"${f}"`).join(" ");
  const script = `
    set -e
    ${preCommitScript || ""}
    echo "--- committing ${quotedFiles} ---"
    git add ${quotedFiles}
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
    echo "--- done ---"
  `;
  const child = spawn("sh", ["-c", script], { cwd: REPO_DIR, stdio: ["ignore", logFd, logFd], detached: true });
  child.unref();
  child.on("exit", (code) => {
    deployState = { ...deployState, running: false, exitCode: code, finishedAt: new Date().toISOString() };
    fs.appendFileSync(DEPLOY_LOG, `=== ${label} finished, exit ${code} ===\n`);
    if (code !== 0) {
      for (const [rel, oldContent] of Object.entries(oldContents)) {
        try {
          fs.writeFileSync(path.join(REPO_DIR, rel), oldContent, "utf8");
        } catch {}
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
    } catch {}

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
    // plain npm install, not subject to corepack's own broken check.
    // COREPACK_INTEGRITY_KEYS=0 stays only as a last-resort fallback, scoped
    // to this one command (not exported for the whole script), in case the
    // self-update itself can't run. Neither touches the Docker build — each
    // Dockerfile's own `corepack enable` runs its own, separately current
    // corepack from that image's node:*-alpine base.
    const preCommit = `
    NODE_DIR="$(dirname "${NODE_BIN}")"
    export PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
    echo "--- updating corepack (old bundled corepack can carry stale npm signing keys) ---"
    npm install -g corepack@latest >/dev/null 2>&1 || echo "corepack self-update failed, continuing with bundled corepack"
    "$NODE_DIR/corepack" enable >/dev/null 2>&1 || true
    echo "--- regenerating pnpm-lock.yaml for pnpm@${latest.pnpm} ---"
    pnpm install --lockfile-only || COREPACK_INTEGRITY_KEYS=0 pnpm install --lockfile-only
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
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
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

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>usim_cms monitor</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  h3 { margin-top: 1.6rem; }
  button { cursor: pointer; padding: 0.3rem 0.7rem; margin: 0.15rem 0.15rem 0.15rem 0; border-radius: 6px; border: 1px solid #8884; background: #0071e3; color: #fff; font-size: 0.85rem; }
  button.secondary { background: transparent; color: inherit; }
  button.danger { background: #d32f2f; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .muted { opacity: 0.7; font-size: 0.85rem; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.7rem; margin: 0.8rem 0; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 0.6rem 0.8rem; }
  .card .label { font-size: 0.72rem; opacity: 0.65; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 1.1rem; font-weight: 600; margin: .15rem 0 .4rem; }
  .meter { height: 8px; border-radius: 999px; background: #8882; overflow: hidden; }
  .meter > span { display: block; height: 100%; border-radius: 999px; transition: width .5s; }
  .meter.ok > span { background: #2e7d32; }
  .meter.warn > span { background: #f9a825; }
  .meter.bad > span { background: #d32f2f; }

  .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.7rem; margin: 0.6rem 0; }
  .svc-card { border: 1px solid #8884; border-radius: 10px; padding: 0.7rem 0.8rem; }
  .svc-head { display: flex; align-items: center; gap: 0.45rem; margin-bottom: 0.3rem; }
  .svc-head b { font-size: 0.95rem; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; background: #8888; flex: none; }
  .dot.up { background: #2e7d32; box-shadow: 0 0 6px #2e7d3299; }
  .dot.down { background: #d32f2f; box-shadow: 0 0 6px #d32f2f99; }
  .history { display: flex; gap: 2px; margin: 0.4rem 0; }
  .history span { width: 6px; height: 14px; border-radius: 2px; background: #8884; }
  .history span.up { background: #2e7d32; }
  .history span.down { background: #d32f2f; }

  .term { background: #0d1117; color: #c9d1d9; border-radius: 8px; padding: 0.75rem; max-height: 300px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; white-space: pre-wrap; }
  .t-head { color: #79c0ff; }
  .t-head2 { color: #d2a8ff; font-weight: 600; }
  .t-err { color: #ff7b72; }
  .t-ok { color: #7ee787; }

  .progress-track { height: 6px; border-radius: 999px; background: #8882; overflow: hidden; margin: .5rem 0; }
  .progress-fill { height: 100%; width: 0; border-radius: 999px; background: #0071e3; }
  .progress-fill.running { width: 40%; animation: indet 1.1s ease-in-out infinite; transform-origin: left; }
  .progress-fill.success { width: 100%; background: #2e7d32; }
  .progress-fill.fail { width: 100%; background: #d32f2f; }
  @keyframes indet { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }

  .tabs { display: flex; gap: 0.2rem; margin: 1.2rem 0 0; border-bottom: 1px solid #8884; overflow-x: auto; }
  .tab-btn { background: transparent; color: inherit; border: none; border-radius: 8px 8px 0 0; padding: 0.5rem 0.9rem; font-size: 0.85rem; font-weight: 500; opacity: 0.6; margin: 0; white-space: nowrap; }
  .tab-btn:hover { opacity: 0.9; background: #8882; }
  .tab-btn.active { opacity: 1; background: #8883; font-weight: 600; }
  .tab-panel { display: none; padding-top: 1rem; }
  .tab-panel.active { display: block; }

  .role-badge { display: inline-block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: 0.12rem 0.5rem; border-radius: 999px; background: #0071e322; color: #0071e3; white-space: nowrap; }
  .container-desc { max-width: 340px; }
</style>
</head>
<body>
<h1>usim_cms — server monitor</h1>
<p class="muted" id="mode">loading…</p>
<p class="muted" id="uptime"></p>

<div id="updateBanner" style="display:none; margin: 0.8rem 0; padding: 0.6rem 0.9rem; border-radius: 8px; background: #f9a825; color: #1a1a1a;"></div>

<div class="tabs" id="tabs">
  <button class="tab-btn active" data-tab="overview" onclick="switchTab('overview')">Overview</button>
  <button class="tab-btn" data-tab="stack" onclick="switchTab('stack')">Stack &amp; versions</button>
  <button class="tab-btn" data-tab="containers" onclick="switchTab('containers')">Containers</button>
  <button class="tab-btn" data-tab="data" onclick="switchTab('data')">Database &amp; Sites</button>
  <button class="tab-btn" data-tab="ssl" onclick="switchTab('ssl')">SSL</button>
  <button class="tab-btn" data-tab="logs" onclick="switchTab('logs')">Logs</button>
</div>

<div class="tab-panel active" id="panel-overview">
  <div class="grid" id="hostGrid"></div>

  <div class="row">
    <button onclick="pull()">Pull latest &amp; deploy</button>
    <button class="secondary" onclick="rollback()">Rollback</button>
    <button class="secondary" onclick="applyBaseTier()">Apply base-tier config (db/proxy/pgbouncer/redis)</button>
    <button class="secondary" onclick="restartAll()">Restart all</button>
    <button class="secondary" onclick="refresh()">Refresh now</button>
  </div>
  <p class="muted" id="deployState"></p>
  <div class="progress-track" id="deployTrack" style="display:none"><div class="progress-fill" id="deployFill"></div></div>
  <pre class="term" id="deployLog" style="display:none"></pre>

  <h3>Services</h3>
  <div class="services-grid" id="services"></div>
</div>

<div class="tab-panel" id="panel-stack">
  <h3>Tech stack &amp; versions</h3>
  <p class="muted" id="versionGitLine"></p>
  <div class="grid" id="versionGrid"></div>
</div>

<div class="tab-panel" id="panel-containers">
  <h3>All containers (system-wide, every compose project)</h3>
  <p class="muted">Unlike Services (which only ever asks about this repo's base project + whichever blue/green color is currently promoted), this is a plain <code>docker ps -a</code> — it shows a leftover trial-mode or otherwise-orphaned container too, which could still be answering real traffic and re-writing the frontend's Redis html-cache with stale output even right after a normal deploy.</p>
  <p id="containersWarning" style="display:none; margin: 0.5rem 0; padding: 0.5rem 0.8rem; border-radius: 8px; background: #b45309; color: #fff; font-weight: 600;"></p>
  <table id="containersTable" style="width:100%; border-collapse: collapse;">
    <thead>
      <tr class="muted" style="text-align:left; font-size:0.72rem; text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid #8884;">
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Container</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Role</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">What it does</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Status</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Image</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Created</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</div>

<div class="tab-panel" id="panel-data">
  <h3>Database</h3>
  <div class="row">
    <span class="dot" id="dbDot"></span>
    <span class="muted" id="dbStatus">checking…</span>
    <button class="secondary" id="dbRestartBtn" onclick="dbRestart()">Restart DB</button>
  </div>

  <h3>Sites (uploads folder size per tenant)</h3>
  <p class="muted">Folder name is the tenant's slug (lowercase, non-alphanumeric replaced with <code>_</code>), not its full hostname — this dashboard has no database access to translate it back.</p>
  <table id="sitesTable" style="width:100%; border-collapse: collapse;"><tbody></tbody></table>
</div>

<div class="tab-panel" id="panel-ssl">
  <h3>SSL (certbot)</h3>
  <p class="muted">Issues/renews a Let's Encrypt cert for a domain already pointed at this box's nginx — requires certbot + the nginx plugin installed on the host (<code>apt install certbot python3-certbot-nginx</code>). Renewal is handled by certbot's own installed timer, not this dashboard.</p>
  <div class="row">
    <input id="sslDomain" placeholder="admin.example.com" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
    <input id="sslEmail" placeholder="admin@example.com" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
    <button onclick="issueSsl()">Issue certificate</button>
  </div>
  <pre class="term" id="sslLog" style="display:none"></pre>
</div>

<div class="tab-panel" id="panel-logs">
  <h3>Logs</h3>
  <div class="row" id="logButtons"></div>
  <pre class="term" id="logs">Pick a service above to view its logs.</pre>
</div>

<p id="git" style="opacity:0.35; font-size:0.7rem; margin-top:2rem;"></p>

<script>
let SERVICES = [];
let DB_MANAGED = true;
let history = {};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof body === "string" ? body : (body.error || res.statusText));
  return body;
}

function switchTab(name) {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("active", panel.id === "panel-" + name);
  }
}

function pctClass(pct) {
  if (pct >= 90) return "bad";
  if (pct >= 70) return "warn";
  return "ok";
}

function meterCard(label, pct, sub) {
  const cls = pctClass(pct);
  return "<div class=\\"card\\"><div class=\\"label\\">" + label + "</div>" +
    "<div class=\\"value\\">" + pct + "% <span class=\\"muted\\">" + sub + "</span></div>" +
    "<div class=\\"meter " + cls + "\\"><span style=\\"width:" + pct + "%\\"></span></div></div>";
}

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

async function refreshSites() {
  try {
    const data = await api("/api/sites");
    const tbody = document.querySelector("#sitesTable tbody");
    tbody.innerHTML = "";
    const sites = data.sites || [];
    if (!sites.length) {
      tbody.innerHTML = "<tr><td class=\\"muted\\">No uploads folders found yet.</td></tr>";
      return;
    }
    const max = Math.max(...sites.map((s) => s.bytes), 1);
    for (const s of sites) {
      const tr = document.createElement("tr");
      const pct = Math.round((s.bytes / max) * 100);
      tr.innerHTML =
        "<td style=\\"padding:0.25rem 0.5rem 0.25rem 0; white-space:nowrap;\\">" + escapeHtml(s.folder) + "</td>" +
        "<td style=\\"padding:0.25rem 0.5rem; width:100%;\\"><div class=\\"meter ok\\"><span style=\\"width:" + pct + "%\\"></span></div></td>" +
        "<td style=\\"padding:0.25rem 0 0.25rem 0.5rem; white-space:nowrap; text-align:right;\\" class=\\"muted\\">" + formatBytes(s.bytes) + "</td>";
      tbody.appendChild(tr);
    }
  } catch (e) {
    document.querySelector("#sitesTable tbody").innerHTML = "<tr><td class=\\"muted\\">Error: " + escapeHtml(e.message) + "</td></tr>";
  }
}

// What each container role actually does — plain-language, for whoever's
// reading this tab without the rest of this codebase's own context. Matched
// by substring against name+image (order matters: first match wins), not an
// exact map, since a name always carries a "ucms-<color>-" or "usim_cms-"
// prefix and a "-N" replica suffix this can't predict in full.
const CONTAINER_INFO = [
  { match: /admin/i, role: "Admin panel", desc: "The CMS editor UI (Designer, pages, media library) staff log into to manage content." },
  { match: /frontend/i, role: "Public website", desc: "Renders the actual live site every visitor sees — the published pages." },
  { match: /(^|[^a-z])api([^a-z]|$)/i, role: "Backend API", desc: "Handles data, auth, and business logic for both the admin panel and the public site." },
  { match: /caddy|proxy/i, role: "Reverse proxy", desc: "Routes incoming HTTP/HTTPS traffic to the right container and terminates SSL certificates." },
  { match: /pgbouncer/i, role: "Connection pooler", desc: "Sits in front of Postgres so many short-lived requests share a small pool of real DB connections." },
  { match: /postgres|(^|[^a-z])db([^a-z]|$)/i, role: "Database", desc: "Postgres — the source of truth for every tenant's pages, posts, media, and settings." },
  { match: /redis/i, role: "Cache", desc: "Speeds up repeated page loads (rendered-HTML cache) and backs cross-replica rate limiting." },
];
function describeContainer(c) {
  const haystack = String(c.Names || c.Name || "") + " " + String(c.Image || "");
  for (const entry of CONTAINER_INFO) {
    if (entry.match.test(haystack)) return entry;
  }
  return { role: "—", desc: "—" };
}

// Flags any base name (Names with a trailing "-N" replica suffix stripped)
// that shows up more than once — the signal an orphaned container (trial
// mode, an old un-stopped blue/green color, or anything started outside
// compose entirely) is still alive alongside the one Services above thinks
// is the only frontend/api/admin running. Built entirely with DOM methods
// (createElement/textContent), not innerHTML string-concat — this whole
// file's DASHBOARD_HTML is itself one big template literal, so a raw \\"
// inside a string built here has already broken this dashboard once (its
// backslash gets eaten by that OUTER template literal before the browser
// ever sees this code) — textContent has no such nesting hazard at all.
function renderContainers(containers) {
  const tbody = document.querySelector("#containersTable tbody");
  const warn = document.getElementById("containersWarning");
  tbody.textContent = "";
  if (!containers.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "muted";
    td.textContent = "No containers found (or docker ps failed).";
    tr.appendChild(td);
    tbody.appendChild(tr);
    warn.style.display = "none";
    return;
  }
  const baseCounts = {};
  for (const c of containers) {
    const base = String(c.Names || c.Name || "").replace(/-\d+$/, "");
    baseCounts[base] = (baseCounts[base] || 0) + 1;
  }
  const dupes = Object.keys(baseCounts).filter((b) => baseCounts[b] > 1);
  if (dupes.length) {
    warn.style.display = "block";
    warn.textContent = "⚠ More than one container shares a base name — possible orphan: " + dupes.join(", ");
  } else {
    warn.style.display = "none";
  }
  const cell = (text, opts) => {
    const td = document.createElement("td");
    td.style.padding = "0.35rem 0.6rem 0.35rem 0";
    td.style.verticalAlign = "top";
    if (opts && opts.muted) td.className = "muted";
    if (opts && opts.nowrap) td.style.whiteSpace = "nowrap";
    if (opts && opts.maxWidth) td.style.maxWidth = opts.maxWidth;
    td.textContent = text;
    return td;
  };
  for (const c of containers) {
    const name = String(c.Names || c.Name || "");
    const base = name.replace(/-\d+$/, "");
    const info = describeContainer(c);
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #8882";
    if (baseCounts[base] > 1) tr.style.background = "#b4530933";
    tr.appendChild(cell(name, { nowrap: true }));
    const roleTd = document.createElement("td");
    roleTd.style.padding = "0.35rem 0.6rem 0.35rem 0";
    roleTd.style.verticalAlign = "top";
    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = info.role;
    roleTd.appendChild(badge);
    tr.appendChild(roleTd);
    tr.appendChild(cell(info.desc, { muted: true, maxWidth: "340px" }));
    tr.appendChild(cell(String(c.Status || c.State || ""), { muted: true, nowrap: true }));
    tr.appendChild(cell(String(c.Image || ""), { muted: true, nowrap: true }));
    tr.appendChild(cell(String(c.RunningFor || c.CreatedAt || ""), { muted: true, nowrap: true }));
    tbody.appendChild(tr);
  }
}

function renderHost(host) {
  const grid = document.getElementById("hostGrid");
  if (!host) { grid.innerHTML = ""; return; }
  let html = "";
  if (host.disk) html += meterCard("Disk /", host.disk.pct, host.disk.used + " / " + host.disk.total);
  if (host.mem) html += meterCard("Memory", host.mem.pct, host.mem.usedMB + "MB / " + host.mem.totalMB + "MB");
  grid.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function colorizeLog(text) {
  const lines = escapeHtml(text).split("\\n");
  return lines
    .map((line) => {
      let cls = "";
      if (/^===/.test(line)) cls = "t-head2";
      else if (/^---/.test(line)) cls = "t-head";
      else if (/error/i.test(line)) cls = "t-err";
      else if (/done|finished|success/i.test(line)) cls = "t-ok";
      return cls ? "<span class=\\"" + cls + "\\">" + line + "</span>" : line;
    })
    .join("\\n");
}

function statusDot(s) {
  const up = /running|healthy|active/i.test(s.State || s.Health || "");
  const span = document.createElement("span");
  span.className = "dot " + (up ? "up" : "down");
  return { up, el: span };
}

function pushHistory(name, up) {
  if (!history[name]) history[name] = [];
  history[name].push(up ? 1 : 0);
  if (history[name].length > 24) history[name].shift();
}

function historyEl(name) {
  const wrap = document.createElement("div");
  wrap.className = "history";
  for (const v of history[name] || []) {
    const span = document.createElement("span");
    span.className = v ? "up" : "down";
    wrap.appendChild(span);
  }
  return wrap;
}

function actionButton(label, name, action, secondary) {
  const b = document.createElement("button");
  if (secondary) b.className = "secondary";
  b.textContent = label;
  b.onclick = () => act(name, action);
  return b;
}

async function init() {
  const cfg = await api("/api/config");
  SERVICES = cfg.services;
  DB_MANAGED = cfg.dbManaged;
  document.getElementById("mode").textContent = "Mode: " + cfg.mode;
  document.getElementById("dbRestartBtn").style.display = DB_MANAGED ? "" : "none";
  const logButtons = document.getElementById("logButtons");
  for (const name of SERVICES) {
    const b = document.createElement("button");
    b.className = "secondary";
    b.textContent = name;
    b.onclick = () => showLogs(name);
    logButtons.appendChild(b);
  }
  refresh();
  refreshDb();
  refreshSites();
  refreshUpdateCheck();
  refreshVersions();
  setInterval(refresh, 5000);
  setInterval(refreshDb, 10000);
  setInterval(refreshSites, 30000);
  setInterval(refreshUpdateCheck, 5 * 60000);
}

function checkLine(check) {
  if (!check) return "<div class=\\"muted\\">checking upstream…</div>";
  const color =
    check.status === "latest" ? "#2e7d32" : check.status === "outdated" ? "#d32f2f" : check.status === "behind" ? "#f9a825" : "#8888";
  return "<div class=\\"muted\\" style=\\"color:" + color + "\\">" + escapeHtml(check.note) + "</div>";
}

function versionCard(label, value, sub, check, checked, actions) {
  return "<div class=\\"card\\"><div class=\\"label\\">" + label + "</div>" +
    "<div class=\\"value\\" style=\\"font-size:0.95rem\\">" + escapeHtml(value || "unknown") + "</div>" +
    (sub ? "<div class=\\"muted\\">" + escapeHtml(sub) + "</div>" : "") +
    (checked ? checkLine(check) : "") + (actions || "") + "</div>";
}

// testable=false (Node/pnpm): the blue-green deploy itself builds+tests the
// new image before switching traffic, so there's no separate dry-run step —
// only an Update button. Everything else gets a Test button that only ever
// downloads/verifies, never touches the running container.
function stackActions(key, label, testable) {
  let html = "<div style=\\"margin-top:.5rem;display:flex;gap:.4rem;align-items:center;flex-wrap:wrap\\">";
  if (testable) {
    html += "<button class=\\"secondary\\" onclick=\\"stackTest('" + key + "', this)\\">Test</button>";
  }
  const safeLabel = label.replace(/'/g, "");
  html += "<button class=\\"secondary\\" onclick=\\"stackUpdate('" + key + "', '" + safeLabel + "', this)\\">Update</button>";
  html += "<span class=\\"muted\\" id=\\"stackMsg-" + key + "\\"></span>";
  html += "</div>";
  return html;
}

let lastVersionsData = null;

function renderStackTab(v, checks) {
  let html = "";
  html += versionCard("App (git is the real version)", v.appVersion);
  html += versionCard("pnpm", v.pnpm, null, checks && checks.pnpm, true, stackActions("pnpm", "pnpm", false));
  html += versionCard(
    "Node.js",
    v.node.runtime,
    v.node.dockerImage ? "container base: " + v.node.dockerImage : "",
    checks && checks.node,
    !!v.node.dockerImage,
    v.node.dockerImage ? stackActions("node", "Node base image", false) : "",
  );
  html += versionCard("API package", v.packages.api);
  html += versionCard("Admin package", v.packages.admin);
  html += versionCard("Frontend package", v.packages.frontend);
  if (v.infra.db) {
    html += versionCard("PostgreSQL", v.infra.db, null, checks && checks.postgres, true, stackActions("postgres", "PostgreSQL patch refresh", true));
  }
  if (v.infra.redis) {
    html += versionCard("Redis", v.infra.redis, null, checks && checks.redis, true, stackActions("redis", "Redis patch refresh", true));
  }
  if (v.infra.pgbouncer) {
    html += versionCard("PgBouncer", v.infra.pgbouncer, null, checks && checks.pgbouncer, true, stackActions("pgbouncer", "PgBouncer", true));
  }
  if (v.infra.proxy) {
    html += versionCard("Caddy (proxy)", v.infra.proxy, null, checks && checks.caddy, true, stackActions("caddy", "Caddy patch refresh", true));
  }
  document.getElementById("versionGrid").innerHTML = html;
}

async function stackTest(key, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Testing…";
  const msg = document.getElementById("stackMsg-" + key);
  if (msg) {
    msg.style.color = "";
    msg.textContent = "pulling image…";
  }
  try {
    const r = await api("/api/stack/" + key + "/test", { method: "POST" });
    if (msg) {
      msg.style.color = "#2e7d32";
      msg.textContent = "✓ " + (r.message || "test passed");
    }
  } catch (e) {
    if (msg) {
      msg.style.color = "#d32f2f";
      msg.textContent = "✗ " + e.message;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// Looks the status/message elements up fresh on every tick (not captured
// once up front) because a finished update makes refreshVersions() re-render
// the whole grid (see pollDeployLog) — the old button/span this click came
// from is gone by then, but an element with the same id always exists in
// whatever's currently on screen.
async function pollStackMsg(key, label) {
  const tick = async () => {
    const msg = document.getElementById("stackMsg-" + key);
    try {
      const st = await api("/api/pull/status");
      if (st.running) {
        if (msg) msg.textContent = "updating " + label + "… (see Overview tab for the live log)";
        setTimeout(tick, 2000);
      } else if (msg) {
        msg.style.color = st.exitCode === 0 ? "#2e7d32" : "#d32f2f";
        msg.textContent = st.exitCode === 0 ? "✓ updated" : "✗ failed (exit " + st.exitCode + ") — see Overview tab log";
      }
    } catch (e) {
      setTimeout(tick, 2000);
    }
  };
  tick();
}

async function stackUpdate(key, label, btn) {
  if (!confirm(
    "Update " + label + " now?\\n\\nThis pulls the new version, recreates the service, health-checks it, " +
    "and automatically rolls back to what's running now if it doesn't come up healthy.",
  )) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "Updating…";
  const msg = document.getElementById("stackMsg-" + key);
  if (msg) {
    msg.style.color = "";
    msg.textContent = "starting…";
  }
  try {
    await api("/api/stack/" + key + "/update", { method: "POST" });
    pollDeployLog();
    refresh();
    pollStackMsg(key, label);
  } catch (e) {
    if (msg) {
      msg.style.color = "#d32f2f";
      msg.textContent = "✗ " + e.message;
    }
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function refreshVersions() {
  try {
    const v = await api("/api/versions");
    lastVersionsData = v;
    renderStackTab(v, null);
    refreshVersionChecks();
  } catch (e) {
    document.getElementById("versionGrid").innerHTML = "<p class=\\"muted\\">Error: " + escapeHtml(e.message) + "</p>";
  }
}

async function refreshVersionChecks() {
  if (!lastVersionsData) return;
  try {
    const r = await api("/api/version-checks");
    renderStackTab(lastVersionsData, r.checks);
  } catch (e) {
    // best-effort — static version cards are already shown, upstream check just stays "checking…"
  }
}

async function refreshUpdateCheck() {
  const el = document.getElementById("updateBanner");
  try {
    const info = await api("/api/update-check");
    if (info.commitsBehind > 0) {
      el.style.display = "block";
      el.innerHTML =
        "🔔 <b>" + info.commitsBehind + " update" + (info.commitsBehind > 1 ? "s" : "") + " available</b> " +
        "— click &quot;Pull latest &amp; deploy&quot; below to update (runs tests, health-checks before switching traffic, keeps the old version ready for one-click Rollback).<br>" +
        "<span style=\\"font-size:0.8rem;opacity:0.85\\">" + info.commits.slice(0, 5).map(escapeHtml).join("<br>") + "</span>";
    } else {
      el.style.display = "none";
    }
  } catch (e) {
    // git fetch failed (offline/GitHub down) — not alert-worthy on the dashboard itself,
    // pollForUpdateAlert server-side already treats this as "unknown", same here.
    el.style.display = "none";
  }
}

async function refresh() {
  try {
    const data = await api("/api/status");
    document.getElementById("git").textContent = "HEAD: " + (data.git || "unknown");
    document.getElementById("versionGitLine").textContent = "Git HEAD: " + (data.git || "unknown");
    document.getElementById("uptime").textContent = data.host && data.host.uptime ? data.host.uptime : "";
    renderHost(data.host);
    const grid = document.getElementById("services");
    grid.innerHTML = "";
    const byName = {};
    for (const s of data.services || []) byName[s.Service || s.Name] = s;
    for (const name of SERVICES) {
      const s = byName[name] || {};
      const d = statusDot(s);
      pushHistory(name, d.up);
      const card = document.createElement("div");
      card.className = "svc-card";
      const head = document.createElement("div");
      head.className = "svc-head";
      const b = document.createElement("b");
      b.textContent = name;
      head.appendChild(d.el);
      head.appendChild(b);
      card.appendChild(head);
      const state = document.createElement("div");
      state.className = "muted";
      state.textContent = (s.State || "unknown") + (s.Health ? " (" + s.Health + ")" : "");
      card.appendChild(state);
      card.appendChild(historyEl(name));
      const actions = document.createElement("div");
      actions.className = "row";
      actions.appendChild(actionButton("Restart", name, "restart", false));
      actions.appendChild(actionButton("Stop", name, "stop", true));
      actions.appendChild(actionButton("Start", name, "start", true));
      card.appendChild(actions);
      grid.appendChild(card);
    }
    renderContainers(data.containers || []);
    const d = data.deploy;
    const track = document.getElementById("deployTrack");
    const fill = document.getElementById("deployFill");
    document.getElementById("deployState").textContent = d.running
      ? "Deploy running since " + d.startedAt + "…"
      : d.finishedAt
        ? "Last deploy: exit " + d.exitCode + " at " + d.finishedAt
        : "No deploy run yet.";
    if (d.running) {
      track.style.display = "block";
      fill.className = "progress-fill running";
      pollDeployLog();
    } else if (d.finishedAt) {
      track.style.display = "block";
      fill.className = "progress-fill " + (d.exitCode === 0 ? "success" : "fail");
    } else {
      track.style.display = "none";
    }
  } catch (e) {
    document.getElementById("git").textContent = "Error: " + e.message;
  }
}

async function refreshDb() {
  try {
    const d = await api("/api/db/status");
    document.getElementById("dbDot").className = "dot " + (d.ok ? "up" : "down");
    document.getElementById("dbStatus").textContent = (d.ok ? "up — " : "down — ") + (d.output || "");
  } catch (e) {
    document.getElementById("dbStatus").textContent = "Error: " + e.message;
  }
}

async function dbRestart() {
  try {
    await api("/api/db/restart", { method: "POST" });
    setTimeout(refreshDb, 1500);
  } catch (e) {
    alert(e.message);
  }
}

async function act(name, action) {
  try {
    await api("/api/service/" + name + "/" + action, { method: "POST" });
    setTimeout(refresh, 1500);
  } catch (e) {
    alert(e.message);
  }
}

async function restartAll() {
  for (const name of SERVICES) await act(name, "restart");
}

async function pull() {
  let pre = null;
  try {
    pre = await api("/api/preflight");
  } catch (e) {
    if (!confirm("Could not run the pre-update safety check (" + e.message + "). Proceed anyway?")) return;
  }
  if (pre) {
    if (pre.verdict === "up-to-date") {
      if (!confirm("Already on the latest commit — redeploy anyway?")) return;
    } else if (pre.verdict === "blocked") {
      alert("Update blocked:\\n\\n" + pre.reasons.join("\\n"));
      return;
    } else {
      const label = pre.verdict === "caution" ? "⚠ Needs attention" : "✓ Safe to update";
      const msg =
        label + " — " + pre.commitsBehind + " commit(s) behind origin/main:\\n\\n" +
        pre.reasons.join("\\n\\n") + "\\n\\nProceed with \\"Pull latest & deploy\\"?";
      if (!confirm(msg)) return;
    }
  }
  try {
    await api("/api/pull", { method: "POST" });
    pollDeployLog();
    refresh();
  } catch (e) {
    alert(e.message);
  }
}

async function rollback() {
  if (!confirm("Roll back to the previously deployed color? This flips live traffic to whatever was running before the last deploy.")) return;
  try {
    await api("/api/rollback", { method: "POST" });
    pollDeployLog();
    refresh();
  } catch (e) {
    alert(e.message);
  }
}

async function applyBaseTier() {
  if (!confirm("Recreate db/proxy/pgbouncer/redis to pick up a docker-compose.yml change? Each one that actually changed will briefly interrupt (a few seconds) — these aren't blue-green.")) return;
  try {
    await api("/api/base/apply", { method: "POST" });
    pollDeployLog();
    refresh();
  } catch (e) {
    alert(e.message);
  }
}

let polling = false;
async function pollDeployLog() {
  if (polling) return;
  polling = true;
  const pre = document.getElementById("deployLog");
  pre.style.display = "block";
  const tick = async () => {
    try {
      const log = await api("/api/pull/log");
      pre.innerHTML = colorizeLog(log);
      pre.scrollTop = pre.scrollHeight;
      const st = await api("/api/pull/status");
      if (st.running) {
        setTimeout(tick, 2000);
      } else {
        polling = false;
        refresh();
        refreshVersions();
      }
    } catch (e) {
      // The pull step restarts the monitor's own process, so a request can
      // briefly fail while it bounces — keep retrying instead of dying here.
      setTimeout(tick, 2000);
    }
  };
  tick();
}

async function issueSsl() {
  const domain = document.getElementById("sslDomain").value.trim();
  const email = document.getElementById("sslEmail").value.trim();
  const pre = document.getElementById("sslLog");
  pre.style.display = "block";
  pre.textContent = "Running certbot for " + domain + "…";
  try {
    const body = await api("/api/ssl/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, email }),
    });
    pre.innerHTML = colorizeLog("done\\n" + (body.stdout || "") + (body.stderr || ""));
  } catch (e) {
    pre.innerHTML = colorizeLog("error\\n" + e.message);
  }
}

async function showLogs(name) {
  document.getElementById("logs").textContent = "loading…";
  try {
    const text = await api("/api/logs/" + name + "?tail=300");
    document.getElementById("logs").innerHTML = colorizeLog(text);
  } catch (e) {
    document.getElementById("logs").textContent = "Error: " + e.message;
  }
}

init();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (!checkAuth(req)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="usim_cms monitor"',
      "Content-Type": "text/plain",
    });
    res.end("Auth required");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
    } else if (req.method === "GET" && url.pathname === "/api/config") {
      handleConfig(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/status") {
      handleStatus(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/sites") {
      handleSites(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/update-check") {
      handleUpdateCheck(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/versions") {
      handleVersions(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/version-checks") {
      handleVersionChecks(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/preflight") {
      handlePreflight(req, res);
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
    } else if (req.method === "POST" && url.pathname === "/api/base/apply") {
      handleApplyBaseTier(req, res);
    } else if (req.method === "POST" && parts[0] === "api" && parts[1] === "stack" && parts[2] && parts[3] === "test") {
      handleStackTest(req, res, parts[2]);
    } else if (req.method === "POST" && parts[0] === "api" && parts[1] === "stack" && parts[2] && parts[3] === "update") {
      handleStackUpdate(req, res, parts[2]);
    } else if (req.method === "GET" && url.pathname === "/api/pull/status") {
      handlePullStatus(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/pull/log") {
      handlePullLog(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/ssl/issue") {
      handleSslIssue(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/alerts/test") {
      handleAlertTest(req, res);
    } else {
      sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`usim_cms monitor listening on :${PORT} (repo: ${REPO_DIR}, mode: ${DEPLOY_MODE})`);
});

if (ALERT_WEBHOOK_URL) {
  console.log(`alerting enabled: polling every ${ALERT_POLL_INTERVAL_MS}ms`);
  setInterval(pollForAlerts, ALERT_POLL_INTERVAL_MS);
  pollForAlerts();
}

console.log(`update checks: polling origin/main every ${UPDATE_CHECK_INTERVAL_MS}ms`);
setInterval(pollForUpdateAlert, UPDATE_CHECK_INTERVAL_MS);
pollForUpdateAlert();
