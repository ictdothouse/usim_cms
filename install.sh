#!/usr/bin/env bash
# One-shot installer for a test/staging Ubuntu VPS. Safe to re-run.
#
# Two modes, chosen with --mode=docker|bare-metal, $INSTALL_MODE, or (if
# neither is set and this is an interactive terminal) a prompt:
#
#   docker      Everything in containers (db/api/frontend/admin). Nothing
#               touches the host besides Docker itself. Recommended default
#               — total isolation from whatever else runs on this VPS.
#
#   bare-metal  Native Node processes + a native/reused PostgreSQL cluster,
#               for orgs that don't want Docker at all. Still fully
#               conflict-safe: it never installs Node into the system PATH
#               (a private, pinned Node runtime is downloaded to
#               /opt/usim-cms/node and referenced by absolute path only) and
#               it reuses an already-running Postgres cluster instead of
#               installing a second one (creates its own database + role
#               inside it — this is exactly the same "one Postgres server,
#               many databases" model apps/api already uses per tenant).
#
# Both modes: auto-pick free host ports, detect the public IP so the admin
# build's baked-in API URL is actually reachable from a browser, and install
# the ops monitor (monitor/server.js) as a systemd service. Both also ask for
# a superadmin email/password up front and create that account directly
# against the running API's own /api/setup route (the same self-disabling
# first-run endpoint the admin's Setup Wizard uses) once the stack is
# healthy — so login works without ever depending on the admin UI reaching
# the API from a browser first.
#
# Run: sudo ./install.sh [--mode=docker|bare-metal]
#      [--admin-email=<email>] [--admin-password=<password>]
#      [--admin-only]   Skip the install entirely — just (re)run the
#                        superadmin-creation step against an already-running
#                        stack (e.g. everything's installed, you only need
#                        the first account created).
set -euo pipefail
cd "$(dirname "$0")"
REPO_DIR="$(pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./install.sh" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Mode selection
# ---------------------------------------------------------------------------
MODE="${INSTALL_MODE:-}"
ADMIN_ONLY="false"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-}"
SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:-}"
for arg in "$@"; do
  case "$arg" in
    --mode=docker) MODE="docker" ;;
    --mode=bare-metal|--mode=baremetal) MODE="bare-metal" ;;
    --admin-only) ADMIN_ONLY="true" ;;
    --admin-email=*) SUPERADMIN_EMAIL="${arg#--admin-email=}" ;;
    --admin-password=*) SUPERADMIN_PASSWORD="${arg#--admin-password=}" ;;
  esac
done
if [ -z "$MODE" ]; then
  if [ -t 0 ]; then
    echo "How should this be installed?"
    echo "  1) Docker (recommended) — everything in containers, nothing touches the host"
    echo "  2) Bare-metal — native Node + Postgres, no Docker"
    read -r -p "Choose [1/2] (default 1): " choice
    case "$choice" in
      2) MODE="bare-metal" ;;
      *) MODE="docker" ;;
    esac
  else
    MODE="docker"
    echo "No --mode given and not an interactive terminal — defaulting to docker." >&2
    echo "(pass --mode=bare-metal to pick the native path instead)" >&2
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
# same as an unset SESSION_SECRET would be further down.
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

# ---------------------------------------------------------------------------
# Shared helpers (both modes)
# ---------------------------------------------------------------------------
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
NODE_ROOT="/opt/usim-cms/node"
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
  # $1 = node_bin, $2 = deploy mode ("docker" or "systemd"), $3 = monitor port
  local node_bin="$1" deploy_mode="$2" monitor_port="$3"
  echo ""
  echo "Setting up the ops monitor..."
  if [ ! -f /etc/usim-cms-monitor.env ]; then
    local monitor_password
    monitor_password="$(openssl rand -hex 16)"
    cat > /etc/usim-cms-monitor.env <<EOF
