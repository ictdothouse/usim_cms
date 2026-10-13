#!/bin/bash
# docker-entrypoint-initdb.d runs this right after 01-setup-db-role.sql, on
# the SAME first-boot-only, empty-data-dir pass — see that file's own header.
# It creates usim_cms_app with a hardcoded placeholder password; this
# overwrites it with the real one from POSTGRES_APP_PASSWORD (.env), forced
# into SCRAM-SHA-256 storage. After startup, configure-docker-db-roles.sh
# copies PostgreSQL's exact verifier into PgBouncer's private auth file.
# Existing deployments: this file is new, so an already-initialized data dir
# never re-runs it — rotating a LIVE role needs the same ALTER ROLE run by
# hand, see CLAUDE.md's deployment section.
set -euo pipefail

: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set (see .env.example)}"

psql -v ON_ERROR_STOP=1 \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  --username postgres --dbname "$POSTGRES_DB" <<-'EOSQL'
  SET password_encryption = 'scram-sha-256';
  ALTER ROLE usim_cms_app WITH PASSWORD :'app_password';
EOSQL
