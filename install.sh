#!/usr/bin/env bash
# One-shot installer for a test/staging VPS (Ubuntu). Safe to re-run.
#
# What it does, in order:
#   1. Installs Docker Engine only if missing (official get.docker.com repo —
#      doesn't touch any other apt sources, so it won't fight whatever else
#      is already running on this box).
#   2. Picks free host ports for api/frontend/admin (3000/4321/5173 by
#      default, auto-incremented if already taken by another service on this
#      VPS) and writes them to a generated docker-compose.override.yml.
#   3. Detects this box's public IP so the admin's build (VITE_API_URL/
#      VITE_FRONTEND_URL are baked in at build time) points at a URL your
#      browser can actually reach, not "localhost" (which would mean YOUR
#      machine, not the VPS).
#   4. Generates POSTGRES_SUPERUSER_PASSWORD/SESSION_SECRET the first time
#      only (never overwrites a secret you already have).
#   5. Builds + starts db/api/frontend/admin (skips the `proxy` service —
#      that's for a real domain + TLS, not IP-based testing).
#   6. Installs the ops monitor (monitor/server.js) as a systemd service on
#      port 5555, behind HTTP Basic Auth with a freshly generated password.
#   7. Opens the chosen ports in ufw, only if ufw is already active (never
#      installs/enables a firewall that wasn't already there).
#
# Run: sudo ./install.sh
set -euo pipefail
cd "$(dirname "$0")"
REPO_DIR="$(pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./install.sh" >&2
  exit 1
fi

echo "== usim_cms VPS installer =="
echo "Repo: $REPO_DIR"
echo ""

# ---------------------------------------------------------------------------
# 1. Docker (only if missing)
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# 2. Free-port detection (never reuse a port something else already owns)
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

API_PORT=$(find_free_port 3000)
FRONTEND_PORT=$(find_free_port 4321)
ADMIN_PORT=$(find_free_port 5173)
MONITOR_PORT=$(find_free_port 5555)

echo ""
echo "Ports chosen (auto-picked next free one if the default was taken):"
echo "  api      -> $API_PORT"
echo "  frontend -> $FRONTEND_PORT"
echo "  admin    -> $ADMIN_PORT"
echo "  monitor  -> $MONITOR_PORT"

# ---------------------------------------------------------------------------
# 3. Public IP (for the browser-facing admin build)
# ---------------------------------------------------------------------------
PUBLIC_HOST="${PUBLIC_HOST:-}"
if [ -z "$PUBLIC_HOST" ]; then
  PUBLIC_HOST=$(curl -fs -4 --max-time 5 ifconfig.me 2>/dev/null || true)
fi
if [ -z "$PUBLIC_HOST" ]; then
  PUBLIC_HOST=$(curl -fs -4 --max-time 5 icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)
fi
if [ -z "$PUBLIC_HOST" ]; then
  PUBLIC_HOST=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$PUBLIC_HOST" ]; then
  PUBLIC_HOST="localhost"
  echo "Warning: could not detect a public IP, falling back to localhost." >&2
  echo "         Set PUBLIC_HOST=<your-vps-ip> ./install.sh to override." >&2
fi
echo "Public host: $PUBLIC_HOST"

# ---------------------------------------------------------------------------
# 4. .env — create once, fill blank secrets once, always refresh the
#    derived (not secret) VITE_*/port values so a re-run with different
#    ports/IP stays correct.
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
fi

fill_if_blank() {
  local key="$1"
  if grep -qE "^${key}=\s*$" .env; then
    local value
    value=$(openssl rand -hex 24)
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
    echo "Generated a random ${key}."
  fi
}
set_kv() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    echo "${key}=${value}" >> .env
  fi
}

fill_if_blank POSTGRES_SUPERUSER_PASSWORD
fill_if_blank SESSION_SECRET
set_kv VITE_API_URL "http://${PUBLIC_HOST}:${API_PORT}"
set_kv VITE_FRONTEND_URL "http://${PUBLIC_HOST}:${FRONTEND_PORT}"

