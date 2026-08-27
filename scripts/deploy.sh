#!/usr/bin/env bash
# Blue-green zero-downtime deploy for the app tier (api/frontend/admin).
# db+proxy (docker-compose.yml) stay up the whole time as the shared base —
# this script only ever touches docker-compose.release.yml's services,
# alternating between a `ucms-blue` and `ucms-green` compose project so one
# color is always serving live traffic while the other is being built and
# health-checked. See CLAUDE.md's Deployment section for the full picture.
#
# Usage:
#   scripts/deploy.sh            build+test+deploy the idle color, promote it
#   scripts/deploy.sh rollback   flip back to the idle color with NO rebuild
#
# Reads .env (repo root) for: DEPLOY_SECRET (required — must match the api
# container's own, see docker-compose.release.yml), and optionally
# API_REPLICAS/FRONTEND_REPLICAS/ADMIN_REPLICAS (default 1 each) to scale.
#
# Test gate: each app's own Dockerfile runs its typecheck/test step as part
# of the image build (see apps/api/Dockerfile's comment) — a failing test
# fails `docker compose build` below, which aborts this script (set -e)
# before any live container is ever touched.
#
# On any deploy failure before promote succeeds, the previously-live color
# is left completely untouched (zero impact) and the failed new color is
# torn down. A successful promote no longer deletes the color it replaced —
# it's left stopped (not removed) so `rollback` can bring it back in
# seconds, with no rebuild. The next normal deploy overwrites that idle
# color's containers anyway, so there's no separate cleanup job needed.
# Safe to re-run either command.
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

