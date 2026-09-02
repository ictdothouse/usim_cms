#!/usr/bin/env bash
# One-shot installer for a test/staging VPS. Safe to re-run.
# Supports Debian-family (Ubuntu/Debian, apt/ufw) and RHEL-family
# (AlmaLinux/Rocky/RHEL/CentOS Stream, dnf/firewalld) hosts — detected
# automatically from /etc/os-release, no flag needed.
#
# Three modes, chosen with --mode=docker|production|bare-metal, $INSTALL_MODE,
# or (if neither is set and this is an interactive terminal) a prompt:
#
#   docker      Trial/quick-test stack: db+api+frontend+admin in containers,
#               published on auto-picked host ports (http://<ip>:<port>), no
#               Caddy, no zero-downtime deploys. Good for kicking the tires;
#               not the production topology — see "production" below.
#
#   production  The real, zero-downtime topology this repo is built around:
#               db+pgbouncer+redis+proxy(Caddy) as an always-on base, api/
#               frontend/admin blue-green deployed on top via scripts/
#               deploy.sh, routed by real domains through Caddy (auto-HTTPS
#               unless port 80/443 already belongs to another app on this
#               VPS, detected automatically — see ensure_caddy_bind_ports).
#               Nothing except 80/443 (or nothing at all, if those are
#               shared) and the monitor port ever gets published to the host.
#
#   bare-metal  Native Node processes + a native/reused PostgreSQL cluster,
#               for orgs that don't want Docker at all. Still fully
#               conflict-safe: it never installs Node into the system PATH
#               (a private, pinned Node runtime is downloaded to
#               /opt/ucms/node and referenced by absolute path only) and
#               it reuses an already-running Postgres cluster instead of
#               installing a second one (creates its own database + role
#               inside it — this is exactly the same "one Postgres server,
#               many databases" model apps/api already uses per tenant).
#
# All modes: detect the public IP so the admin build's baked-in API URL is
# actually reachable from a browser, and install the ops monitor
# (monitor/server.js) as a systemd service. All also ask for a superadmin
# email/password up front and create that account directly against the
# running API's own /api/setup route (the same self-disabling first-run
# endpoint the admin's Setup Wizard uses) once the stack is healthy — so
# login works without ever depending on the admin UI reaching the API from a
# browser first.
#
# All modes also verify the stack is reachable from OUTSIDE its own
# container/process — not just "healthy" from its own internal healthcheck —
# before declaring success: a container can report itself perfectly healthy
# while its published port is unreachable from a real browser (see
# diagnose_reachability below for the two ways this actually happened).
#
# Run: sudo ./install.sh [--mode=docker|production|bare-metal]
#      [--admin-email=<email>] [--admin-password=<password>]
#      [--admin-only]   Skip the install entirely — just (re)run the
#                        superadmin-creation step against an already-running
#                        stack (e.g. everything's installed, you only need
#                        the first account created).
#      [--diagnose]     Skip the install entirely — just re-run the external-
#                        reachability check + diagnostic report against an
#                        already-running stack. Use this first any time
#                        "admin can't reach the API" gets reported, instead
#                        of manually reaching for curl/ss/iptables.
set -euo pipefail
cd "$(dirname "$0")"
REPO_DIR="$(pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./install.sh" >&2
  exit 1
fi
# Captured so install_production_mode can hand ownership of whatever it wrote
# in the repo dir back to whoever actually owns it, once its root-only setup
# work is done — otherwise files created while running as root (e.g.
# .deploy-color) become unwritable by that same person's later non-sudo
# `bash scripts/deploy.sh` runs, which is the normal way to redeploy.
ORIG_OWNER="$(stat -c '%U:%G' "$REPO_DIR" 2>/dev/null || echo "")"

# ---------------------------------------------------------------------------
# Mode selection
# ---------------------------------------------------------------------------
MODE="${INSTALL_MODE:-}"
ADMIN_ONLY="false"
DIAGNOSE_ONLY="false"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-}"
SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:-}"
for arg in "$@"; do
  case "$arg" in
    --mode=docker) MODE="docker" ;;
    --mode=production) MODE="production" ;;
    --mode=bare-metal|--mode=baremetal) MODE="bare-metal" ;;
    --admin-only) ADMIN_ONLY="true" ;;
    --diagnose) DIAGNOSE_ONLY="true" ;;
    --admin-email=*) SUPERADMIN_EMAIL="${arg#--admin-email=}" ;;
    --admin-password=*) SUPERADMIN_PASSWORD="${arg#--admin-password=}" ;;
  esac
done
if [ -z "$MODE" ]; then
  if [ -t 0 ]; then
    echo "How should this be installed?"
    echo "  1) Docker trial — quick test, containers, host-published ports, no Caddy"
    echo "  2) Production (recommended) — blue-green + Caddy, real domains, zero-downtime deploys"
    echo "  3) Bare-metal — native Node + Postgres, no Docker"
    read -r -p "Choose [1/2/3] (default 2): " choice
    case "$choice" in
      1) MODE="docker" ;;
      3) MODE="bare-metal" ;;
      *) MODE="production" ;;
    esac
  else
    MODE="docker"
    echo "No --mode given and not an interactive terminal — defaulting to docker (trial)." >&2
    echo "(pass --mode=production for the real blue-green+Caddy topology, or" >&2
    echo " --mode=bare-metal for the native path instead)" >&2
  fi
fi
echo "== usim_cms installer — mode: $MODE =="
echo "Repo: $REPO_DIR"
echo ""

# Ask for the superadmin login up front (before any install work starts) —
# used later, once the stack is healthy, to create that account directly via
# the API's own /api/setup route. Skipped only if both are already supplied
# (flags or SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD env vars) and it's not an
# interactive terminal — a non-interactive run with neither is a hard error,
# same as an unset SESSION_SECRET would be further down. --diagnose creates
# no account at all, so it never asks.
if [ "$DIAGNOSE_ONLY" != "true" ]; then
  if [ -z "$SUPERADMIN_EMAIL" ] && [ -t 0 ]; then
    read -r -p "Superadmin email: " SUPERADMIN_EMAIL
  fi
  if [ -z "$SUPERADMIN_PASSWORD" ] && [ -t 0 ]; then
    read -r -s -p "Superadmin password: " SUPERADMIN_PASSWORD
    echo ""
  fi
  if [ -z "$SUPERADMIN_EMAIL" ] || [ -z "$SUPERADMIN_PASSWORD" ]; then
    echo "Superadmin email/password required — pass --admin-email=/--admin-password=," >&2
    echo "set SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD env vars, or run this interactively." >&2
    exit 1
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Shared helpers (both modes)
# ---------------------------------------------------------------------------