# ---------------------------------------------------------------------------
# 5. Port override (docker-compose.yml itself stays untouched/tracked;
#    this generated file remaps only the host side of each port mapping)
# ---------------------------------------------------------------------------
cat > docker-compose.override.yml <<EOF
# Auto-generated by install.sh — safe to delete, will be recreated on the
# next run. Remaps host-side ports to whatever was actually free on this box.
services:
  api:
    ports:
      - "${API_PORT}:3000"
  frontend:
    ports:
      - "${FRONTEND_PORT}:4321"
  admin:
    ports:
      - "${ADMIN_PORT}:80"
EOF

# ---------------------------------------------------------------------------
# 6. Build + start (db/api/frontend/admin only — `proxy` is for a real
#    domain + TLS, not IP-based testing)
# ---------------------------------------------------------------------------
echo ""
echo "Building and starting containers (first run can take a few minutes)..."
docker compose up -d --build db api frontend admin

echo ""
echo "Waiting for the API to become healthy..."
for _ in $(seq 1 30); do
  if curl -fs "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ---------------------------------------------------------------------------
# 7. Ops monitor (systemd, port from step 2, Basic Auth)
# ---------------------------------------------------------------------------
echo ""
echo "Setting up the ops monitor..."

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js not found on this host — installing (NodeSource, its own apt repo only)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  NODE_BIN="$(command -v node)"
else
  echo "Reusing existing Node.js: $NODE_BIN ($($NODE_BIN --version))"
fi

if [ ! -f /etc/usim-cms-monitor.env ]; then
  MONITOR_PASSWORD="$(openssl rand -hex 16)"
  cat > /etc/usim-cms-monitor.env <<EOF
MONITOR_PORT=${MONITOR_PORT}
REPO_DIR=${REPO_DIR}
MONITOR_USER=admin
MONITOR_PASSWORD=${MONITOR_PASSWORD}
EOF
  chmod 600 /etc/usim-cms-monitor.env
  echo "Generated monitor password (also saved in /etc/usim-cms-monitor.env)."
else
  # Keep the existing password, but the port/repo path may have changed.
  sed -i.bak \
    -e "s|^MONITOR_PORT=.*|MONITOR_PORT=${MONITOR_PORT}|" \
    -e "s|^REPO_DIR=.*|REPO_DIR=${REPO_DIR}|" \
    /etc/usim-cms-monitor.env
  rm -f /etc/usim-cms-monitor.env.bak
  MONITOR_PASSWORD="$(grep '^MONITOR_PASSWORD=' /etc/usim-cms-monitor.env | cut -d= -f2-)"
  echo "Reusing existing monitor password from /etc/usim-cms-monitor.env."
fi

sed -e "s|__NODE_BIN__|${NODE_BIN}|g" -e "s|__REPO_DIR__|${REPO_DIR}|g" \
  monitor/usim-cms-monitor.service.template > /etc/systemd/system/usim-cms-monitor.service
systemctl daemon-reload
systemctl enable --now usim-cms-monitor
systemctl restart usim-cms-monitor

# ---------------------------------------------------------------------------
# 8. Firewall — only touch ufw if it's already the active firewall here
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo ""
  echo "ufw is active — opening the ports this stack uses..."
  for p in "$API_PORT" "$FRONTEND_PORT" "$ADMIN_PORT" "$MONITOR_PORT"; do
    ufw allow "${p}/tcp" >/dev/null
  done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "================================================================"
echo " Done."
echo "   Admin panel:  http://${PUBLIC_HOST}:${ADMIN_PORT}"
echo "   Public site:  http://${PUBLIC_HOST}:${FRONTEND_PORT}"
echo "   API:          http://${PUBLIC_HOST}:${API_PORT}"
echo "   Ops monitor:  http://${PUBLIC_HOST}:${MONITOR_PORT}"
echo "     user: admin"
echo "     pass: ${MONITOR_PASSWORD}"
echo "     (also saved in /etc/usim-cms-monitor.env on this VPS)"
echo ""
echo " First time here? Just open the admin panel URL above — with zero"
echo " users in the database it shows a setup wizard automatically."
echo "================================================================"
