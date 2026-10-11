#!/usr/bin/env bash
# Where uploaded media lives in Docker production (blue-green) mode. Turns
# .env's UPLOADS_PATH / UPLOADS_NFS into the volume the api mounts at
# /app/uploads, and moves the existing files when that location changes.
# Called by scripts/deploy.sh — nobody needs to run it by hand.
#
#   neither set    Docker-managed volume "ucms-uploads" (default)
#   UPLOADS_PATH   a folder on this server — a dedicated disk, SAN volume, or
#                  NAS/SMB share the OS already mounts (bind volume)
#   UPLOADS_NFS    nfs-server:/export/path on another server, mounted by
#                  Docker itself, no /etc/fstab (UPLOADS_NFS_OPTS, default
#                  nfsvers=4.1,hard)
#
# Every custom location gets its own volume name (ucms-uploads-<hash>), so a
# change rides the normal zero-downtime deploy: `prepare` copies everything
# into the new volume while the old color keeps serving, the new color starts
# on it, `finish` copies whatever was uploaded in between and records the
# switch as UPLOADS_VOLUME in .env (read by docker-compose.release.yml). The
# old volume is kept — still the rollback color's volume — never auto-deleted.
#
#   uploads-volume.sh check                validate .env only
#   uploads-volume.sh check-path <dir>     validate one folder path
#   uploads-volume.sh prepare <api-image>  ensure volume (+copy); prints name
#   uploads-volume.sh finish <api-image>   delta copy + record in .env
set -euo pipefail
cd "$(dirname "$0")/.."

DEFAULT_VOLUME="ucms-uploads"
PENDING_FILE=".uploads-migration"
# Dotfiles in the uploads root — @fastify/static is registered with
# dotfiles: "ignore", so none of these is ever served.
MARKER=".ucms-uploads"
STAMP=".ucms-migrate-stamp"

log() { echo "[uploads] $*" >&2; }
die() {
  echo "[uploads] ERROR: $*" >&2
  exit 1
}

env_get() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}

# Rewrites .env in place (cat >, not mv) so its owner and 600 mode survive.
# An empty value removes the key.
env_set() {
  local tmp
  tmp=$(mktemp)
  grep -vE "^$1=" .env >"$tmp" || true
  if [ -n "$2" ]; then printf '%s=%s\n' "$1" "$2" >>"$tmp"; fi
  cat "$tmp" >.env
  rm -f "$tmp"
}