# Sets PKG_MGR (apt|dnf) and FIREWALL_TOOL (ufw|firewalld) from
# /etc/os-release. Deliberately errors out on anything else rather than
# guessing apt — a silent wrong guess would fail confusingly many steps
# later instead of here, with a clear message, before anything is touched.
PKG_MGR=""
FIREWALL_TOOL=""
detect_os_family() {
  if [ ! -r /etc/os-release ]; then
    echo "Cannot read /etc/os-release — unsupported OS." >&2
    exit 1
  fi
  local os_id os_id_like
  os_id="$(. /etc/os-release && echo "$ID")"
  os_id_like="$(. /etc/os-release && echo "${ID_LIKE:-}")"
  case " ${os_id} ${os_id_like} " in
    *" debian "*|*" ubuntu "*)
      PKG_MGR="apt"; FIREWALL_TOOL="ufw" ;;
    *" rhel "*|*" fedora "*|*" centos "*|*" rocky "*|*" almalinux "*)
      PKG_MGR="dnf"; FIREWALL_TOOL="firewalld" ;;
    *)
      echo "Unsupported/unrecognized OS (ID=${os_id}, ID_LIKE=${os_id_like:-<none>})." >&2
      echo "This installer supports Debian-family (apt) and RHEL-family (dnf) hosts." >&2
      exit 1
      ;;
  esac
  echo "Detected OS family: ${PKG_MGR} / ${FIREWALL_TOOL}"
}

pkg_install() {
  if [ "$PKG_MGR" = "apt" ]; then
    apt-get update -qq
    apt-get install -y "$@" >/dev/null
  else
    dnf install -y "$@" >/dev/null
  fi
}

# Best-effort only: certbot backs the monitor dashboard's/admin panel's
# "Issue certificate" action (monitor/server.js's POST /api/ssl/issue), used
# only by the nginx-as-edge enterprise pattern (CLAUDE.md) — nginx itself is
# still BYO/manual here, so a failed install must never abort setup of the
# actual app stack (Caddy's own auto-HTTPS, wired separately, needs no
# certbot at all).
ensure_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return
  fi
  echo "Installing certbot (nginx auto-SSL action, for whoever goes that route)..."
  if [ "$PKG_MGR" = "apt" ]; then
    pkg_install certbot python3-certbot-nginx || echo "certbot install failed — skip, install manually later if needed." >&2
  else
    dnf install -y epel-release >/dev/null 2>&1 || true
    pkg_install certbot python3-certbot-nginx || echo "certbot install failed — skip, install manually later if needed." >&2
  fi
}

RESERVED_PORTS=()
port_in_use() {
  ss -H -ltn "( sport = :$1 )" 2>/dev/null | grep -q LISTEN
}
port_reserved() {
  local p
  for p in "${RESERVED_PORTS[@]:-}"; do
    [ "$p" = "$1" ] && return 0
  done
  return 1
}
find_free_port() {
  local port="$1"
  while port_in_use "$port" || port_reserved "$port"; do
    port=$((port + 1))
  done
  RESERVED_PORTS+=("$port")
  echo "$port"
}

detect_public_host() {
  local host=""
  host=$(curl -fs -4 --max-time 5 ifconfig.me 2>/dev/null || true)
  if [ -z "$host" ]; then
    host=$(curl -fs -4 --max-time 5 icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)
  fi
  if [ -z "$host" ]; then
    host=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$host" ]; then
    echo "Warning: could not detect a public IP, falling back to localhost." >&2
    echo "         Set PUBLIC_HOST=<your-vps-ip> ./install.sh to override." >&2
    host="localhost"
  fi
  echo "$host"
}

fill_env_if_blank() {
  # $1 = path to an env file, $2 = key
  local file="$1" key="$2"
  if grep -qE "^${key}=\s*$" "$file" 2>/dev/null; then
    local value
    value=$(openssl rand -hex 24)
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
    echo "Generated a random ${key} in ${file}."
  fi
}
set_env_kv() {
  # $1 = path to an env file, $2 = key, $3 = value — creates the file/key if absent
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# Private, pinned Node runtime — never touches system Node (no NodeSource
# repo, no global npm/pnpm), so it can never conflict with whatever Node
# version any other project on this VPS already relies on. Referenced only
# by the absolute path this prints, from systemd units and this script.
NODE_VERSION="20.18.1"
NODE_ROOT="/opt/ucms/node"
ensure_private_node() {
  local arch node_bin
  case "$(uname -m)" in
    x86_64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported CPU arch: $(uname -m)" >&2; exit 1 ;;
  esac
  node_bin="${NODE_ROOT}/bin/node"
  if [ -x "$node_bin" ] && "$node_bin" --version 2>/dev/null | grep -q "v${NODE_VERSION}"; then
    echo "$node_bin"
    return
  fi
  {
    echo "Downloading a private Node.js v${NODE_VERSION} (${arch}) to ${NODE_ROOT}..." >&2
    mkdir -p "$NODE_ROOT"
    local tarball="node-v${NODE_VERSION}-linux-${arch}.tar.gz"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}" -o "/tmp/${tarball}"
    tar -xzf "/tmp/${tarball}" -C "$NODE_ROOT" --strip-components=1
    rm -f "/tmp/${tarball}"
  } >&2
  echo "$node_bin"
}

