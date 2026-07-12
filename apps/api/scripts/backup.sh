#!/usr/bin/env bash
# Usage: backup.sh [tenant-host ...]   (no args = full-instance backup, all tenants)
# Restore one tenant only: pg_restore -n tenant_x -d usim_cms backup.dump
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/usim_cms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

to_schema() { echo "tenant_$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')"; }

if [ "$#" -eq 0 ]; then
  OUT="$BACKUP_DIR/usim_cms_full_$TIMESTAMP.dump"
  pg_dump -Fc "$DATABASE_URL" -f "$OUT"
else
  SCHEMA_ARGS=()
  for host in "$@"; do
    SCHEMA_ARGS+=(-n "$(to_schema "$host")")
  done
  NAME=$(echo "$*" | tr ' ' '_' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]/_/g')
  OUT="$BACKUP_DIR/usim_cms_${NAME}_$TIMESTAMP.dump"
  pg_dump -Fc "${SCHEMA_ARGS[@]}" "$DATABASE_URL" -f "$OUT"
fi

echo "Backed up -> $OUT"
find "$BACKUP_DIR" -name "usim_cms_*.dump" -mtime +"$RETENTION_DAYS" -delete
