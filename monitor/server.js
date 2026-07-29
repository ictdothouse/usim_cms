#!/usr/bin/env node
// Zero-dependency ops dashboard for the usim_cms docker-compose stack — no
// npm install, just Node's own builtins, so installing it never touches
// whatever package versions any other project on this VPS depends on.
// Started by install.sh as a systemd unit; see monitor/usim-cms-monitor.service.
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
// Whitelisted so a service name never reaches child_process from raw user
// input — every route validates against this array before shelling out.
const SERVICES = ["db", "api", "frontend", "admin"];

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
    (err, stdout, stderr) => {
      cb(err, stdout, stderr);
    },
  );
}

function getComposeStatus(cb) {
  runCompose(["ps", "--format", "json"], (err, stdout, stderr) => {
    if (err) return cb(err, null);
    // `docker compose ps --format json` emits one JSON object per line, not
    // a single array — has changed shape across Compose versions, so accept
    // both.
    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let services = [];
    try {
      if (lines.length === 1 && lines[0].startsWith("[")) {
        services = JSON.parse(lines[0]);
      } else {
        services = lines.map((l) => JSON.parse(l));
      }
    } catch {
      return cb(new Error(`could not parse compose ps output: ${stderr || stdout}`), null);
    }
    cb(null, services);
  });
}

function getGitInfo(cb) {
  execFile("git", ["log", "-1", "--format=%h %cI %s"], { cwd: REPO_DIR, timeout: 10_000 }, (err, stdout) => {
    cb(err ? null : stdout.trim());
  });
}

function getHostStats(cb) {
  execFile(
    "sh",
    ["-c", "df -h / | tail -1; echo ---; free -m | sed -n '2p'"],
    { timeout: 10_000 },
    (err, stdout) => {
      cb(err ? null : stdout.trim());
    },
  );
}