# Polls container_healthy for every name in $2 (a nameref to an array),
# printing progress the same way for both the deploy and rollback paths.
wait_for_healthy() {
  local label="$1"
  local -n names_ref="$2"
  echo "-- waiting for $label to report healthy (up to $((HEALTH_TRIES * HEALTH_INTERVAL))s) --"
  local try healthy_count name
  for ((try = 0; try < HEALTH_TRIES; try++)); do
    healthy_count=0
    for name in "${names_ref[@]}"; do
      container_healthy "$name" && healthy_count=$((healthy_count + 1))
    done
    if [ "$healthy_count" -eq "${#names_ref[@]}" ]; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

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

# $1: project to promote (e.g. "ucms-green"), $2: JSON dial-list body
promote() {
  local project="$1" body="$2" resp
  if ! resp=$(docker compose -p "$project" -f "$RELEASE_FILE" exec -T \
    -e "DEPLOY_SECRET=$DEPLOY_SECRET" -e "PROMOTE_BODY=$body" \
    api node -e "$PROMOTE_SCRIPT" 2>&1); then
    echo "Promote request failed:" >&2
    echo "$resp" >&2
    return 1
  fi
  echo "$resp"
  echo "$resp" | grep -q '"promoted":true'
}

do_deploy() {
  local next project
  if [ "$CURRENT" = "blue" ]; then next="green"; else next="blue"; fi
  project="ucms-$next"

  echo "== usim_cms deploy: ${CURRENT:-<none yet>} -> $next =="

  echo "-- ensuring base (db+pgbouncer+redis+proxy) is up --"
  docker compose up -d db pgbouncer redis proxy

  # ucms-uploads (docker-compose.yml) isn't mounted by db/proxy, so the `up`
  # above never creates it — but docker-compose.release.yml's api service
  # references it as `external: true` (must already exist). Idempotent.
  docker volume create ucms-uploads >/dev/null

  echo "-- building & starting $next --"
  docker compose -p "$project" -f "$RELEASE_FILE" build
  docker compose -p "$project" -f "$RELEASE_FILE" up -d --remove-orphans \
    --scale api="$API_REPLICAS" --scale frontend="$FRONTEND_REPLICAS" --scale admin="$ADMIN_REPLICAS"

  # Compose's own deterministic container naming (<project>-<service>-<index>)
  # — no docker inspect/introspection needed to know what just started.
  local i api_names=() frontend_names=() admin_names=()
  for ((i = 1; i <= API_REPLICAS; i++)); do api_names+=("${project}-api-${i}"); done
  for ((i = 1; i <= FRONTEND_REPLICAS; i++)); do frontend_names+=("${project}-frontend-${i}"); done
  for ((i = 1; i <= ADMIN_REPLICAS; i++)); do admin_names+=("${project}-admin-${i}"); done
  local all_names=("${api_names[@]}" "${frontend_names[@]}" "${admin_names[@]}")

  if ! wait_for_healthy "$next" all_names; then
    echo "" >&2
    echo "$next never became healthy — leaving ${CURRENT:-<none>} live untouched." >&2
    docker compose -p "$project" -f "$RELEASE_FILE" logs --tail 50 >&2 || true
    docker compose -p "$project" -f "$RELEASE_FILE" down
    exit 1
  fi
  echo "$next is healthy."

  local body
  body=$(printf '{"admin":%s,"api":%s,"frontend":%s}' \
    "$(dial_json 80 "${admin_names[@]}")" \
    "$(dial_json 3000 "${api_names[@]}")" \
    "$(dial_json 4321 "${frontend_names[@]}")")

  echo "-- promoting $next (flipping Caddy's routes) --"
  if ! promote "$project" "$body"; then
    echo "leaving ${CURRENT:-<none>} live untouched." >&2
    docker compose -p "$project" -f "$RELEASE_FILE" down
    exit 1
  fi

  echo "$next" >"$STATE_FILE"
  echo "Promoted $next — it is now live."

  if [ -n "$CURRENT" ]; then
    echo "-- stopping old color ($CURRENT) — kept, not removed, for instant rollback --"
    docker compose -p "ucms-$CURRENT" -f "$RELEASE_FILE" stop || true
  fi

  echo "== deploy complete: $next is live =="
}

do_rollback() {
  if [ -z "$CURRENT" ]; then
    echo "No live color recorded (.deploy-color) — nothing to roll back from." >&2
    exit 1
  fi
  local prev project
  if [ "$CURRENT" = "blue" ]; then prev="green"; else prev="blue"; fi
  project="ucms-$prev"

  # Real container names (not an assumed replica count) — the idle color may
  # have last been deployed with a different API_REPLICAS/etc than .env
  # currently has.
  local api_names=() frontend_names=() admin_names=()
  mapfile -t api_names < <(docker compose -p "$project" -f "$RELEASE_FILE" ps -a --format '{{.Name}}' api)
  mapfile -t frontend_names < <(docker compose -p "$project" -f "$RELEASE_FILE" ps -a --format '{{.Name}}' frontend)
  mapfile -t admin_names < <(docker compose -p "$project" -f "$RELEASE_FILE" ps -a --format '{{.Name}}' admin)

  if [ "${#api_names[@]}" -eq 0 ]; then
    echo "No idle '$prev' color found — nothing to roll back to (fresh install, trial mode, or already rolled back once)." >&2
    exit 1
  fi
  local all_names=("${api_names[@]}" "${frontend_names[@]}" "${admin_names[@]}")

  echo "== usim_cms rollback: $CURRENT -> $prev =="
  echo "-- starting idle $prev containers (no rebuild) --"
  docker compose -p "$project" -f "$RELEASE_FILE" start

  if ! wait_for_healthy "$prev" all_names; then
    echo "" >&2
    echo "$prev never became healthy — leaving $CURRENT live untouched." >&2
    docker compose -p "$project" -f "$RELEASE_FILE" logs --tail 50 >&2 || true
    exit 1
  fi
  echo "$prev is healthy."

  local body
  body=$(printf '{"admin":%s,"api":%s,"frontend":%s}' \
    "$(dial_json 80 "${admin_names[@]}")" \
    "$(dial_json 3000 "${api_names[@]}")" \
    "$(dial_json 4321 "${frontend_names[@]}")")

  echo "-- promoting $prev (flipping Caddy's routes back) --"
  if ! promote "$project" "$body"; then
    echo "leaving $CURRENT live untouched." >&2
    exit 1
  fi

  echo "$prev" >"$STATE_FILE"
  # Symmetric with do_deploy's own "stop, don't remove" — a rollback can
  # itself be rolled forward again the same way.
  echo "-- stopping $CURRENT — kept, not removed, so this rollback can itself be undone --"
  docker compose -p "ucms-$CURRENT" -f "$RELEASE_FILE" stop || true

  echo "== rollback complete: $prev is live =="
}

case "${1:-}" in
  rollback) do_rollback ;;
  "") do_deploy ;;
  *)
    echo "Usage: $0 [rollback]" >&2
    exit 1
    ;;
esac
