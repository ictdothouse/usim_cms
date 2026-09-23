#!/usr/bin/env bash
# Usage: backup.sh [tenant-host ...]   (no args = control-plane registry + every active tenant)
# Restore the control-plane dump:  pg_restore -d "$DATABASE_URL" usim_cms_control_<ts>.dump
# Restore one tenant:               pg_restore -d "<that tenant's own db url>" usim_cms_tenant_<host>_<ts>.dump
#
# Each tenant's content lives in its OWN Postgres database (tenant_<host>, or an explicit
# tenants.db_url override — see tenant-pool.ts's tenantDbName/deriveTenantDbUrl), never as a
# schema inside the control-plane database. This script's pre-2026-09-23 behavior dumped
# `-n tenant_<host>` (a schema) against $DATABASE_URL (the control-plane connection) — that
# schema never existed there, so every tenant-scoped backup silently produced an empty dump.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/usim_cms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Same slug rule as tenant-pool.ts's tenantDbName() — must match exactly or a derived
# tenant database name is wrong.
to_dbname() { echo "tenant_$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')"; }

# Swaps the control-plane connection URL's own /dbname path segment for a tenant's derived
# one — mirrors tenant-pool.ts's deriveTenantDbUrl(), used whenever a tenant's own
# tenants.db_url column is empty (same Postgres server as the control plane).
derive_tenant_url() {
  local base="$1" dbname="$2" query=""
  case "$base" in
    *\?*) query="?${base#*\?}"; base="${base%%\?*}" ;;
  esac
  echo "${base%/*}/${dbname}${query}"
}

dump_tenant() {
  local host="$1" db_url="$2"
  local slug; slug=$(to_dbname "$host")
  local url="$db_url"
  [ -z "$url" ] && url=$(derive_tenant_url "$DATABASE_URL" "$slug")
  local out="$BACKUP_DIR/usim_cms_tenant_${slug}_$TIMESTAMP.dump"
  if pg_dump -Fc "$url" -f "$out"; then
    echo "Backed up $host -> $out"
  else
    echo "FAILED to back up $host (database not yet provisioned, or unreachable) — skipped" >&2
    rm -f "$out"
  fi
}

# host<TAB>db_url rows for the requested tenants (or every active one) — db_url is empty
# string, not null, when unset (coalesce), so dump_tenant's [ -z ] check works directly.
fetch_tenant_rows() {
  if [ "$#" -eq 0 ]; then
    psql "$DATABASE_URL" -Atq -F $'\t' -c "SELECT host, coalesce(db_url, '') FROM public.tenants WHERE active"
  else
    local list=""
    for h in "$@"; do
      list+="${list:+,}'$(echo "$h" | sed "s/'/''/g")'"
    done
    psql "$DATABASE_URL" -Atq -F $'\t' -c "SELECT host, coalesce(db_url, '') FROM public.tenants WHERE host = ANY(ARRAY[$list])"
  fi
}

if [ "$#" -eq 0 ]; then
  OUT="$BACKUP_DIR/usim_cms_control_$TIMESTAMP.dump"
  pg_dump -Fc "$DATABASE_URL" -f "$OUT"
  echo "Backed up control plane -> $OUT"
fi

FOUND_HOSTS=()
while IFS=$'\t' read -r host db_url; do
  [ -n "$host" ] || continue
  FOUND_HOSTS+=("$host")
  dump_tenant "$host" "$db_url"
done < <(fetch_tenant_rows "$@")

if [ "$#" -gt 0 ]; then
  for requested in "$@"; do
    printf '%s\n' "${FOUND_HOSTS[@]}" | grep -qxF "$requested" || echo "Unknown or inactive tenant host: $requested" >&2
  done
fi

find "$BACKUP_DIR" -name "usim_cms_*.dump" -mtime +"$RETENTION_DAYS" -delete