install_monitor() {
  # $1 = node_bin, $2 = deploy mode ("docker" or "systemd", written to
  # /etc/ucms-monitor.env for monitor/server.js's own dispatch), $3 = monitor
  # port, $4 = topology ("trial" default, or "production") — kept separate
  # from $2 since monitor/server.js itself doesn't need a third DEPLOY_MODE
  # value (it already tells trial vs blue-green apart at runtime via its own
  # isTrialModeActive()/.deploy-color); this just gates the trial-specific
  # api-recreate step below so it never runs for a blue-green install.
  local node_bin="$1" deploy_mode="$2" monitor_port="$3" topology="${4:-trial}"
  echo ""
  echo "Setting up the ops monitor..."
  if [ ! -f /etc/ucms-monitor.env ]; then
    local monitor_password
    monitor_password="$(openssl rand -hex 16)"
    cat > /etc/ucms-monitor.env <<EOF
MONITOR_PORT=${monitor_port}
REPO_DIR=${REPO_DIR}
MONITOR_USER=admin
MONITOR_PASSWORD=${monitor_password}
DEPLOY_MODE=${deploy_mode}
EOF
    chmod 600 /etc/ucms-monitor.env
    echo "Generated monitor password (saved in /etc/ucms-monitor.env)."
  else
    sed -i.bak \
      -e "s|^MONITOR_PORT=.*|MONITOR_PORT=${monitor_port}|" \
      -e "s|^REPO_DIR=.*|REPO_DIR=${REPO_DIR}|" \
      -e "s|^DEPLOY_MODE=.*|DEPLOY_MODE=${deploy_mode}|" \
      /etc/ucms-monitor.env
    rm -f /etc/ucms-monitor.env.bak
    echo "Reusing existing monitor password from /etc/ucms-monitor.env."
  fi
  sed -e "s|__NODE_BIN__|${node_bin}|g" -e "s|__REPO_DIR__|${REPO_DIR}|g" \
    monitor/ucms-monitor.service.template > /etc/systemd/system/ucms-monitor.service
  systemctl daemon-reload
  systemctl enable --now ucms-monitor
  systemctl restart ucms-monitor
  MONITOR_PASSWORD="$(grep '^MONITOR_PASSWORD=' /etc/ucms-monitor.env | cut -d= -f2-)"

  ensure_certbot

  # Lets apps/api's own POST /api/portal/ssl/issue (admin panel's SSL card)
  # reach this same monitor process to run certbot. In docker mode api runs
  # inside a container — host.docker.internal:host-gateway (wired on the api
  # service in docker-compose.yml/.release.yml/.trial.yml) is how a
  # container reaches this host-level monitor port; in systemd mode api runs
  # directly on the host, so plain loopback works.
  if [ "$deploy_mode" = "docker" ]; then
    set_env_kv .env MONITOR_URL "http://host.docker.internal:${monitor_port}"
    set_env_kv .env MONITOR_USER "admin"
    set_env_kv .env MONITOR_PASSWORD "${MONITOR_PASSWORD}"
    if [ "$topology" = "trial" ]; then
      # api is already running by the time this function is called (see the
      # trial-mode call site) — recreate it so it actually picks up the 3
      # vars just written, since compose only reads .env at container start.
      docker compose -f docker-compose.yml -f docker-compose.trial.yml up -d api 2>/dev/null || true
    fi
    # Production/blue-green: the MONITOR_* vars just written above reach the
    # api container on the NEXT scripts/deploy.sh run (it always rebuilds and
    # recreates it) — no separate recreate step here, since forcing one via
    # docker-compose.trial.yml would stand up a second, unrelated "api"
    # container with nothing to do with the live blue/green one.
  else
    set_env_kv apps/api/.env MONITOR_URL "http://127.0.0.1:${monitor_port}"
    set_env_kv apps/api/.env MONITOR_USER "admin"
    set_env_kv apps/api/.env MONITOR_PASSWORD "${MONITOR_PASSWORD}"
  fi
}

