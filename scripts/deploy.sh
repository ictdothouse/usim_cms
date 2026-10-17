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
# API_REPLICAS/FRONTEND_REPLICAS/ADMIN_REPLICAS (default 1 each) to scale, and
# SMOKE_TEST_HOST (a real tenant domain, required after the first release).
#
# Test gate: each app's own Dockerfile runs its typecheck/test step as part
# of the image build (see apps/api/Dockerfile's comment) — a failing test
# fails scripts/build-images.sh (here, or in CI before an image is ever
# pushed), which aborts this script (set -e) before any live container is
# ever touched.
#
# Images: built here by default; with UCMS_IMAGE_REPO set in .env they are
# pulled instead, as CI built them for this exact commit (any registry —
# see scripts/build-images.sh).
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

# Older .env files predate the dedicated database-provisioner role. Create its
# secret before Compose interpolates the new required DB/API settings.
bash scripts/ensure-provisioner-secret.sh
bash scripts/ensure-setup-secret.sh

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
SMOKE_TEST_HOST="${SMOKE_TEST_HOST:-}"
SMOKE_TEST_PATH="${SMOKE_TEST_PATH:-/}"
UCMS_IMAGE_REPO="${UCMS_IMAGE_REPO:-}"
IMAGE_WAIT_SECONDS="${IMAGE_WAIT_SECONDS:-900}"
STATE_FILE="$REPO_DIR/.deploy-color"
RELEASE_FILE="docker-compose.release.yml"
HEALTH_TRIES=45 # 45 * 2s = 90s budget
HEALTH_INTERVAL=2

CURRENT=""
[ -f "$STATE_FILE" ] && CURRENT="$(cat "$STATE_FILE")"

# All three app services declare healthchecks in docker-compose.release.yml.
# Keep the fallback for older images during a rollback.
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

