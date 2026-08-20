#!/usr/bin/env bash
# Blue-green zero-downtime deploy for the app tier (api/frontend/admin).
# db+proxy (docker-compose.yml) stay up the whole time as the shared base —
# this script only ever touches docker-compose.release.yml's services,
# alternating between a `ucms-blue` and `ucms-green` compose project so one
# color is always serving live traffic while the other is being built and
# health-checked. See CLAUDE.md's Deployment section for the full picture.
#
# Usage: scripts/deploy.sh
# Reads .env (repo root) for: DEPLOY_SECRET (required — must match the api
# container's own, see docker-compose.release.yml), and optionally
# API_REPLICAS/FRONTEND_REPLICAS/ADMIN_REPLICAS (default 1 each) to scale.
#
# On any failure before the promote step succeeds, the previously-live color
# is left completely untouched (zero impact) and the failed new color is
# torn down. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DEPLOY_SECRET="${DEPLOY_SECRET:?set DEPLOY_SECRET in .env}"
API_REPLICAS="${API_REPLICAS:-1}"
FRONTEND_REPLICAS="${FRONTEND_REPLICAS:-1}"
ADMIN_REPLICAS="${ADMIN_REPLICAS:-1}"
STATE_FILE="$REPO_DIR/.deploy-color"
RELEASE_FILE="docker-compose.release.yml"
HEALTH_TRIES=45 # 45 * 2s = 90s budget
HEALTH_INTERVAL=2

CURRENT=""
[ -f "$STATE_FILE" ] && CURRENT="$(cat "$STATE_FILE")"
if [ "$CURRENT" = "blue" ]; then NEXT="green"; else NEXT="blue"; fi
PROJECT="ucms-$NEXT"

echo "== usim_cms deploy: ${CURRENT:-<none yet>} -> $NEXT =="

echo "-- ensuring base (db+proxy) is up --"
docker compose up -d db proxy

# ucms-uploads (docker-compose.yml) isn't mounted by db/proxy, so the `up`
# above never creates it — but docker-compose.release.yml's api service
# references it as `external: true` (must already exist). Idempotent.
docker volume create ucms-uploads >/dev/null

echo "-- building & starting $NEXT --"
docker compose -p "$PROJECT" -f "$RELEASE_FILE" build
docker compose -p "$PROJECT" -f "$RELEASE_FILE" up -d --remove-orphans \
  --scale api="$API_REPLICAS" --scale frontend="$FRONTEND_REPLICAS" --scale admin="$ADMIN_REPLICAS"

# Compose's own deterministic container naming (<project>-<service>-<index>)
# — no docker inspect/introspection needed to know what just started.
names_for() {
  local service="$1" count="$2" i
  for ((i = 1; i <= count; i++)); do
    echo "${PROJECT}-${service}-${i}"
  done
}
mapfile -t api_names < <(names_for api "$API_REPLICAS")
mapfile -t frontend_names < <(names_for frontend "$FRONTEND_REPLICAS")
mapfile -t admin_names < <(names_for admin "$ADMIN_REPLICAS")

# Treats "no HEALTHCHECK defined" (admin has none) as healthy once running —
# only api/frontend declare a real one in docker-compose.release.yml.
container_healthy() {
  local name="$1" status
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo "missing")"
  case "$status" in
    healthy) return 0 ;;
    none) [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)" = "true" ] ;;
    *) return 1 ;;
  esac
}

echo "-- waiting for $NEXT to report healthy (up to $((HEALTH_TRIES * HEALTH_INTERVAL))s) --"
all_names=("${api_names[@]}" "${frontend_names[@]}" "${admin_names[@]}")
ok="false"
for ((try = 0; try < HEALTH_TRIES; try++)); do
  healthy_count=0
  for name in "${all_names[@]}"; do
    container_healthy "$name" && healthy_count=$((healthy_count + 1))
  done
  if [ "$healthy_count" -eq "${#all_names[@]}" ]; then
    ok="true"
    break
  fi
  sleep "$HEALTH_INTERVAL"
done

teardown_next() {
  docker compose -p "$PROJECT" -f "$RELEASE_FILE" down
}

if [ "$ok" != "true" ]; then
  echo "" >&2
  echo "$NEXT never became healthy — leaving ${CURRENT:-<none>} live untouched." >&2
  docker compose -p "$PROJECT" -f "$RELEASE_FILE" logs --tail 50 >&2 || true
  teardown_next
  exit 1
fi
echo "$NEXT is healthy."

# Dial list for one service, e.g. ["ucms-green-api-1:3000","ucms-green-api-2:3000"]
dial_json() {
  local port="$1"
  shift
  local out="[" first="true" name
  for name in "$@"; do
    [ "$first" = "true" ] || out+=","
    out+="\"${name}:${port}\""
    first="false"
  done
  out+="]"
  printf '%s' "$out"
}

BODY=$(printf '{"admin":%s,"api":%s,"frontend":%s}' \
  "$(dial_json 80 "${admin_names[@]}")" \
  "$(dial_json 3000 "${api_names[@]}")" \
  "$(dial_json 4321 "${frontend_names[@]}")")

echo "-- promoting $NEXT (flipping Caddy's routes) --"
# Runs container-to-container via `docker compose exec`, using Node's own
# built-in fetch (Node 22) rather than the image's busybox wget — wget's
# --post-data/--header support varies across busybox builds, fetch doesn't.
PROMOTE_SCRIPT='
fetch("http://127.0.0.1:3000/internal/deploy/promote", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-deploy-secret": process.env.DEPLOY_SECRET },
  body: process.env.PROMOTE_BODY,
}).then(async (r) => {
  console.log(await r.text());
  process.exit(r.ok ? 0 : 1);
}).catch((e) => { console.error(String(e)); process.exit(1); });
'
if ! RESP=$(docker compose -p "$PROJECT" -f "$RELEASE_FILE" exec -T \
  -e "DEPLOY_SECRET=$DEPLOY_SECRET" -e "PROMOTE_BODY=$BODY" \
  api node -e "$PROMOTE_SCRIPT" 2>&1); then
  echo "Promote request failed — leaving ${CURRENT:-<none>} live untouched." >&2
  echo "$RESP" >&2
  teardown_next
  exit 1
fi
echo "$RESP"
if ! echo "$RESP" | grep -q '"promoted":true'; then
  echo "Promote rejected — leaving ${CURRENT:-<none>} live untouched." >&2
  teardown_next
  exit 1
fi

echo "$NEXT" >"$STATE_FILE"
echo "Promoted $NEXT — it is now live."

if [ -n "$CURRENT" ]; then
  echo "-- tearing down old color ($CURRENT) --"
  docker compose -p "ucms-$CURRENT" -f "$RELEASE_FILE" down || true
fi

echo "== deploy complete: $NEXT is live =="
