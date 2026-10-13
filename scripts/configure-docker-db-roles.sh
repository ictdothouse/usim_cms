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

# Passwords are passed through the container environment and psql variables,
# never embedded in the local docker command line.
docker compose exec -T db sh -c \
  'psql -U postgres -d usim_cms -v ON_ERROR_STOP=1 -v app_password="$POSTGRES_APP_PASSWORD" -v provisioner_password="$POSTGRES_PROVISIONER_PASSWORD"' \
  < apps/api/scripts/rotate-db-role-passwords.sql >/dev/null

echo "PostgreSQL app and provisioner roles are configured."