MONITOR_PORT=${monitor_port}
REPO_DIR=${REPO_DIR}
MONITOR_USER=admin
MONITOR_PASSWORD=${monitor_password}
DEPLOY_MODE=${deploy_mode}
EOF
    chmod 600 /etc/usim-cms-monitor.env
    echo "Generated monitor password (saved in /etc/usim-cms-monitor.env)."
  else
    sed -i.bak \
      -e "s|^MONITOR_PORT=.*|MONITOR_PORT=${monitor_port}|" \
      -e "s|^REPO_DIR=.*|REPO_DIR=${REPO_DIR}|" \
      -e "s|^DEPLOY_MODE=.*|DEPLOY_MODE=${deploy_mode}|" \
      /etc/usim-cms-monitor.env
    rm -f /etc/usim-cms-monitor.env.bak
    echo "Reusing existing monitor password from /etc/usim-cms-monitor.env."
  fi
  sed -e "s|__NODE_BIN__|${node_bin}|g" -e "s|__REPO_DIR__|${REPO_DIR}|g" \
    monitor/usim-cms-monitor.service.template > /etc/systemd/system/usim-cms-monitor.service
  systemctl daemon-reload
  systemctl enable --now usim-cms-monitor
  systemctl restart usim-cms-monitor
  MONITOR_PASSWORD="$(grep '^MONITOR_PASSWORD=' /etc/usim-cms-monitor.env | cut -d= -f2-)"
}

open_ufw_ports() {
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    echo ""
    echo "ufw is active — opening the ports this stack uses..."
    for p in "$@"; do
      ufw allow "${p}/tcp" >/dev/null
    done
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
  local api_port="$1" status
  echo ""
  echo "Creating superadmin account..."
  status=$(curl -fs "http://localhost:${api_port}/api/setup/status" 2>/dev/null || true)
  if ! echo "$status" | grep -q '"needsSetup":true'; then
    echo "Setup already completed — skipping (log in with the existing account)."
    return
  fi
  local resp
  resp=$(curl -fs -X POST "http://localhost:${api_port}/api/setup" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$(json_escape "$SUPERADMIN_EMAIL")\",\"password\":\"$(json_escape "$SUPERADMIN_PASSWORD")\"}" \
    2>/dev/null || true)
  if echo "$resp" | grep -q '"token"'; then
    echo "Superadmin created: ${SUPERADMIN_EMAIL}"
  else
    echo "Warning: superadmin creation failed — create one later from the admin's Setup Wizard." >&2
    echo "  Response: ${resp:-<no response>}" >&2
  fi
}

# ---------------------------------------------------------------------------
# Docker mode
# ---------------------------------------------------------------------------
install_docker_mode() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not found — installing via get.docker.com (adds its own apt repo only)..."
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
  fill_env_if_blank .env POSTGRES_SUPERUSER_PASSWORD
  fill_env_if_blank .env SESSION_SECRET
  set_env_kv .env VITE_API_URL "http://${public_host}:${api_port}"
  set_env_kv .env VITE_FRONTEND_URL "http://${public_host}:${frontend_port}"
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
  docker compose up -d --build db api frontend admin

  echo ""
  echo "Waiting for the API to become healthy..."
  for _ in $(seq 1 30); do
    curl -fs "http://localhost:${api_port}/health" >/dev/null 2>&1 && break
    sleep 2
  done

  create_superadmin "$api_port"

  local node_bin
  node_bin=$(ensure_private_node)
  install_monitor "$node_bin" "docker" "$monitor_port"
  open_ufw_ports "$api_port" "$frontend_port" "$admin_port" "$monitor_port"

  echo ""
  echo "================================================================"
  echo " Done (docker mode)."
  echo "   Admin panel:  http://${public_host}:${admin_port}"
  echo "   Public site:  http://${public_host}:${frontend_port}"
  echo "   API:          http://${public_host}:${api_port}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/usim-cms-monitor.env on this VPS)"
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
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
    apt-get update -qq
    apt-get install -y postgresql >/dev/null
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
  pnpm --filter @usim-cms/api build

  echo "Building admin (VITE_API_URL=http://${public_host}:${api_port})..."
  VITE_API_URL="http://${public_host}:${api_port}" \
  VITE_FRONTEND_URL="http://${public_host}:${frontend_port}" \
  pnpm --filter @usim-cms/admin build

  echo "Building frontend (API_URL=http://127.0.0.1:${api_port})..."
  API_URL="http://127.0.0.1:${api_port}" pnpm --filter @usim-cms/frontend build

  # ---- systemd units for the 3 app processes ----
  cat > /etc/systemd/system/usim-cms-api.service <<EOF
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

  cat > /etc/systemd/system/usim-cms-frontend.service <<EOF
