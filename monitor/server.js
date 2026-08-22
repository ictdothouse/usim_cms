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
"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

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

// Whitelisted so a service name never reaches child_process from raw user
// input — every route validates against this array before shelling out.
const SERVICES = DEPLOY_MODE === "docker" ? ["db", "api", "frontend", "admin"] : ["api", "frontend", "admin"];
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

function handleConfig(req, res) {
  sendJson(res, 200, {
    mode: DEPLOY_MODE,
    services: SERVICES,
    dbManaged: DEPLOY_MODE === "docker" ? true : DB_MANAGED,
  });
}

function handleStatus(req, res) {
  getStatus((err, services) => {
    if (err) return sendJson(res, 500, { error: String(err.message || err) });
    getGitInfo((git) => {
      getHostStats((host) => {
        sendJson(res, 200, { services, git, host, deploy: deployState });
      });
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

function handlePullStatus(req, res) {
  sendJson(res, 200, deployState);
}

function handlePullLog(req, res) {
  fs.readFile(DEPLOY_LOG, "utf8", (err, data) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err ? "(no deploy log yet)" : data.slice(-20_000));
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
</style>
</head>
<body>
<h1>usim_cms — server monitor</h1>
<p class="muted" id="mode">loading…</p>
<p class="muted" id="uptime"></p>

<div class="grid" id="hostGrid"></div>

<div class="row">
  <button onclick="pull()">Pull latest &amp; deploy</button>
  <button class="secondary" onclick="restartAll()">Restart all</button>
  <button class="secondary" onclick="refresh()">Refresh now</button>
</div>
<p class="muted" id="deployState"></p>
<div class="progress-track" id="deployTrack" style="display:none"><div class="progress-fill" id="deployFill"></div></div>
<pre class="term" id="deployLog" style="display:none"></pre>

<h3>Services</h3>
<div class="services-grid" id="services"></div>

<h3>Database</h3>
<div class="row">
  <span class="dot" id="dbDot"></span>
  <span class="muted" id="dbStatus">checking…</span>
  <button class="secondary" id="dbRestartBtn" onclick="dbRestart()">Restart DB</button>
</div>

<h3>SSL (certbot)</h3>
<p class="muted">Issues/renews a Let's Encrypt cert for a domain already pointed at this box's nginx — requires certbot + the nginx plugin installed on the host (<code>apt install certbot python3-certbot-nginx</code>). Renewal is handled by certbot's own installed timer, not this dashboard.</p>
<div class="row">
  <input id="sslDomain" placeholder="admin.example.com" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
  <input id="sslEmail" placeholder="admin@example.com" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
  <button onclick="issueSsl()">Issue certificate</button>
</div>
<pre class="term" id="sslLog" style="display:none"></pre>

<h3>Logs</h3>
<div class="row" id="logButtons"></div>
<pre class="term" id="logs">Pick a service above to view its logs.</pre>

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
  setInterval(refresh, 5000);
  setInterval(refreshDb, 10000);
}

async function refresh() {
  try {
    const data = await api("/api/status");
    document.getElementById("git").textContent = "HEAD: " + (data.git || "unknown");
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
  try {
    await api("/api/pull", { method: "POST" });
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
    } else if (req.method === "GET" && url.pathname === "/api/pull/status") {
      handlePullStatus(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/pull/log") {
      handlePullLog(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/ssl/issue") {
      handleSslIssue(req, res);
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