open_firewall_ports() {
  if [ "$FIREWALL_TOOL" = "ufw" ]; then
    if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
      echo ""
      echo "ufw is active — opening the ports this stack uses..."
      for p in "$@"; do
        ufw allow "${p}/tcp" >/dev/null
      done
    fi
  else
    if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
      echo ""
      echo "firewalld is active — opening the ports this stack uses..."
      for p in "$@"; do
        firewall-cmd --permanent --add-port="${p}/tcp" >/dev/null
      done
      firewall-cmd --reload >/dev/null
    fi
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Creates the first superadmin against a healthy API's own /api/setup route
# (see index.ts: self-disabling once any user row exists). Safe to re-run —
# if setup was already completed (by this call or the admin's Setup Wizard),
# it just skips instead of erroring.
create_superadmin() {
  local api_port="$1" status status_rc resp
  echo ""
  echo "Creating superadmin account..."
  status=$(curl -fs "http://localhost:${api_port}/api/setup/status" 2>/dev/null)
  status_rc=$?
  if [ $status_rc -ne 0 ]; then
    echo "Warning: could not reach /api/setup/status on port ${api_port} — skipping superadmin creation." >&2
    echo "  Re-run with --admin-only once the API is reachable to create it." >&2
    return
  fi
  if ! echo "$status" | grep -q '"needsSetup":true'; then
    echo "Setup already completed — skipping (log in with the existing account)."
    return
  fi
  # JSON body goes over stdin, never as a curl argv — a password passed via
  # -d "..." would sit in this process's command line, readable by any local
  # user via `ps` for as long as the request is in flight.
  resp=$(printf '{"email":"%s","password":"%s"}' \
      "$(json_escape "$SUPERADMIN_EMAIL")" "$(json_escape "$SUPERADMIN_PASSWORD")" \
    | curl -fs -X POST "http://localhost:${api_port}/api/setup" \
        -H "Content-Type: application/json" --data-binary @- \
        2>/dev/null || true)
  # -i: /api/setup's success response carries a "csrfToken" field (the
  # cookie+CSRF session migration renamed the old bare "token"), and a
  # case-sensitive match here was reporting a real success as a failure.
  if echo "$resp" | grep -qi 'token'; then
    echo "Superadmin created: ${SUPERADMIN_EMAIL}"
  else
    echo "Warning: superadmin creation failed — create one later from the admin's Setup Wizard." >&2
    echo "  Response: ${resp:-<no response>}" >&2
  fi
}

wait_for_api_health() {
  # $1 = api_port, $2 = number of 2s tries (default 30 = 60s). Returns 0 the
  # moment /health answers, 1 if it never does within the budget — unlike
  # the old bare wait loop, callers can actually tell success from timeout.
  local api_port="$1" tries="${2:-30}" i
  for ((i = 0; i < tries; i++)); do
    curl -fs "http://localhost:${api_port}/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

curl_reachable() {
  # Reachability, not correctness: any HTTP response (even a 404/500) means
  # something answered; curl's %{http_code} is literally "000" only when it
  # never got a response at all (refused/reset/timed out).
  local url="$1" code
  code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$url" 2>/dev/null || true)
  [ -n "$code" ] && [ "$code" != "000" ]
}

# The check this whole round of hardening exists for: a container/service can
# report itself perfectly "healthy" via its OWN internal healthcheck (which
# only ever proves 127.0.0.1-inside-the-same-namespace works) while the
# published port is completely unreachable from outside — exactly what
# happened this session, twice, for two unrelated reasons (an app bound to
# 127.0.0.1 instead of 0.0.0.0; Docker's own iptables chains resetting
# forwarded connections). This hits the ports the same way a real browser
# would: from the host, through whatever NAT/proxy sits in front of them.
verify_external_reachability() {
  local api_port="$1" admin_port="$2" frontend_port="$3" ok="true"
  echo ""
  echo "Verifying the stack is reachable from outside (not just healthy inside its own container)..."
  if wait_for_api_health "$api_port" 30; then
    echo "  API (:${api_port})      — reachable"
  else
    echo "  API (:${api_port})      — NOT reachable" >&2
    ok="false"
  fi
  if curl_reachable "http://localhost:${admin_port}/"; then
    echo "  Admin (:${admin_port})    — reachable"
  else
    echo "  Admin (:${admin_port})    — NOT reachable" >&2
    ok="false"
  fi
  if curl_reachable "http://localhost:${frontend_port}/"; then
    echo "  Frontend (:${frontend_port}) — reachable"
  else
    echo "  Frontend (:${frontend_port}) — NOT reachable" >&2
    ok="false"
  fi
  [ "$ok" = "true" ]
}

diagnose_reachability() {
  # $1 = api_port. Prints the same evidence this session's manual debugging
  # session gathered by hand (docker compose ps, ss -ltnp, iptables -L
  # FORWARD / systemd unit status) — read-only, safe to run any time.
  local api_port="$1"
  echo "" >&2
  echo "---- diagnostic report (port :${api_port}) ----" >&2
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "-- docker compose ps --" >&2
    if [ -f .deploy-color ]; then
      docker compose -p "ucms-$(cat .deploy-color)" -f docker-compose.release.yml ps >&2 || true
    else
      docker compose -f docker-compose.yml -f docker-compose.trial.yml ps >&2 || true
    fi
    echo "-- port listener (ss -ltnp) --" >&2
    ss -ltnp 2>/dev/null | grep ":${api_port} " >&2 || echo "  (nothing listening on :${api_port})" >&2
    echo "-- iptables FORWARD chain --" >&2
    iptables -L FORWARD -n -v 2>/dev/null >&2 || echo "  (iptables not available)" >&2
  else
    echo "-- systemd unit status --" >&2
    systemctl status ucms-api --no-pager -l 2>&1 | head -20 >&2 || true
    echo "-- port listener (ss -ltnp) --" >&2
    ss -ltnp 2>/dev/null | grep ":${api_port} " >&2 || echo "  (nothing listening on :${api_port})" >&2
  fi
  echo "------------------------------------------------" >&2
}

# Verifies reachability; on failure, diagnoses, tries exactly one bounded
# self-heal (restart the thing most likely to be stuck), and re-verifies
# once more before giving up. Never claims success it didn't re-check.
ensure_reachable_or_selfheal() {
  local api_port="$1" admin_port="$2" frontend_port="$3" mode="$4"
  if verify_external_reachability "$api_port" "$admin_port" "$frontend_port"; then
    return 0
  fi
  echo "" >&2
  echo "Reachability check failed — diagnosing and attempting one self-heal..." >&2
  diagnose_reachability "$api_port"
  if [ "$mode" = "docker" ]; then
    echo "Restarting the Docker daemon (regenerates its NAT/iptables chains) and containers..." >&2
    systemctl restart docker
    sleep 5
    docker compose up -d >/dev/null 2>&1 || true
    # Trial mode's api/frontend/admin live in docker-compose.trial.yml, not
    # the bare `docker compose up -d` above — bring those back too, but only
    # on a box still in trial mode. .deploy-color only ever exists once
    # scripts/deploy.sh has adopted this box for real (see CLAUDE.md's
    # Deployment section) — bringing trial containers back up on a box
    # that's gone live would fight the blue/green containers for the same
    # host ports.
    if [ ! -f .deploy-color ]; then
      docker compose -f docker-compose.yml -f docker-compose.trial.yml up -d >/dev/null 2>&1 || true
    fi
  else
    echo "Restarting the app services..." >&2
    systemctl restart ucms-api ucms-frontend ucms-admin
  fi
  if verify_external_reachability "$api_port" "$admin_port" "$frontend_port"; then
    echo "Self-heal worked — stack is reachable now." >&2
    return 0
  fi
  echo "" >&2
  echo "Still not reachable after one self-heal attempt. This box's own firewall" >&2
  echo "and Docker's/systemd's own networking both look fine from here (see the" >&2
  echo "diagnostic above) — if this is a cloud VPS, check that provider's own" >&2
  echo "security group/firewall console for these ports next. Re-run any time" >&2
  echo "with --diagnose to repeat just this check without reinstalling." >&2
  diagnose_reachability "$api_port"
  return 1
}

# ---------------------------------------------------------------------------
# Docker mode
# ---------------------------------------------------------------------------
install_docker_mode() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not found — installing via get.docker.com (adds its own repo for this distro only)..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  else
    echo "Docker already installed: $(docker --version)"
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker is installed but the 'compose' plugin is missing." >&2
    echo "Install it: https://docs.docker.com/compose/install/" >&2
    exit 1
  fi

  local api_port frontend_port admin_port monitor_port public_host
  api_port=$(find_free_port 3000)
  frontend_port=$(find_free_port 4321)
  admin_port=$(find_free_port 5173)
  monitor_port=$(find_free_port 5555)
  echo ""
  echo "Ports chosen (auto-picked next free one if the default was taken):"
  echo "  api      -> $api_port"
  echo "  frontend -> $frontend_port"
  echo "  admin    -> $admin_port"
  echo "  monitor  -> $monitor_port"

  public_host=$(detect_public_host)
  echo "Public host: $public_host"

  if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
  fi
  # Holds POSTGRES_SUPERUSER_PASSWORD/SESSION_SECRET/DEPLOY_SECRET/
  # MONITOR_PASSWORD — same treatment /etc/ucms-monitor.env already gets
  # right after it's written, so no other local account on the box can read it.
  chmod 600 .env
  fill_env_if_blank .env POSTGRES_SUPERUSER_PASSWORD
  fill_env_if_blank .env SESSION_SECRET
  set_env_kv .env VITE_API_URL "http://${public_host}:${api_port}"
  set_env_kv .env VITE_FRONTEND_URL "http://${public_host}:${frontend_port}"
  # Without this, docker-compose.yml's own ADMIN_ORIGIN fallback
  # (http://localhost:${ADMIN_PORT}) never matches a real VPS's public
  # IP/domain — every admin request gets CORS-blocked. Whatever origin the
  # admin panel actually gets served from (this same public_host:admin_port)
  # must be the allowed one.
  set_env_kv .env ADMIN_ORIGIN "http://${public_host}:${admin_port}"
  # Host-side port remapping goes through .env (API_PORT/FRONTEND_PORT/
  # ADMIN_PORT, read by docker-compose.yml's `${VAR:-default}` port entries)
  # rather than a docker-compose.override.yml: Compose concatenates
  # list-valued keys like `ports` across files instead of replacing them, so
  # an override file here would bind BOTH the default and the picked port —
  # exactly the bug that made api still fail to bind :3000 even after this
  # script correctly picked a free 3001 elsewhere on a port-conflicted box.
  set_env_kv .env API_PORT "$api_port"
  set_env_kv .env FRONTEND_PORT "$frontend_port"
  set_env_kv .env ADMIN_PORT "$admin_port"
  # Remove a stale override from a previous run of this script (pre-fix
  # versions generated one) — leaving it in place would still trigger the
  # same bind-both-ports bug described above.
  rm -f docker-compose.override.yml

  echo ""
  echo "Building and starting containers (first run can take a few minutes)..."
  # docker-compose.trial.yml adds api/frontend/admin on host-published ports
  # (no Caddy) on top of this file's db+proxy — see that file's own header
  # for why docker-compose.yml alone no longer has those 3 services.
  docker compose -f docker-compose.yml -f docker-compose.trial.yml up -d --build db api frontend admin

  if ! ensure_reachable_or_selfheal "$api_port" "$admin_port" "$frontend_port" "docker"; then
    echo "" >&2
    echo "Aborting — the stack is up but not reachable, so it wouldn't work in a" >&2
    echo "browser either. See the diagnostic report above for what to check next." >&2
    exit 1
  fi

  create_superadmin "$api_port"

  local node_bin
  node_bin=$(ensure_private_node)
  install_monitor "$node_bin" "docker" "$monitor_port"
  open_firewall_ports "$api_port" "$frontend_port" "$admin_port" "$monitor_port"

  echo ""
  echo "================================================================"
  echo " Done (docker mode)."
  echo "   Admin panel:  http://${public_host}:${admin_port}"
  echo "   Public site:  http://${public_host}:${frontend_port}"
  echo "   API:          http://${public_host}:${api_port}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/ucms-monitor.env on this VPS)"
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
  echo "================================================================"
}

# ---------------------------------------------------------------------------
# Production mode (blue-green + Caddy) — docker-compose.yml (base) +
# docker-compose.release.yml (blue/green app tier, via scripts/deploy.sh)
# ---------------------------------------------------------------------------

# Set by ensure_caddy_bind_ports — read by the reachability check below.
CADDY_HTTP_PORT="80"
NEEDS_NGINX_SNIPPET="false"

# Detects whether 80/443 already belong to another app on this shared VPS —
# never assumes. Free: Caddy binds them directly and keeps auto-HTTPS. Taken:
# Caddy moves to loopback-only ports (never touches the real 80/443 another
# app owns) and this box needs one manual nginx vhost added afterward (see
# print_nginx_snippet) — install.sh never edits another app's nginx config
# itself, that's too blind an action to automate on a shared box.
ensure_caddy_bind_ports() {
  if port_in_use 80 || port_in_use 443; then
    echo ""
    echo "Port 80 and/or 443 already in use by another app on this VPS."
    echo "Binding Caddy to loopback-only ports instead — you'll add one nginx"
    echo "vhost yourself afterward (exact snippet printed at the end)."
    CADDY_HTTP_PORT=$(find_free_port 8090)
    local https_port
    https_port=$(find_free_port 8091)
    set_env_kv .env PROXY_BIND_HTTP "127.0.0.1:${CADDY_HTTP_PORT}:80"
    set_env_kv .env PROXY_BIND_HTTPS "127.0.0.1:${https_port}:443"
    # Caddy can't prove domain ownership (ACME) on a port it doesn't really
    # own — auto-HTTPS must be off; whatever already holds 80/443 terminates
    # TLS instead. Idempotent: only touches the line if still commented.
    if grep -qE '^\s*# auto_https off' Caddyfile; then
      sed -i.bak -E 's/^(\s*)# auto_https off/\1auto_https off/' Caddyfile && rm -f Caddyfile.bak
    fi
    NEEDS_NGINX_SNIPPET="true"
  else
    CADDY_HTTP_PORT="80"
    NEEDS_NGINX_SNIPPET="false"
    # Clear any loopback bind left over from an EARLIER run where 80/443
    # were taken — docker-compose.yml's ${PROXY_BIND_HTTP:-80:80} only falls
    # back to the real default when the var is unset OR empty, so a stale
    # value here would keep Caddy on loopback forever even after whatever
    # was using 80/443 before is gone.
    set_env_kv .env PROXY_BIND_HTTP ""
    set_env_kv .env PROXY_BIND_HTTPS ""
    # Revert Caddyfile's auto_https toggle too, if an earlier run turned it
    # off — Caddy owns 80/443 for real now and can prove domain ownership.
    if grep -qE '^\s*auto_https off' Caddyfile; then
      sed -i.bak -E 's/^(\s*)auto_https off/\1# auto_https off/' Caddyfile && rm -f Caddyfile.bak
    fi
  fi
}

print_nginx_snippet() {
  echo ""
  echo "---- add this to your existing nginx config, then: nginx -t && systemctl reload nginx ----"
  for domain in "$ADMIN_DOMAIN" "$API_DOMAIN" $TENANT_DOMAINS; do
    cat <<EOF
server {
    listen 80;
    listen 443 ssl;
    server_name ${domain};
    # ... your existing ssl_certificate/ssl_certificate_key lines for this domain ...
    location / {
        proxy_pass http://127.0.0.1:${CADDY_HTTP_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  done
  echo "-------------------------------------------------------------------------------------------"
}

prompt_domains() {
  if [ -z "${ADMIN_DOMAIN:-}" ] && [ -t 0 ]; then
    read -r -p "Admin panel domain (blank = admin.localhost, test-only): " ADMIN_DOMAIN
  fi
  if [ -z "${API_DOMAIN:-}" ] && [ -t 0 ]; then
    read -r -p "API domain (blank = api.localhost, test-only): " API_DOMAIN
  fi
  if [ -z "${TENANT_DOMAINS:-}" ] && [ -t 0 ]; then
    read -r -p "Tenant site domain(s), space-separated (blank = tenant.localhost, test-only): " TENANT_DOMAINS
  fi
  ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.localhost}"
  API_DOMAIN="${API_DOMAIN:-api.localhost}"
  TENANT_DOMAINS="${TENANT_DOMAINS:-tenant.localhost}"
  case "$ADMIN_DOMAIN $API_DOMAIN" in
    *.localhost*)
      echo "" >&2
      echo "Warning: using a *.localhost placeholder domain — Caddy's automatic" >&2
      echo "HTTPS needs a real domain with DNS already pointed at this VPS to" >&2
      echo "work. Fine for internal testing only." >&2
      ;;
  esac
}

# Blue-green never publishes api to the host (see docker-compose.release.yml)
# — reaches it the same way scripts/deploy.sh's own promote() does, via
# `docker compose exec` into the currently-live color. The JSON body goes
# over stdin into the node process (never argv/-e env vars) for the same
# reason the trial-mode create_superadmin() above already avoids that: a
# password on this process's own command line would be readable via `ps` by
# any local user for as long as the request is in flight.
SETUP_SCRIPT_PRODUCTION='
let body = "";
process.stdin.on("data", (c) => (body += c));
process.stdin.on("end", () => {
  fetch("http://127.0.0.1:3000/api/setup/status")
    .then((r) => r.json())
    .then((status) => {
      if (!status.needsSetup) { console.log("ALREADY_SETUP"); return; }
      return fetch("http://127.0.0.1:3000/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).then((r) => r.text()).then((t) => console.log(t.toLowerCase().includes("token") ? "CREATED" : "FAILED:" + t));
    })
    .catch((e) => { console.error(String(e)); process.exit(1); });
});
'
create_superadmin_production() {
  echo ""
  echo "Creating superadmin account..."
  local color resp
  color="$(cat .deploy-color 2>/dev/null || echo blue)"
  if ! resp=$(printf '{"email":"%s","password":"%s"}' \
      "$(json_escape "$SUPERADMIN_EMAIL")" "$(json_escape "$SUPERADMIN_PASSWORD")" \
    | docker compose -p "ucms-${color}" -f docker-compose.release.yml exec -T api node -e "$SETUP_SCRIPT_PRODUCTION" 2>&1); then
    echo "Warning: could not reach the API container to create superadmin —" >&2
    echo "  create one later from the admin's Setup Wizard, or re-run with --admin-only." >&2
    return
  fi
  case "$resp" in
    *ALREADY_SETUP*) echo "Setup already completed — skipping (log in with the existing account)." ;;
    *CREATED*) echo "Superadmin created: ${SUPERADMIN_EMAIL}" ;;
    *) echo "Warning: superadmin creation failed — create one later from the admin's Setup Wizard." >&2
       echo "  Response: ${resp}" >&2 ;;
  esac
}