# Shared with install.sh's prompt. Deny-listing system trees matters: the
# folder's root gets chowned to the container's app user.
check_path() {
  local p="${1%/}"
  [[ "$p" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "uploads folder must be an absolute path of letters, digits and . _ - / (got: '$1')"
  if [[ "$p/" == *"/../"* || "$p/" == *"/./"* ]]; then die "uploads folder must not contain . or .. segments (got: '$1')"; fi
  case "$p/" in
    /bin/* | /boot/* | /dev/* | /etc/* | /lib/* | /lib32/* | /lib64/* | /proc/* | /root/* | /run/* | /sbin/* | /sys/* | /usr/* | /var/lib/docker/*)
      die "uploads folder may not be inside a system directory (got: '$p')" ;;
  esac
}

# Sets KIND (docker|bind|nfs), TARGET, OPTS, DEVICE and DESIRED from .env.
resolve_desired() {
  local p n o
  p=$(env_get UPLOADS_PATH)
  n=$(env_get UPLOADS_NFS)
  o=$(env_get UPLOADS_NFS_OPTS)
  KIND=docker TARGET="" OPTS="" DEVICE=""
  if [ -n "$p" ] && [ -n "$n" ]; then die "set UPLOADS_PATH or UPLOADS_NFS in .env, not both"; fi
  if [ -n "$p" ]; then
    check_path "$p"
    KIND=bind TARGET="${p%/}" OPTS=bind DEVICE="${p%/}"
  elif [ -n "$n" ]; then
    [[ "$n" =~ ^[A-Za-z0-9.-]+:/[A-Za-z0-9._/-]*$ ]] || die "UPLOADS_NFS must look like nfs-server:/export/path (got: '$n')"
    if [[ "$n/" == *"/../"* ]]; then die "UPLOADS_NFS must not contain .. segments"; fi
    o="${o:-nfsvers=4.1,hard}"
    [[ "$o" =~ ^[A-Za-z0-9=.,_-]+$ ]] || die "UPLOADS_NFS_OPTS may only contain letters, digits and = . , _ -"
    if [[ ",$o," == *",addr="* ]]; then die "UPLOADS_NFS_OPTS must not set addr= (it comes from UPLOADS_NFS)"; fi
    KIND=nfs TARGET="$n" OPTS="addr=${n%%:*},$o" DEVICE=":${n#*:}"
  fi
  if [ "$KIND" = docker ]; then
    DESIRED="$DEFAULT_VOLUME"
  else
    DESIRED="$DEFAULT_VOLUME-$(printf '%s|%s|%s' "$KIND" "$DEVICE" "$OPTS" | sha256sum | cut -c1-10)"
  fi
}

# Sets CREATED=1 when this call made the volume.
ensure_volume() {
  CREATED=0
  if docker volume inspect "$DESIRED" >/dev/null 2>&1; then
    if [ "$KIND" != docker ]; then
      local dev
      dev=$(docker volume inspect "$DESIRED" --format '{{ index .Options "device" }}')
      [ "$dev" = "$DEVICE" ] || die "volume $DESIRED points at '$dev', expected '$DEVICE' — remove it (docker volume rm $DESIRED) and deploy again"
    fi
    return 0
  fi
  case "$KIND" in
    docker) docker volume create "$DESIRED" >/dev/null ;;
    bind)
      # Never take over a folder that already holds something else.
      if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && [ ! -e "$TARGET/$MARKER" ]; then
        die "$TARGET already has files and isn't a ucms uploads folder — pick an empty folder, or confirm it with: sudo touch $TARGET/$MARKER"
      fi
      mkdir -p "$TARGET" 2>/dev/null || die "can't create $TARGET — create it first (sudo mkdir -p $TARGET) or run the deploy as root"
      docker volume create --driver local --opt type=none --opt o=bind --opt device="$TARGET" "$DESIRED" >/dev/null
      ;;
    nfs) docker volume create --driver local --opt type=nfs --opt o="$OPTS" --opt device="$DEVICE" "$DESIRED" >/dev/null ;;
  esac
  CREATED=1
  log "created volume $DESIRED ($KIND${TARGET:+: $TARGET})"
}

# A new location must belong to the image's own non-root `app` user. chown
# runs as root and may be refused (NFS root_squash) — the write test as `app`
# decides, and its error names exactly which uid:gid needs access.
ensure_writable() {
  local image="$1" ids out
  docker run --rm --user 0 --entrypoint sh -v "$DESIRED:/to" "$image" -c 'chown -R app:app /to' >/dev/null 2>&1 || true
  if ! out=$(docker run --rm --entrypoint sh -v "$DESIRED:/to" "$image" \
    -c "touch /to/.ucms-write-test && rm -f /to/.ucms-write-test && { [ -e /to/$MARKER ] || touch /to/$MARKER; }" 2>&1); then
    ids=$(docker run --rm --entrypoint sh "$image" -c 'echo "$(id -u app):$(id -g app)"')
    out="${out%%$'\n'*}"
    # A volume this run just made is dropped again, so a corrected .env
    # starts clean instead of reusing a half-working one.
    if [ "$CREATED" = 1 ]; then docker volume rm "$DESIRED" >/dev/null 2>&1 || true; fi
    die "the api can't use ${TARGET:-$DESIRED}: ${out#docker: }
  - unreachable NFS server/export: check UPLOADS_NFS and that this server may mount it
  - permission denied: the api runs as uid:gid $ids — folder: sudo chown -R $ids <folder>;
    NFS: chown -R $ids on the export, or export it with all_squash,anonuid=${ids%%:*},anongid=${ids##*:}"
  fi
}

# Copies run as the image's `app` user (its default USER), so every file in
# the new location ends up owned by the uid that serves it — right for a
# local folder and for an NFS export that squashes root alike.
copy_all() {
  log "copying existing uploads $1 -> $2 (the live site keeps serving)..."
  docker run --rm --entrypoint sh -v "$1:/from:ro" -v "$2:/to" "$3" -c "touch /to/$STAMP && cp -R /from/. /to/"
}

# Files written to the old volume while the deploy ran (newer than the stamp
# copy_all left before it started).
copy_delta() {
  docker run --rm --entrypoint sh -v "$1:/from:ro" -v "$2:/to" "$3" -c "
    [ -e /to/$STAMP ] || exit 0
    cd /from && find . -type f -newer /to/$STAMP | while IFS= read -r f; do
      mkdir -p \"/to/\${f%/*}\" && cp \"\$f\" \"/to/\$f\"
    done
    rm -f /to/$STAMP"
}

case "${1:-}" in
  check)
    resolve_desired
    log "uploads location: $KIND${TARGET:+ ($TARGET)} -> volume $DESIRED"
    ;;
  check-path)
    check_path "${2:?usage: uploads-volume.sh check-path <dir>}"
    ;;
  prepare)
    image="${2:?usage: uploads-volume.sh prepare <api-image>}"
    resolve_desired
    current="$(env_get UPLOADS_VOLUME)"
    current="${current:-$DEFAULT_VOLUME}"
    ensure_volume
    # Steady state (nothing changed) costs one `volume inspect`, no containers.
    if [ "$CREATED" = 1 ] || [ "$current" != "$DESIRED" ]; then ensure_writable "$image"; fi
    if [ "$current" != "$DESIRED" ]; then
      if docker volume inspect "$current" >/dev/null 2>&1; then copy_all "$current" "$DESIRED" "$image"; fi
      printf '%s %s\n' "$current" "$DESIRED" >"$PENDING_FILE"
      log "uploads move to $DESIRED${TARGET:+ ($TARGET)} completes after promote"
    fi
    echo "$DESIRED"
    ;;
  finish)
    image="${2:?usage: uploads-volume.sh finish <api-image>}"
    [ -f "$PENDING_FILE" ] || exit 0
    read -r from to <"$PENDING_FILE"
    if docker volume inspect "$from" >/dev/null 2>&1; then copy_delta "$from" "$to" "$image"; fi
    if [ "$to" = "$DEFAULT_VOLUME" ]; then env_set UPLOADS_VOLUME ""; else env_set UPLOADS_VOLUME "$to"; fi
    rm -f "$PENDING_FILE"
    log "uploads now live in volume $to."
    if docker volume inspect "$from" >/dev/null 2>&1; then
      log "previous volume $from kept (the rollback color still uses it); once happy: docker volume rm $from"
    fi
    ;;
  *)
    echo "usage: $0 check | check-path <dir> | prepare <api-image> | finish <api-image>" >&2
    exit 2
    ;;
esac