[Unit]
Description=usim_cms frontend
After=network.target usim-cms-api.service

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

  cat > /etc/systemd/system/usim-cms-admin.service <<EOF
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
  systemctl enable --now usim-cms-api usim-cms-frontend usim-cms-admin
  systemctl restart usim-cms-api usim-cms-frontend usim-cms-admin

  echo ""
  echo "Waiting for the API to become healthy..."
  for _ in $(seq 1 30); do
    curl -fs "http://localhost:${api_port}/health" >/dev/null 2>&1 && break
    sleep 2
  done

  create_superadmin "$api_port"

  install_monitor "$node_bin" "systemd" "$monitor_port"
  # Record whether we own Postgres (so the monitor only offers to restart it
  # when it's not something another app on this VPS also depends on) and the
  # values its "pull latest & rebuild" action needs to redo the build step —
  # docker mode doesn't need these, docker-compose already carries them.
  set_env_kv /etc/usim-cms-monitor.env DB_MANAGED "$DB_MANAGED"
  set_env_kv /etc/usim-cms-monitor.env NODE_BIN "$node_bin"
  set_env_kv /etc/usim-cms-monitor.env API_PORT "$api_port"
  set_env_kv /etc/usim-cms-monitor.env FRONTEND_PORT "$frontend_port"
  set_env_kv /etc/usim-cms-monitor.env ADMIN_PORT "$admin_port"
  set_env_kv /etc/usim-cms-monitor.env PUBLIC_HOST "$public_host"
  systemctl restart usim-cms-monitor
  open_ufw_ports "$api_port" "$frontend_port" "$admin_port" "$monitor_port"

  echo ""
  echo "================================================================"
  echo " Done (bare-metal mode)."
  echo "   Admin panel:  http://${public_host}:${admin_port}"
  echo "   Public site:  http://${public_host}:${frontend_port}"
  echo "   API:          http://${public_host}:${api_port}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/usim-cms-monitor.env on this VPS)"
  echo "   PostgreSQL:   $([ "$DB_MANAGED" = "true" ] && echo "installed by this script" || echo "reusing your existing cluster")"
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
  echo "================================================================"
}

if [ "$ADMIN_ONLY" = "true" ]; then
  # Re-run of just the account-creation step against a stack this script
  # already installed — reads the API port back out of wherever install_*_mode
  # wrote it rather than re-picking a free one, since the stack is expected
  # to already be up.
  if [ "$MODE" = "docker" ]; then
    API_PORT_VAL="$(grep '^API_PORT=' .env 2>/dev/null | cut -d= -f2-)"
  else
    API_PORT_VAL="$(grep '^PORT=' apps/api/.env 2>/dev/null | cut -d= -f2-)"
  fi
  if [ -z "$API_PORT_VAL" ]; then
    echo "Could not find an existing API_PORT for mode=$MODE — is the stack installed?" >&2
    exit 1
  fi
  echo "Waiting for the API to become healthy..."
  for _ in $(seq 1 30); do
    curl -fs "http://localhost:${API_PORT_VAL}/health" >/dev/null 2>&1 && break
    sleep 2
  done
  create_superadmin "$API_PORT_VAL"
  exit 0
fi

if [ "$MODE" = "docker" ]; then
  install_docker_mode
else
  install_baremetal_mode
fi