# Caddy routes by Host header, so this checks routing works — not just "port
# 80 accepts connections" — the same reasoning verify_external_reachability
# (trial mode) already applies to raw ports. Doesn't depend on public DNS
# actually pointing here yet, unlike hitting the real domain would.
verify_production_reachability() {
  local ok="true" domain
  echo ""
  echo "Verifying the stack is reachable through Caddy (Host-based routing)..."
  for domain in "$ADMIN_DOMAIN" "$API_DOMAIN" ${TENANT_DOMAINS%% *}; do
    if curl_reachable_host "$domain" "$CADDY_HTTP_PORT"; then
      echo "  ${domain} — reachable"
    else
      echo "  ${domain} — NOT reachable" >&2
      ok="false"
    fi
  done
  [ "$ok" = "true" ]
}
curl_reachable_host() {
  local domain="$1" port="$2" code
  code=$(curl -s -o /dev/null --max-time 5 -H "Host: ${domain}" "http://127.0.0.1:${port}/" -w '%{http_code}' 2>/dev/null || true)
  [ -n "$code" ] && [ "$code" != "000" ]
}

install_production_mode() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not found — installing via get.docker.com (adds its own repo for this distro only)..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  else
    echo "Docker already installed: $(docker --version)"
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker is installed but the 'compose' plugin is missing." >&2
    echo "Install it: https://docs.docker.com/compose/install/" >&2
    exit 1
  fi

  local monitor_port public_host
  monitor_port=$(find_free_port 5555)
  public_host=$(detect_public_host)
  echo "Public host: $public_host"

  if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
  fi
  # Holds POSTGRES_SUPERUSER_PASSWORD/SESSION_SECRET/DEPLOY_SECRET/
  # MONITOR_PASSWORD — same treatment /etc/ucms-monitor.env already gets
  # right after it's written, so no other local account on the box can read it.
  chmod 600 .env
  ensure_caddy_bind_ports
  prompt_domains

  fill_env_if_blank .env POSTGRES_SUPERUSER_PASSWORD
  fill_env_if_blank .env SESSION_SECRET
  fill_env_if_blank .env DEPLOY_SECRET
  set_env_kv .env ADMIN_DOMAIN "$ADMIN_DOMAIN"
  set_env_kv .env API_DOMAIN "$API_DOMAIN"
  set_env_kv .env TENANT_DOMAINS "$TENANT_DOMAINS"
  set_env_kv .env ADMIN_ORIGIN "https://${ADMIN_DOMAIN}"
  set_env_kv .env VITE_API_URL "https://${API_DOMAIN}"
  set_env_kv .env VITE_FRONTEND_URL "https://${TENANT_DOMAINS%% *}"
  # Default to 1 replica each, but never clobber a value from a previous
  # install/re-run — unlike the secrets above, this isn't meant to reset.
  grep -qE '^API_REPLICAS=.+' .env || set_env_kv .env API_REPLICAS "1"
  grep -qE '^FRONTEND_REPLICAS=.+' .env || set_env_kv .env FRONTEND_REPLICAS "1"
  grep -qE '^ADMIN_REPLICAS=.+' .env || set_env_kv .env ADMIN_REPLICAS "1"

  echo ""
  echo "-- ensuring base (db+pgbouncer+redis+proxy) is up --"
  docker compose up -d db pgbouncer redis proxy
  docker volume create ucms-uploads >/dev/null

  echo ""
  echo "-- first deploy (build+test+health-check+promote, see scripts/deploy.sh) --"
  if ! bash scripts/deploy.sh; then
    echo "" >&2
    echo "Aborting — the first deploy failed. Nothing was live before this run," >&2
    echo "so there's nothing to roll back; fix the error above and re-run" >&2
    echo "sudo ./install.sh --mode=production (safe to re-run)." >&2
    exit 1
  fi

  # Hand the repo dir back to whoever actually owns it — this whole function
  # ran as root, so .env/.deploy-color/etc were all just written as root,
  # which would otherwise block that same person's later non-sudo
  # `bash scripts/deploy.sh` runs (the normal way to redeploy) with a
  # confusing "Permission denied" on .deploy-color specifically.
  if [ -n "$ORIG_OWNER" ] && [ "$ORIG_OWNER" != "root:root" ]; then
    chown -R "$ORIG_OWNER" "$REPO_DIR"
  fi

  verify_production_reachability || echo "  (continuing anyway — deploy.sh's own health-check already gated success; see above for what's not reachable yet)" >&2

  create_superadmin_production

  local node_bin
  node_bin=$(ensure_private_node)
  install_monitor "$node_bin" "docker" "$monitor_port" "production"

  if [ "$NEEDS_NGINX_SNIPPET" = "true" ]; then
    open_firewall_ports "$monitor_port"
  else
    open_firewall_ports "80" "443" "$monitor_port"
  fi

  echo ""
  echo "================================================================"
  echo " Done (production mode)."
  echo "   Admin panel:  https://${ADMIN_DOMAIN}"
  echo "   Public site:  https://${TENANT_DOMAINS%% *}"
  echo "   API:          https://${API_DOMAIN}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/ucms-monitor.env on this VPS)"
  if [ "$NEEDS_NGINX_SNIPPET" = "true" ]; then
    print_nginx_snippet
    echo ""
    echo " Note: the Caddyfile edit above (auto_https off) lives in a tracked repo"
    echo " file. A future 'git reset --hard origin/main' (Monitor's own 'Pull latest"
    echo " & rebuild', or scripts/deploy.sh's own pull step) will silently revert it"
    echo " next time the proxy container gets recreated. If Caddy starts trying (and"
    echo " failing) to auto-issue certs again after a future pull, re-run:"
    echo "   sudo ./install.sh --mode=production"
  fi
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
  echo " Future deploys: bash scripts/deploy.sh (zero-downtime) or the Monitor's"
  echo " own 'Pull latest & rebuild' button."
  echo "================================================================"
}

