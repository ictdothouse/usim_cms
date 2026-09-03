#!/bin/bash
# docker-entrypoint-initdb.d runs this right after 01-setup-db-role.sql, on
# the SAME first-boot-only, empty-data-dir pass — see that file's own header.
# It creates usim_cms_app with a hardcoded placeholder password; this
# overwrites it with the real one from POSTGRES_APP_PASSWORD (.env), forced
# into classic md5 storage (`SET password_encryption`) rather than
# Postgres 16's scram-sha-256 default, so it matches the md5 hash
# pgbouncer/userlist.txt is generated with (install.sh, from this same env
# var) — pgbouncer's own auth_type=md5 needs the two to agree byte-for-byte.
# Existing deployments: this file is new, so an already-initialized data dir
# never re-runs it — rotating a LIVE role needs the same ALTER ROLE run by
# hand, see CLAUDE.md's deployment section.
set -euo pipefail

: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set (see .env.example)}"

psql -v ON_ERROR_STOP=1 --username postgres --dbname "$POSTGRES_DB" <<-EOSQL
  SET password_encryption = 'md5';
  ALTER ROLE usim_cms_app WITH PASSWORD '${POSTGRES_APP_PASSWORD}';
EOSQL