# Docker's own healthcheck (container_healthy above) hits /health, which
# deliberately never renders a real page (server.mjs's own comment: "must
# never depend on a tenant or the api being reachable") — so a build that
# crashes only mid-render (2026-09-17's "RADIUS is not defined" SSR outage:
# typechecked clean, passed /health, then threw on every real page once
# promoted) sails straight through wait_for_healthy. This fetches one real
# tenant page through the NEW color's own frontend container, the way a
# browser actually would, before promote ever flips traffic to it.
# The first installation may have no tenant yet. Subsequent releases must
# configure a real tenant host, or the deployment cannot prove pages render.
smoke_test() {
  local project="$1" name="$2" body
  if [ -z "$SMOKE_TEST_HOST" ]; then
    if [ -z "$CURRENT" ]; then
      echo "First release has no tenant yet; skipping real-page smoke test." >&2
      return 0
    fi
    echo "SMOKE_TEST_HOST is required for updates. Set a real tenant domain in .env before deploying." >&2
    return 1
  fi
  echo "-- smoke-testing $SMOKE_TEST_HOST$SMOKE_TEST_PATH via $name --"
  if ! body=$(docker compose -p "$project" -f "$RELEASE_FILE" exec -T "$name" \
    wget -qO- --header="Host: $SMOKE_TEST_HOST" "http://127.0.0.1:4321$SMOKE_TEST_PATH" 2>&1); then
    echo "smoke test request failed:" >&2
    echo "$body" >&2
    return 1
  fi
  # A stream that broke mid-render (this outage's exact failure mode) never
  # reaches its closing tag — cheap enough to catch without parsing HTML.
  if ! echo "$body" | grep -qi "</html>"; then
    echo "smoke test response looks truncated/broken (no closing </html>):" >&2
    echo "$body" | tail -20 >&2
    return 1
  fi
  return 0
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
#
# Retries: the promote endpoint's own Caddy /load push is idempotent (same
# desired-state config every attempt, see proxy-sync.ts's syncCaddy), so a
# transient "Caddy admin request timed out" (seen twice now — recurs when
# Caddy is briefly busy, e.g. reloading TLS state for tenant domains) is safe
# to retry rather than rolling the whole deploy back on the first flake.
promote() {
  local project="$1" body="$2" resp attempt
  for attempt in 1 2 3; do
    if resp=$(docker compose -p "$project" -f "$RELEASE_FILE" exec -T \
      -e "DEPLOY_SECRET=$DEPLOY_SECRET" -e "PROMOTE_BODY=$body" \
      api node -e "$PROMOTE_SCRIPT" 2>&1) && echo "$resp" | grep -q '"promoted":true'; then
      echo "$resp"
      return 0
    fi
    echo "Promote attempt $attempt/3 failed:" >&2
    echo "$resp" >&2
    [ "$attempt" -lt 3 ] && sleep 5
  done
  return 1
}

# A server can deploy right after a push, while CI is still building that
# commit, so a missing image is retried until IMAGE_WAIT_SECONDS.
pull_images() {
  local svc out deadline=$((SECONDS + IMAGE_WAIT_SECONDS))
  for svc in api frontend admin; do
    until out=$(docker pull -q "$UCMS_IMAGE_REPO/$svc:$UCMS_IMAGE_TAG" 2>&1); do
      if [ "$SECONDS" -ge "$deadline" ]; then
        echo "$out" >&2
        echo "No $UCMS_IMAGE_REPO/$svc:$UCMS_IMAGE_TAG after ${IMAGE_WAIT_SECONDS}s: check that CI built this commit and that this server ran docker login for the registry." >&2
        exit 1
      fi
      echo "   $svc:$UCMS_IMAGE_TAG not in the registry yet, waiting for CI..."
      sleep 15
    done
  done
}

# Images are tagged per commit, so each deploy leaves the previous ones
# unused. Ones a container still uses (the stopped rollback color) are never
# removed. Build cache is trimmed by scripts/build-images.sh itself.
prune_images() {
  echo "-- pruning unused images --"
  docker image prune -af >/dev/null || true
}

do_deploy() {
  local next project
  if [ "$CURRENT" = "blue" ]; then next="green"; else next="blue"; fi
  project="ucms-$next"

  echo "== usim_cms deploy: ${CURRENT:-<none yet>} -> $next =="

  # Run these only for a new release. Rollback must remain available even
  # when the registry is offline or the current revision fails an audit.
  echo "-- auditing the locked dependency graph before deployment --"
  if grep -Eq '^[[:space:]]*(ignore|ignoreGhsas):[[:space:]]*(\[|$)' pnpm-workspace.yaml; then
    echo "Audit ignore rules are configured; refusing an unreviewed release." >&2
    exit 1
  fi
  pnpm audit
  echo "-- checking monitor code and security-status regression tests --"
  node --check monitor/server.js
  node --check monitor/security.js
  node --check monitor/supervisor.js
node --test monitor/security.test.js monitor/dashboard.test.js

  echo "-- ensuring PostgreSQL is up before SCRAM role migration --"
  docker compose up -d db
  bash scripts/configure-docker-db-roles.sh
  echo "-- ensuring PgBouncer, cache and proxy are up --"
  docker compose up -d pgbouncer redis proxy

  # A listening pooler can still fail every backend login (for example the
  # PgBouncer 1.25.2 SCRAM reconnect regression). Probe a real control-plane
  # query before building an idle color; no database password enters argv or
  # the deploy log because it stays inside the db container environment.
  echo "-- verifying PgBouncer can log in to PostgreSQL --"
  if ! docker compose exec -T db sh -ec \
    'PGPASSWORD="$POSTGRES_APP_PASSWORD" psql -h pgbouncer -p 6432 -U usim_cms_app -d usim_cms -Atq -c "SELECT 1" | grep -qx 1'; then
    echo "PgBouncer cannot reach PostgreSQL as usim_cms_app; aborting before the idle color starts." >&2
    docker compose logs --tail 40 pgbouncer db >&2 || true
    exit 1
  fi

  # Every image is tagged with the commit it was built from (and a release
  # with its version too), so a server runs exactly what was built and tested
  # for its own checkout: one sitting on a release tag pulls :v1.2.3, anything
  # else :<commit>. install.sh's configure_image_source derives it the same
  # way. safe.directory: root (install.sh, the monitor) reading a checkout
  # another user cloned.
  UCMS_IMAGE_TAG="${UCMS_IMAGE_TAG:-$(git -c safe.directory='*' describe --tags --exact-match --match 'v[0-9]*' 2>/dev/null ||
    git -c safe.directory='*' rev-parse HEAD)}"
  export UCMS_IMAGE_TAG
  # Runs on every exit from here, failed deploys included.
  trap prune_images EXIT
  if [ -z "$UCMS_IMAGE_REPO" ]; then
    echo "-- building images for $UCMS_IMAGE_TAG --"
    export UCMS_IMAGE_REPO=localhost/ucms
    bash scripts/build-images.sh
  else
    echo "-- pulling $UCMS_IMAGE_REPO images for $UCMS_IMAGE_TAG --"
    export UCMS_IMAGE_REPO
    pull_images
  fi

  # The uploads volume docker-compose.release.yml mounts (`external: true`,
  # so it must exist first): the default ucms-uploads, or the folder/NFS
  # share .env's UPLOADS_PATH/UPLOADS_NFS name. A changed location is copied
  # over here while $CURRENT keeps serving, and finished after promote below.
  local api_image="$UCMS_IMAGE_REPO/api:$UCMS_IMAGE_TAG"
  UPLOADS_VOLUME="$(bash scripts/uploads-volume.sh prepare "$api_image")"
  export UPLOADS_VOLUME

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

  if ! smoke_test "$project" frontend; then
    echo "" >&2
    echo "$next failed the real-page smoke test — leaving ${CURRENT:-<none>} live untouched." >&2
    echo "-- recent API and frontend logs --" >&2
    docker compose -p "$project" -f "$RELEASE_FILE" logs --tail 100 api frontend >&2 || true
    docker compose -p "$project" -f "$RELEASE_FILE" down
    exit 1
  fi
  echo "$next passed the smoke test."

  echo "-- smoke-testing the new admin SPA --"
  local admin_body
  if ! admin_body=$(docker compose -p "$project" -f "$RELEASE_FILE" exec -T admin \
    wget -qO- http://127.0.0.1:8080/ 2>&1) || ! echo "$admin_body" | grep -qi '</html>'; then
    echo "Admin SPA smoke test failed — leaving ${CURRENT:-<none>} live untouched." >&2
    echo "$admin_body" | tail -20 >&2
    docker compose -p "$project" -f "$RELEASE_FILE" down
    exit 1
  fi

  local body
  body=$(printf '{"admin":%s,"api":%s,"frontend":%s}' \
    "$(dial_json 8080 "${admin_names[@]}")" \
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

  # No-op unless prepare started an uploads move. A failure here never
  # fails the deploy ($next is already live on the new volume) — the move
  # stays pending and the next deploy redoes it from the start.
  bash scripts/uploads-volume.sh finish "$api_image" ||
    echo "WARNING: uploads move didn't finish — files uploaded during this deploy may be missing; run another deploy to redo it." >&2

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
    "$(dial_json 8080 "${admin_names[@]}")" \
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