# ---------------------------------------------------------------------------
# Bare-metal mode
# ---------------------------------------------------------------------------
ensure_postgres() {
  # Reuses an already-running local Postgres cluster if one exists — never
  # installs a second one. This mirrors apps/api's own tenant model: one
  # Postgres server, one database per tenant (here: one database for this
  # app, alongside whatever else already lives on the same cluster).
  if command -v pg_isready >/dev/null 2>&1 && pg_isready -q -h 127.0.0.1 -p 5432 2>/dev/null; then
    echo "Reusing existing local PostgreSQL cluster on :5432."
    DB_MANAGED="false"
  else
    echo "No local PostgreSQL found — installing..."
    if [ "$PKG_MGR" = "apt" ]; then
      pkg_install postgresql
    else
      pkg_install postgresql-server
      # Debian's postgresql package auto-initializes its data directory on
      # install; RHEL-family's postgresql-server package doesn't — it needs
      # an explicit initdb before it can start at all. A no-op (exit 1, "|| true")
      # if this cluster was already initialized by an earlier run.
      postgresql-setup --initdb >/dev/null 2>&1 || true
    fi
    systemctl enable --now postgresql
    DB_MANAGED="true"
  fi
}

ensure_app_database() {
  # Idempotent: safe to re-run. Only rotates usim_cms_app's password the
  # first time this creates apps/api/.env's DATABASE_URL — an existing,
  # already-deployed password is never silently invalidated.
  local exists
  exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='usim_cms'" 2>/dev/null || true)
  if [ "$exists" != "1" ]; then
    echo "Creating usim_cms database..."
    sudo -u postgres psql -c "CREATE DATABASE usim_cms" >/dev/null
  fi
  sudo -u postgres psql -d usim_cms -f apps/api/scripts/setup-db-role.sql >/dev/null

  if ! grep -qE "^DATABASE_URL=.+" apps/api/.env 2>/dev/null; then
    local db_password
    db_password="$(openssl rand -hex 24)"
    sudo -u postgres psql -d usim_cms -c "ALTER ROLE usim_cms_app WITH PASSWORD '${db_password}'" >/dev/null
    set_env_kv apps/api/.env DATABASE_URL "postgres://usim_cms_app:${db_password}@127.0.0.1:5432/usim_cms"
    echo "Created usim_cms_app role with a fresh generated password."
  else
    echo "Reusing existing DATABASE_URL in apps/api/.env."
  fi
}

