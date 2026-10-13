#!/usr/bin/env bash
# Apply DB-role upgrades on both fresh and existing Docker PostgreSQL volumes.
# The initdb hooks handle a new data directory; this script also runs the same
# idempotent setup against an already initialized database during deployment.
set -euo pipefail
cd "$(dirname "$0")/.."

ready=false
for _ in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "PostgreSQL did not become ready; cannot configure application roles." >&2
  exit 1
fi

docker compose exec -T db psql -U postgres -d usim_cms -v ON_ERROR_STOP=1 \
  -f /docker-entrypoint-initdb.d/01-setup-db-role.sql >/dev/null

# Migrate existing MD5 roles once. Avoid changing the SCRAM salts on each
# redeploy: doing that would invalidate PgBouncer's live verifier briefly.
roles_scram="$(docker compose exec -T db psql -U postgres -d usim_cms -Atq \
  -c "SELECT count(*) = 3 AND bool_and(rolpassword LIKE 'SCRAM-SHA-256\$%') FROM pg_authid WHERE rolname IN ('postgres', 'usim_cms_app', 'usim_cms_provisioner')")"
if [ "$roles_scram" != "t" ]; then
  # Passwords are passed through the container environment and psql
  # variables, never embedded in the local docker command line.
  docker compose exec -T db sh -c \
    'psql -U postgres -d usim_cms -v ON_ERROR_STOP=1 -v superuser_password="$POSTGRES_SUPERUSER_PASSWORD" -v app_password="$POSTGRES_APP_PASSWORD" -v provisioner_password="$POSTGRES_PROVISIONER_PASSWORD"' \
    < apps/api/scripts/rotate-db-role-passwords.sql >/dev/null
fi

# PgBouncer needs PostgreSQL's exact SCRAM verifier, including the same salt,
# to authenticate to the backend. Keep it out of logs and only readable by
# PgBouncer's container group (gid 70).
verifier="$(docker compose exec -T db psql -U postgres -d usim_cms -Atq \
  -c "SELECT rolpassword FROM pg_authid WHERE rolname = 'usim_cms_app'" | tr -d '\r\n')"
case "$verifier" in
  SCRAM-SHA-256\$*) ;;
  *) echo "PostgreSQL did not return a SCRAM verifier for usim_cms_app." >&2; exit 1 ;;
esac

current_verifier="$(sed -nE 's/^"usim_cms_app" "([^"]+)"$/\1/p' pgbouncer/userlist.txt 2>/dev/null || true)"
if [ "$current_verifier" != "$verifier" ]; then
  userlist_tmp="$(mktemp)"
  trap 'rm -f "$userlist_tmp"' EXIT
  printf '"usim_cms_app" "%s"\n' "$verifier" > "$userlist_tmp"
  chmod 600 "$userlist_tmp"

  pgbouncer_running="$(docker compose ps --status running -q pgbouncer)"
  if [ "$(id -u)" -eq 0 ]; then
    cat "$userlist_tmp" > pgbouncer/userlist.txt
    chown 0:70 pgbouncer/userlist.txt
    chmod 640 pgbouncer/userlist.txt
  else
    # Use a short-lived root helper so regular Docker-group deploys can
    # refresh the root:70 host file without exposing it to other host users.
    # This uses the current Compose mount (read/write) and works before the
    # long-lived PgBouncer service has been recreated.
    docker compose run --rm --no-deps -T --user 0 --entrypoint sh pgbouncer -ec \
      'cat > /etc/pgbouncer/userlist.txt && chown 0:70 /etc/pgbouncer/userlist.txt && chmod 640 /etc/pgbouncer/userlist.txt' \
      < "$userlist_tmp"
  fi
  if [ -n "$pgbouncer_running" ]; then
    docker compose kill -s HUP pgbouncer
  fi
fi

echo "PostgreSQL superuser, app and provisioner roles are configured with SCRAM-SHA-256."
