#!/usr/bin/env bash
# Cron entry point for apps/api/scripts/backup.sh + backup-media.sh under
# bare-metal mode. Not meant to be edited per install — install.sh's
# install_backup_cron() wires this into root's crontab with BACKUP_DIR/
# RETENTION_DAYS already set as cron-level env vars (see its own comment).
#
# Usage: scripts/baremetal-backup.sh [tenant-host ...]   (no args = everything)
#
# Unlike docker-backup.sh's sibling, bare-metal mode has no container network
# boundary to work around — apps/api/.env's DATABASE_URL already points at a
# directly reachable Postgres (either installed by install.sh's ensure_postgres
# or an existing cluster it was told to reuse), so backup.sh just needs that
# env sourced. UPLOADS_DIR is a plain host directory here too (see
# backup-media.sh's own header), not a named Docker volume.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
source apps/api/.env
set +a

bash apps/api/scripts/backup.sh "$@"

UPLOADS_DIR="${UPLOADS_DIR:-apps/api/uploads}" \
BACKUP_DIR="${BACKUP_DIR:-/var/backups/usim_cms}" \
RETENTION_DAYS="${RETENTION_DAYS:-14}" \
  bash apps/api/scripts/backup-media.sh "$@"
