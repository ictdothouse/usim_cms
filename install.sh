#!/usr/bin/env bash
# Non-technical installer: checks Docker, generates secrets if missing,
# builds and starts the stack. Run: ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin not found. Install it: https://docs.docker.com/compose/install/"
  exit 1
fi

if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
fi

# Fill in any blank secret with a random value so a non-technical install
# never has to hand-edit .env just to get running.
fill_if_blank() {
  local key="$1"
  if grep -qE "^${key}=\s*$" .env; then
    local value
    value=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
    # portable in-place edit (works on both GNU and BSD/macOS sed)
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
    echo "Generated a random ${key}."
  fi
}
fill_if_blank POSTGRES_SUPERUSER_PASSWORD
fill_if_blank SESSION_SECRET

echo "Building and starting containers (this can take a few minutes the first time)..."
docker compose up -d --build

echo ""
echo "Waiting for the API to become healthy..."
for _ in $(seq 1 30); do
  if curl -fs http://localhost:3000/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo ""
echo "Done. Admin panel:    http://localhost:5173"
echo "      Public site:    http://localhost:4321"
echo "      API:            http://localhost:3000"
echo ""
echo "First-time setup (no superadmin account exists yet) — see README/wizard for creating one."