function handleStatus(req, res) {
  getComposeStatus((err, services) => {
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
  runCompose([action, name], (err, stdout, stderr) => {
    if (err) return sendJson(res, 500, { error: String(err.message || err), stderr });
    sendJson(res, 200, { ok: true, stdout, stderr });
  });
}

function handleLogs(req, res, name, tail) {
  if (!SERVICES.includes(name)) return sendJson(res, 400, { error: "unknown service" });
  const n = String(Math.min(Math.max(Number(tail) || 200, 1), 2000));
  execFile(
    "docker",
    ["compose", "logs", "--no-color", "--tail", n, name],
    { cwd: REPO_DIR, timeout: 20_000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      if (err && !stdout) return sendJson(res, 500, { error: String(err.message || err), stderr });
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(stdout || stderr || "(no output)");
    },
  );
}

function handleDbStatus(req, res) {
  execFile(
    "docker",
    ["compose", "exec", "-T", "db", "pg_isready", "-U", "postgres"],
    { cwd: REPO_DIR, timeout: 10_000 },
    (err, stdout, stderr) => {
      sendJson(res, 200, { ok: !err, output: (stdout || stderr || "").trim() });
    },
  );
}

// git pull + rebuild + redeploy takes a while (can involve a from-scratch
// docker build) — run detached, log to a file, and let the dashboard poll
// /api/pull/status + /api/pull/log instead of holding the HTTP request open.
function handlePull(req, res) {
  if (deployState.running) return sendJson(res, 409, { error: "a deploy is already running" });
  deployState = { running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null };
  const logFd = fs.openSync(DEPLOY_LOG, "a");
  fs.writeSync(logFd, `\n\n=== deploy started ${deployState.startedAt} ===\n`);
  const script = `
    set -e
    echo "--- git pull ---"
    git fetch origin
    git reset --hard origin/main
    echo "--- docker compose build ---"
    docker compose build
    echo "--- docker compose up -d ---"
    docker compose up -d db api frontend admin
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

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>usim_cms monitor</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #8884; font-size: 0.9rem; }
  button { cursor: pointer; padding: 0.3rem 0.7rem; margin: 0.15rem; border-radius: 6px; border: 1px solid #8884; background: #0071e3; color: #fff; font-size: 0.85rem; }
  button.secondary { background: transparent; color: inherit; }
  button.danger { background: #d32f2f; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  pre { background: #0002; padding: 0.75rem; border-radius: 8px; max-height: 300px; overflow: auto; font-size: 0.8rem; white-space: pre-wrap; }
  .row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .muted { opacity: 0.7; font-size: 0.85rem; }
  .badge { padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; }
  .badge.up { background: #2e7d3220; color: #2e7d32; }
  .badge.down { background: #d32f2f20; color: #d32f2f; }
</style>
</head>
<body>
<h1>usim_cms — server monitor</h1>
<p class="muted" id="git">loading…</p>
<p class="muted" id="host"></p>

<div class="row">
  <button onclick="pull()">Pull latest &amp; rebuild</button>
  <button class="secondary" onclick="restartAll()">Restart all</button>
  <button class="secondary" onclick="refresh()">Refresh now</button>
</div>
<p class="muted" id="deployState"></p>
<pre id="deployLog" style="display:none"></pre>

<table id="services"><tbody></tbody></table>

<h3>Logs</h3>
<div class="row" id="logButtons"></div>
<pre id="logs">Pick a service above to view its logs.</pre>

<script>
const SERVICES = ["db", "api", "frontend", "admin"];

async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof body === "string" ? body : (body.error || res.statusText));
  return body;
}

function statusBadge(s) {
  const up = /running|healthy/i.test(s.State || s.Health || "");
  const span = document.createElement("span");
  span.className = "badge " + (up ? "up" : "down");
  span.textContent = (s.State || "unknown") + (s.Health ? " (" + s.Health + ")" : "");
  return span;
}

function actionButton(label, name, action, secondary) {
  const b = document.createElement("button");
  if (secondary) b.className = "secondary";
  b.textContent = label;
  b.onclick = () => act(name, action);
  return b;
}

async function refresh() {
  try {
    const data = await api("/api/status");
    document.getElementById("git").textContent = "HEAD: " + (data.git || "unknown");
    document.getElementById("host").textContent = data.host ? data.host.replace(/\\n/g, " · ") : "";
    const tbody = document.querySelector("#services tbody");
    tbody.innerHTML = "";
    const byName = {};
    for (const s of data.services || []) byName[s.Service || s.Name] = s;
    for (const name of SERVICES) {
      const s = byName[name] || {};
      const tr = document.createElement("tr");
      const nameCell = document.createElement("td");
      const b = document.createElement("b");
      b.textContent = name;
      nameCell.appendChild(b);
      const statusCell = document.createElement("td");
      statusCell.appendChild(statusBadge(s));
      const actionsCell = document.createElement("td");
      actionsCell.className = "row";
      actionsCell.appendChild(actionButton("Restart", name, "restart", false));
      actionsCell.appendChild(actionButton("Stop", name, "stop", true));
      actionsCell.appendChild(actionButton("Start", name, "start", true));
      tr.append(nameCell, statusCell, actionsCell);
      tbody.appendChild(tr);
    }
    const d = data.deploy;
    document.getElementById("deployState").textContent = d.running
      ? "Deploy running since " + d.startedAt + "…"
      : d.finishedAt
        ? "Last deploy: exit " + d.exitCode + " at " + d.finishedAt
        : "No deploy run yet.";
    if (d.running) pollDeployLog();
  } catch (e) {
    document.getElementById("git").textContent = "Error: " + e.message;
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
    const log = await api("/api/pull/log");
    pre.textContent = log;
    pre.scrollTop = pre.scrollHeight;
    const st = await api("/api/pull/status");
    if (st.running) {
      setTimeout(tick, 2000);
    } else {
      polling = false;
      refresh();
    }
  };
  tick();
}

async function showLogs(name) {
  document.getElementById("logs").textContent = "loading…";
  try {
    document.getElementById("logs").textContent = await api("/api/logs/" + name + "?tail=300");
  } catch (e) {
    document.getElementById("logs").textContent = "Error: " + e.message;
  }
}

const logButtons = document.getElementById("logButtons");
for (const name of SERVICES) {
  const b = document.createElement("button");
  b.className = "secondary";
  b.textContent = name;
  b.onclick = () => showLogs(name);
  logButtons.appendChild(b);
}

refresh();
setInterval(refresh, 5000);
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
    } else if (req.method === "GET" && url.pathname === "/api/status") {
      handleStatus(req, res);
    } else if (req.method === "POST" && parts[0] === "api" && parts[1] === "service" && parts[3]) {
      handleServiceAction(req, res, parts[2], parts[3]);
    } else if (req.method === "GET" && parts[0] === "api" && parts[1] === "logs" && parts[2]) {
      handleLogs(req, res, parts[2], url.searchParams.get("tail"));
    } else if (req.method === "GET" && url.pathname === "/api/db/status") {
      handleDbStatus(req, res);
    } else if (req.method === "POST" && url.pathname === "/api/db/restart") {
      handleServiceAction(req, res, "db", "restart");
    } else if (req.method === "POST" && url.pathname === "/api/pull") {
      handlePull(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/pull/status") {
      handlePullStatus(req, res);
    } else if (req.method === "GET" && url.pathname === "/api/pull/log") {
      handlePullLog(req, res);
    } else {
      sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`usim_cms monitor listening on :${PORT} (repo: ${REPO_DIR})`);
});
