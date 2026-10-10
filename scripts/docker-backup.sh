#!/usr/bin/env bash
# Cron entry point for apps/api/scripts/backup.sh + backup-media.sh under
# docker/production mode. Not meant to be edited per install — install.sh's
# install_backup_cron() wires this into root's crontab with BACKUP_DIR/
# RETENTION_DAYS already set as cron-level env vars (see its own comment).
#
# Usage: scripts/docker-backup.sh [tenant-host ...]   (no args = everything)
#
# Why backup.sh can't just run directly from a host cron job in docker mode:
# docker-compose.yml deliberately never publishes `db`'s port to the host (see
# its own comment on the db service) — only containers on the `ucms-net`
# network can reach it at all. This runs backup.sh INSIDE a one-off
# postgres:16-alpine container (same image `db` itself uses, so pg_dump/psql
# versions always match) attached to that network, talking to `db:5432`
# directly rather than through pgbouncer — a pg_dump can run for a while, and
# holding one of pgbouncer's few pooled backend connections for that whole
# run would eat into the connection budget documented in
# .claude/skills/deployment/SKILL.md for no benefit (nothing else needs to
# share this specific connection).
#
# backup-media.sh needs no such wrapper — it already runs on the host and
# auto-resolves the named `ucms-uploads` volume's real host path via `docker
# volume inspect` (see its own header), which only needs the docker CLI, not
# network access into a container.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
: "${POSTGRES_APP_PASSWORD:?set POSTGRES_APP_PASSWORD in .env}"

docker run --rm \
  --network ucms-net \
  -e "DATABASE_URL=postgres://usim_cms_app:${POSTGRES_APP_PASSWORD}@db:5432/usim_cms" \
  -e "BACKUP_DIR=/backup" \
  -e "RETENTION_DAYS=${RETENTION_DAYS:-14}" \
  -v "${BACKUP_DIR:-/var/backups/usim_cms}:/backup" \
  -v "$(pwd)/apps/api/scripts/backup.sh:/backup.sh:ro" \
  postgres:16-alpine bash /backup.sh "$@"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/usim_cms}" \
RETENTION_DAYS="${RETENTION_DAYS:-14}" \
  bash apps/api/scripts/backup-media.sh "$@"