install_baremetal_mode() {
  local node_bin
  node_bin=$(ensure_private_node)
  echo "Using Node: $node_bin ($($node_bin --version))"

  ensure_postgres
  cp -n apps/api/.env.example apps/api/.env 2>/dev/null || true
  chmod 600 apps/api/.env
  ensure_app_database

  local api_port frontend_port admin_port monitor_port public_host
  api_port=$(find_free_port 3000)
  frontend_port=$(find_free_port 4321)
  admin_port=$(find_free_port 5173)
  monitor_port=$(find_free_port 5555)
  echo ""
  echo "Ports chosen (auto-picked next free one if the default was taken):"
  echo "  api      -> $api_port"
  echo "  frontend -> $frontend_port"
  echo "  admin    -> $admin_port"
  echo "  monitor  -> $monitor_port"

  public_host=$(detect_public_host)
  echo "Public host: $public_host"

  set_env_kv apps/api/.env PORT "$api_port"
  set_env_kv apps/api/.env STORAGE_DRIVER "local"
  # Bare-metal mode has no docker-compose.yml wrapping it, so there's no
  # localhost fallback to fall back to — apps/api/.env is the only place
  # this gets set, and it must match wherever the admin panel actually gets
  # served from (this same public_host:admin_port), same reasoning as the
  # docker-mode .env above.
  set_env_kv apps/api/.env ADMIN_ORIGIN "http://${public_host}:${admin_port}"
  grep -q '^SESSION_SECRET=' apps/api/.env || echo "SESSION_SECRET=" >> apps/api/.env
  fill_env_if_blank apps/api/.env SESSION_SECRET

  echo ""
  echo "Installing dependencies (pnpm via corepack, first run can take a while)..."
  # `corepack enable` writes a `pnpm` shim into node's own bin dir (it reads
  # this repo's package.json "packageManager" field and fetches that exact
  # pnpm version on first use) — you then call `pnpm` directly, same as any
  # other CLI; `corepack pnpm ...` is not itself a valid invocation.
  local node_dir="$(dirname "$node_bin")"
  export PATH="${node_dir}:${PATH}"
  "${node_dir}/corepack" enable
  pnpm install --frozen-lockfile

  echo "Building api..."
  pnpm --filter @ucms/api build

  echo "Building admin (VITE_API_URL=http://${public_host}:${api_port})..."
  VITE_API_URL="http://${public_host}:${api_port}" \
  VITE_FRONTEND_URL="http://${public_host}:${frontend_port}" \
  pnpm --filter @ucms/admin build

  echo "Building frontend (API_URL=http://127.0.0.1:${api_port})..."
  API_URL="http://127.0.0.1:${api_port}" pnpm --filter @ucms/frontend build

  # ---- systemd units for the 3 app processes ----
  cat > /etc/systemd/system/ucms-api.service <<EOF
[Unit]
Description=usim_cms API
After=network.target postgresql.service

[Service]
Type=simple
ExecStart=${node_bin} dist/index.js
WorkingDirectory=${REPO_DIR}/apps/api
EnvironmentFile=${REPO_DIR}/apps/api/.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/ucms-frontend.service <<EOF
[Unit]
Description=usim_cms frontend
After=network.target ucms-api.service

[Service]
Type=simple
ExecStart=${node_bin} server.mjs
WorkingDirectory=${REPO_DIR}/apps/frontend
Environment=PORT=${frontend_port}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/ucms-admin.service <<EOF
[Unit]
Description=usim_cms admin (static)
After=network.target

[Service]
Type=simple
ExecStart=${node_bin} ${REPO_DIR}/monitor/static-server.js ${REPO_DIR}/apps/admin/dist ${admin_port}
WorkingDirectory=${REPO_DIR}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now ucms-api ucms-frontend ucms-admin
  systemctl restart ucms-api ucms-frontend ucms-admin

  if ! ensure_reachable_or_selfheal "$api_port" "$admin_port" "$frontend_port" "bare-metal"; then
    echo "" >&2
    echo "Aborting — the services are running but not reachable, so it wouldn't" >&2
    echo "work in a browser either. See the diagnostic report above." >&2
    exit 1
  fi

  create_superadmin "$api_port"

  install_monitor "$node_bin" "systemd" "$monitor_port"
  # Record whether we own Postgres (so the monitor only offers to restart it
  # when it's not something another app on this VPS also depends on) and the
  # values its "pull latest & rebuild" action needs to redo the build step —
  # docker mode doesn't need these, docker-compose already carries them.
  set_env_kv /etc/ucms-monitor.env DB_MANAGED "$DB_MANAGED"
  set_env_kv /etc/ucms-monitor.env NODE_BIN "$node_bin"
  set_env_kv /etc/ucms-monitor.env API_PORT "$api_port"
  set_env_kv /etc/ucms-monitor.env FRONTEND_PORT "$frontend_port"
  set_env_kv /etc/ucms-monitor.env ADMIN_PORT "$admin_port"
  set_env_kv /etc/ucms-monitor.env PUBLIC_HOST "$public_host"
  systemctl restart ucms-monitor
  open_firewall_ports "$api_port" "$frontend_port" "$admin_port" "$monitor_port"

  echo ""
  echo "================================================================"
  echo " Done (bare-metal mode)."
  echo "   Admin panel:  http://${public_host}:${admin_port}"
  echo "   Public site:  http://${public_host}:${frontend_port}"
  echo "   API:          http://${public_host}:${api_port}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/ucms-monitor.env on this VPS)"
  echo "   PostgreSQL:   $([ "$DB_MANAGED" = "true" ] && echo "installed by this script" || echo "reusing your existing cluster")"
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
  echo "================================================================"
}

