#!/usr/bin/env bash
# Usage: backup-media.sh [tenant-host ...]   (no args = every tenant's uploads folder)
# Filesystem-level counterpart to backup.sh (which only covers Postgres) — mirrors
# uploads/<tenantFolder>/ into BACKUP_DIR/media/<tenantFolder>/<timestamp>/, hardlinked
# against the previous snapshot (rsync --link-dest) so unchanged files cost no extra
# disk. Point-in-time + zero in-memory buffering, unlike apps/api/src/backup.ts's zip
# export (which refuses tenants over MAX_LOCAL_MEDIA_BACKUP_BYTES for exactly this
# reason) — this is the practical path for a large-media tenant.
#
# Restore a tenant:  rsync -a --delete BACKUP_DIR/media/<tenantFolder>/latest/ uploads/<tenantFolder>/
# Migrate to a new server:  rsync -a BACKUP_DIR/media/<tenantFolder>/latest/ newhost:/path/to/uploads/<tenantFolder>/
# Cron (daily 2am, all tenants):  0 2 * * * BACKUP_DIR=/var/backups/usim_cms apps/api/scripts/backup-media.sh
#
# Multi-VPS fleet (one instance per department VPS, small local disk): run this ON a
# separate backup box, PULLING from each app VPS over SSH instead of writing local
# backups back onto the same tight disk they came from — a backup that lives on the
# same disk it protects doesn't survive that disk filling up or dying.
#   SOURCE_HOST=deploy@10.0.0.5 UPLOADS_DIR=/var/lib/docker/volumes/ucms-uploads/_data \
#     BACKUP_DIR=/mnt/backup-disk/vps1 apps/api/scripts/backup-media.sh
# (needs passwordless SSH key auth to $SOURCE_HOST already set up — ssh-copy-id, once)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/usim_cms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SOURCE_HOST="${SOURCE_HOST:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ -z "$SOURCE_HOST" ]; then
  # Docker mode: uploads live in the named `ucms-uploads` volume (docker-compose.yml),
  # not a bind mount — resolve its real host path unless UPLOADS_DIR already points at
  # it directly (bare-metal / local-dev, where apps/api/uploads is a plain directory).
  UPLOADS_DIR="${UPLOADS_DIR:-$(docker volume inspect ucms-uploads --format '{{ .Mountpoint }}' 2>/dev/null || true)}"
  if [ -z "$UPLOADS_DIR" ]; then
    echo "Could not resolve uploads dir — set UPLOADS_DIR explicitly (e.g. apps/api/uploads for bare-metal)." >&2
    exit 1
  fi
elif [ -z "${UPLOADS_DIR:-}" ]; then
  echo "SOURCE_HOST set but UPLOADS_DIR isn't — it can't be auto-detected on a remote box, set it explicitly." >&2
  exit 1
fi

# Same slug rule as apps/api/src/index.ts's/backup.ts's tenantFolder() — must match
# exactly or a per-host backup silently targets the wrong (or no) directory.
tenant_folder() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g'; }

sync_one() {
  local folder="$1"
  local src="$UPLOADS_DIR/$folder"
  if [ -n "$SOURCE_HOST" ]; then
    src="$SOURCE_HOST:$UPLOADS_DIR/$folder"
  elif [ ! -d "$src" ]; then
    echo "skip $folder (no uploads yet)"
    return
  fi
  local dest_root="$BACKUP_DIR/media/$folder"
  local snapshot="$dest_root/$TIMESTAMP"
  mkdir -p "$dest_root"
  local link_dest=()
  [ -e "$dest_root/latest" ] && link_dest=(--link-dest="$dest_root/latest")
  # A remote SOURCE_HOST can't be pre-checked with `-d` — let rsync itself fail for a
  # host/tenant with nothing to sync yet, without aborting the whole fleet-wide run.
  if ! rsync -a --delete "${link_dest[@]}" "$src/" "$snapshot/"; then
    echo "skip $folder (rsync failed — no uploads yet, or $SOURCE_HOST unreachable)" >&2
    rmdir "$snapshot" 2>/dev/null || true
    return
  fi
  ln -sfn "$snapshot" "$dest_root/latest"
  find "$dest_root" -maxdepth 1 -type d -name "20*" -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
  echo "Synced $folder -> $snapshot"
}

if [ "$#" -eq 0 ]; then
  if [ -n "$SOURCE_HOST" ]; then
    echo "SOURCE_HOST mode needs an explicit tenant-host list (can't list a remote box's folders without another SSH round-trip)." >&2
    exit 1
  fi
  for dir in "$UPLOADS_DIR"/*/; do
    [ -d "$dir" ] || continue
    sync_one "$(basename "$dir")"
  done
else
  for host in "$@"; do
    sync_one "$(tenant_folder "$host")"
  done
fi