# Reads the 3 published ports back out of wherever install_*_mode already
# wrote them, for the two "re-run against an already-installed stack" modes
# below — never re-picks a free one, since the stack is expected to already
# be up on the ports it was actually installed with.
resolve_running_ports() {
  if [ "$MODE" = "docker" ]; then
    API_PORT_VAL="$(grep '^API_PORT=' .env 2>/dev/null | cut -d= -f2-)"
    ADMIN_PORT_VAL="$(grep '^ADMIN_PORT=' .env 2>/dev/null | cut -d= -f2-)"
    FRONTEND_PORT_VAL="$(grep '^FRONTEND_PORT=' .env 2>/dev/null | cut -d= -f2-)"
  else
    API_PORT_VAL="$(grep '^PORT=' apps/api/.env 2>/dev/null | cut -d= -f2-)"
    ADMIN_PORT_VAL="$(grep '^ADMIN_PORT=' /etc/ucms-monitor.env 2>/dev/null | cut -d= -f2-)"
    FRONTEND_PORT_VAL="$(grep '^FRONTEND_PORT=' /etc/ucms-monitor.env 2>/dev/null | cut -d= -f2-)"
  fi
  if [ -z "$API_PORT_VAL" ]; then
    echo "Could not find an existing API port for mode=$MODE — is the stack installed?" >&2
    exit 1
  fi
}

# Production mode has no fixed API/admin/frontend ports to resolve (nothing
# is host-published — see docker-compose.release.yml) — re-derives what it
# needs straight from .env instead of resolve_running_ports's port-file
# lookups, which only apply to the trial/bare-metal port-publishing modes.
resolve_production_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.localhost}"
  API_DOMAIN="${API_DOMAIN:-api.localhost}"
  TENANT_DOMAINS="${TENANT_DOMAINS:-tenant.localhost}"
  CADDY_HTTP_PORT="80"
  [ -n "${PROXY_BIND_HTTP:-}" ] && CADDY_HTTP_PORT="$(echo "$PROXY_BIND_HTTP" | cut -d: -f2)"
}

if [ "$DIAGNOSE_ONLY" = "true" ]; then
  if [ "$MODE" = "production" ]; then
    resolve_production_env
    if verify_production_reachability; then
      echo ""
      echo "Everything's reachable from outside — no problem found."
      exit 0
    fi
    exit 1
  fi
  resolve_running_ports
  if verify_external_reachability "$API_PORT_VAL" "$ADMIN_PORT_VAL" "$FRONTEND_PORT_VAL"; then
    echo ""
    echo "Everything's reachable from outside — no problem found."
    exit 0
  fi
  diagnose_reachability "$API_PORT_VAL"
  exit 1
fi

if [ "$ADMIN_ONLY" = "true" ]; then
  if [ "$MODE" = "production" ]; then
    resolve_production_env
    create_superadmin_production
    exit 0
  fi
  resolve_running_ports
  echo "Waiting for the API to become healthy..."
  wait_for_api_health "$API_PORT_VAL" 30 || true
  create_superadmin "$API_PORT_VAL"
  exit 0
fi

detect_os_family
if [ "$MODE" = "docker" ]; then
  install_docker_mode
elif [ "$MODE" = "production" ]; then
  install_production_mode
else
  install_baremetal_mode
fi
