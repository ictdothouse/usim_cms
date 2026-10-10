#!/usr/bin/env bash
# One-shot installer for a test/staging VPS. Safe to re-run.
# Supports Debian-family (Ubuntu/Debian, apt/ufw) and RHEL-family
# (AlmaLinux/Rocky/RHEL/CentOS Stream, dnf/firewalld) hosts — detected
# automatically from /etc/os-release, no flag needed.
#
# Three modes, chosen with --mode=docker|production|bare-metal, $INSTALL_MODE,
# or (if neither is set and this is an interactive terminal) a prompt:
#
#   docker      Trial/quick-test stack: db+api+frontend+admin in containers,
#               published on auto-picked host ports (http://<ip>:<port>), no
#               Caddy, no zero-downtime deploys. Good for kicking the tires;
#               not the production topology — see "production" below.
#
#   production  The real, zero-downtime topology this repo is built around:
#               db+pgbouncer+redis+proxy(Caddy) as an always-on base, api/
#               frontend/admin blue-green deployed on top via scripts/
#               deploy.sh, routed by real domains through Caddy (auto-HTTPS
#               unless port 80/443 already belongs to another app on this
#               VPS, detected automatically — see ensure_caddy_bind_ports).
#               Nothing except 80/443 (or nothing at all, if those are
#               shared) and the monitor port ever gets published to the host.
#
#   bare-metal  Native Node processes + a native/reused PostgreSQL cluster,
#               for orgs that don't want Docker at all. Still fully
#               conflict-safe: it never installs Node into the system PATH
#               (a private, pinned Node runtime is downloaded to
#               /opt/ucms/node and referenced by absolute path only) and
#               it reuses an already-running Postgres cluster instead of
#               installing a second one (creates its own database + role
#               inside it — this is exactly the same "one Postgres server,
#               many databases" model apps/api already uses per tenant).
#
# All modes: detect the public IP so the admin build's baked-in API URL is
# actually reachable from a browser, and install the ops monitor
# (monitor/server.js) as a systemd service. All also ask for a superadmin
# email/password up front and create that account directly against the
# running API's own /api/setup route (the same self-disabling first-run
# endpoint the admin's Setup Wizard uses) once the stack is healthy — so
# login works without ever depending on the admin UI reaching the API from a
# browser first.
#
# All modes also verify the stack is reachable from OUTSIDE its own
# container/process — not just "healthy" from its own internal healthcheck —
# before declaring success: a container can report itself perfectly healthy
# while its published port is unreachable from a real browser (see
# diagnose_reachability below for the two ways this actually happened).
#
# Run: sudo ./install.sh [--mode=docker|production|bare-metal]
#      [--admin-email=<email>] [--admin-password=<password>]
#      [--admin-only]   Skip the install entirely — just (re)run the
#                        superadmin-creation step against an already-running
#                        stack (e.g. everything's installed, you only need
#                        the first account created).
#      [--diagnose]     Skip the install entirely — just re-run the external-
#                        reachability check + diagnostic report against an
#                        already-running stack. Use this first any time
#                        "admin can't reach the API" gets reported, instead
#                        of manually reaching for curl/ss/iptables.
#      [--reapply-backup-cron]  Skip the install entirely — just regenerate
#                        /opt/ucms/backup's scripts/run.sh/crontab from the
#                        current checkout (no prompts, reuses the existing
#                        BACKUP_DIR/RETENTION_DAYS). Needs an existing backup
#                        cron already set up once interactively, and an
#                        explicit --mode=. This is what the ops monitor
#                        dashboard's "Apply backup-cron update" button runs.
set -euo pipefail
cd "$(dirname "$0")"
REPO_DIR="$(pwd)"
# Pinned, not "@latest" — an unpinned global install embedded in an
# automated script is itself a floating supply-chain dependency. Bump this
# deliberately (same as any other dependency upgrade) when corepack cuts a
# new release, rather than always trusting whatever npm resolves right now.
COREPACK_PIN_VERSION="0.36.0"

# Bump this whenever _apply_backup_cron_files's generated backup.env/run.sh
# shape changes meaningfully (a new destination type, a credential-handling
# fix, etc.) — written into /opt/ucms/backup/backup.env on every apply, and
# compared against THIS line (monitor/server.js reads it straight out of
# this file, no separate place to keep in sync) to decide whether the ops
# monitor dashboard's "Backup destination" card should show an "Apply
# update" recommendation. Not a semver, just an increasing integer.
BACKUP_CRON_VERSION="1"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo ./install.sh" >&2
  exit 1
fi
# Captured so install_production_mode can hand ownership of whatever it wrote
# in the repo dir back to whoever actually owns it, once its root-only setup
# work is done — otherwise files created while running as root (e.g.
# .deploy-color) become unwritable by that same person's later non-sudo
# `bash scripts/deploy.sh` runs, which is the normal way to redeploy.
ORIG_OWNER="$(stat -c '%U:%G' "$REPO_DIR" 2>/dev/null || echo "")"

# ---------------------------------------------------------------------------
# Mode selection
# ---------------------------------------------------------------------------
MODE="${INSTALL_MODE:-}"
ADMIN_ONLY="false"
DIAGNOSE_ONLY="false"
REAPPLY_BACKUP_CRON="false"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-}"
SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:-}"
for arg in "$@"; do
  case "$arg" in
    --mode=docker) MODE="docker" ;;
    --mode=production) MODE="production" ;;
    --mode=bare-metal|--mode=baremetal) MODE="bare-metal" ;;
    --admin-only) ADMIN_ONLY="true" ;;
    --diagnose) DIAGNOSE_ONLY="true" ;;
    # Non-interactive re-run of just the backup-cron file/cron generation —
    # see reapply_backup_cron()'s own comment for why this exists and what
    # it deliberately does NOT touch. Requires an explicit --mode= alongside
    # it (docker or bare-metal — "production" also uses the "docker" backup-
    # cron code path, same as install_backup_cron's own call sites), since
    # there's no TTY here to ask interactively.
    --reapply-backup-cron) REAPPLY_BACKUP_CRON="true" ;;
    --admin-email=*) SUPERADMIN_EMAIL="${arg#--admin-email=}" ;;
    --admin-password=*) SUPERADMIN_PASSWORD="${arg#--admin-password=}" ;;
  esac
done
if [ -z "$MODE" ]; then
  if [ "$REAPPLY_BACKUP_CRON" = "true" ]; then
    echo "--reapply-backup-cron needs an explicit --mode=docker|bare-metal — no TTY here to ask interactively." >&2
    exit 1
  fi
  if [ -t 0 ]; then
    echo "How should this be installed?"
    echo "  1) Docker trial — quick test, containers, host-published ports, no Caddy"
    echo "  2) Production (recommended) — blue-green + Caddy, real domains, zero-downtime deploys"
    echo "  3) Bare-metal — native Node + Postgres, no Docker"
    read -r -p "Choose [1/2/3] (default 2): " choice
    case "$choice" in
      1) MODE="docker" ;;
      3) MODE="bare-metal" ;;
      *) MODE="production" ;;
    esac
  else
    MODE="docker"
    echo "No --mode given and not an interactive terminal — defaulting to docker (trial)." >&2
    echo "(pass --mode=production for the real blue-green+Caddy topology, or" >&2
    echo " --mode=bare-metal for the native path instead)" >&2
  fi
fi
# reapply_backup_cron's own code path only distinguishes docker vs
# bare-metal — "production" mode uses the exact same "docker" backup-cron
# path install_docker_mode/install_production_mode's own install_backup_cron
# calls already share — so collapse it here rather than making every caller
# (the monitor dashboard's "Apply backup-cron update" button) know that.
if [ "$REAPPLY_BACKUP_CRON" = "true" ] && [ "$MODE" = "production" ]; then
  MODE="docker"
fi
echo "== usim_cms installer — mode: $MODE =="
echo "Repo: $REPO_DIR"
echo ""

# Ask for the superadmin login up front (before any install work starts) —
# used later, once the stack is healthy, to create that account directly via
# the API's own /api/setup route. Skipped only if both are already supplied
# (flags or SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD env vars) and it's not an
# interactive terminal — a non-interactive run with neither is a hard error,
# same as an unset SESSION_SECRET would be further down. --diagnose creates
# no account at all, so it never asks — same for --reapply-backup-cron,
# which touches none of the app/superadmin setup at all.
if [ "$DIAGNOSE_ONLY" != "true" ] && [ "$REAPPLY_BACKUP_CRON" != "true" ]; then
  if [ -z "$SUPERADMIN_EMAIL" ] && [ -t 0 ]; then
    read -r -p "Superadmin email: " SUPERADMIN_EMAIL
  fi
  if [ -z "$SUPERADMIN_PASSWORD" ] && [ -t 0 ]; then
    read -r -s -p "Superadmin password: " SUPERADMIN_PASSWORD
    echo ""
  fi
  if [ -z "$SUPERADMIN_EMAIL" ] || [ -z "$SUPERADMIN_PASSWORD" ]; then
    echo "Superadmin email/password required — pass --admin-email=/--admin-password=," >&2
    echo "set SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD env vars, or run this interactively." >&2
    exit 1
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Shared helpers (both modes)
# ---------------------------------------------------------------------------

# Sets PKG_MGR (apt|dnf) and FIREWALL_TOOL (ufw|firewalld) from
# /etc/os-release. Deliberately errors out on anything else rather than
# guessing apt — a silent wrong guess would fail confusingly many steps
# later instead of here, with a clear message, before anything is touched.
PKG_MGR=""
FIREWALL_TOOL=""
detect_os_family() {
  if [ ! -r /etc/os-release ]; then
    echo "Cannot read /etc/os-release — unsupported OS." >&2
    exit 1
  fi
  local os_id os_id_like
  os_id="$(. /etc/os-release && echo "$ID")"
  os_id_like="$(. /etc/os-release && echo "${ID_LIKE:-}")"
  case " ${os_id} ${os_id_like} " in
    *" debian "*|*" ubuntu "*)
      PKG_MGR="apt"; FIREWALL_TOOL="ufw" ;;
    *" rhel "*|*" fedora "*|*" centos "*|*" rocky "*|*" almalinux "*)
      PKG_MGR="dnf"; FIREWALL_TOOL="firewalld" ;;
    *)
      echo "Unsupported/unrecognized OS (ID=${os_id}, ID_LIKE=${os_id_like:-<none>})." >&2
      echo "This installer supports Debian-family (apt) and RHEL-family (dnf) hosts." >&2
      exit 1
      ;;
  esac
  echo "Detected OS family: ${PKG_MGR} / ${FIREWALL_TOOL}"
}

pkg_install() {
  if [ "$PKG_MGR" = "apt" ]; then
    apt-get update -qq
    apt-get install -y "$@" >/dev/null
  else
    dnf install -y "$@" >/dev/null
  fi
}

# Best-effort only: certbot backs the monitor dashboard's/admin panel's
# "Issue certificate" action (monitor/server.js's POST /api/ssl/issue), used
# only by the nginx-as-edge enterprise pattern (CLAUDE.md) — nginx itself is
# still BYO/manual here, so a failed install must never abort setup of the
# actual app stack (Caddy's own auto-HTTPS, wired separately, needs no
# certbot at all).
ensure_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return
  fi
  echo "Installing certbot (nginx auto-SSL action, for whoever goes that route)..."
  if [ "$PKG_MGR" = "apt" ]; then
    pkg_install certbot python3-certbot-nginx || echo "certbot install failed — skip, install manually later if needed." >&2
  else
    dnf install -y epel-release >/dev/null 2>&1 || true
    pkg_install certbot python3-certbot-nginx || echo "certbot install failed — skip, install manually later if needed." >&2
  fi
}

RESERVED_PORTS=()
port_in_use() {
  ss -H -ltn "( sport = :$1 )" 2>/dev/null | grep -q LISTEN
}
port_reserved() {
  local p
  for p in "${RESERVED_PORTS[@]:-}"; do
    [ "$p" = "$1" ] && return 0
  done
  return 1
}
find_free_port() {
  local port="$1"
  while port_in_use "$port" || port_reserved "$port"; do
    port=$((port + 1))
  done
  RESERVED_PORTS+=("$port")
  echo "$port"
}

detect_public_host() {
  local host=""
  host=$(curl -fs -4 --max-time 5 ifconfig.me 2>/dev/null || true)
  if [ -z "$host" ]; then
    host=$(curl -fs -4 --max-time 5 icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)
  fi
  if [ -z "$host" ]; then
    host=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$host" ]; then
    echo "Warning: could not detect a public IP, falling back to localhost." >&2
    echo "         Set PUBLIC_HOST=<your-vps-ip> ./install.sh to override." >&2
    host="localhost"
  fi
  echo "$host"
}

fill_env_if_blank() {
  # $1 = path to an env file, $2 = key
  local file="$1" key="$2"
  if grep -qE "^${key}=\s*$" "$file" 2>/dev/null; then
    local value
    value=$(openssl rand -hex 24)
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
    echo "Generated a random ${key} in ${file}."
  fi
}
set_env_kv() {
  # $1 = path to an env file, $2 = key, $3 = value — creates the file/key if absent
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
  else
    echo "${key}=${value}" >> "$file"
  fi
}
write_pgbouncer_userlist() {
  # Regenerates pgbouncer/userlist.txt (git-ignored — see
  # pgbouncer/userlist.txt.example) from .env's POSTGRES_APP_PASSWORD.
  # Always safe to re-run: deterministic from the current value, so a
  # redeploy on an unchanged .env writes the identical file. Only used by
  # production mode — trial mode's api talks straight to db:5432, no
  # pgbouncer involved (see docker-compose.trial.yml's own header).
  local password
  password=$(grep -E '^POSTGRES_APP_PASSWORD=' .env | cut -d= -f2-)
  if [ -z "$password" ]; then
    echo "POSTGRES_APP_PASSWORD is blank in .env — run fill_env_if_blank first." >&2
    exit 1
  fi
  local hash
  hash=$(printf '%s' "${password}usim_cms_app" | md5sum | cut -d' ' -f1)
  printf '"usim_cms_app" "md5%s"\n' "$hash" > pgbouncer/userlist.txt
  # edoburu/pgbouncer's entrypoint runs as uid:gid 70:70 ("postgres" in
  # its own /etc/passwd, unrelated to any host user) — chown to that gid
  # and restrict to group-read, not chmod 644/world-readable. install.sh
  # itself requires sudo (see its own top-of-file check), so chown here
  # never fails for lack of privilege.
  chown 0:70 pgbouncer/userlist.txt
  chmod 640 pgbouncer/userlist.txt
}

# ---------------------------------------------------------------------------
# Optional integrations (shared across docker/production/bare-metal modes) —
# every one of these is unset-means-off in the app code itself (entra.ts/
# metrics.ts/storage.ts each check for their own var, same convention as
# REDIS_URL/ALERT_WEBHOOK_URL elsewhere in this project), so skipping every
# prompt below (Enter through all of them, or a non-interactive run) leaves
# a fresh install byte-identical to one without this function at all.
#
# Each block is intentionally self-contained — its own y/N gate, its own
# set_env_kv calls, no shared state with any other block — so adding a
# future integration is "copy one block, rename it", never a change to an
# existing one. $1 = the env file THIS install's mode actually reads
# (.env for docker/production — see docker-compose.release.yml/.trial.yml's
# own environment: passthrough for these same keys; apps/api/.env for
# bare-metal, a real systemd EnvironmentFile).
# ---------------------------------------------------------------------------
configure_optional_integrations() {
  local file="$1"
  if [ ! -t 0 ]; then
    return # non-interactive run — every integration below stays off
  fi
  echo ""
  echo "-- Optional integrations (press Enter to skip any — off by default) --"

  # --- Microsoft Entra ID / SSO (apps/api/src/entra.ts) ---
  local entra_yn=""
  read -r -p "Enable Microsoft Entra ID SSO? [y/N]: " entra_yn
  if [ "$entra_yn" = "y" ] || [ "$entra_yn" = "Y" ]; then
    local entra_secret="" entra_redirect=""
    read -r -p "  Entra client secret: " entra_secret
    read -r -p "  Entra redirect URI (must exactly match the app registration): " entra_redirect
    set_env_kv "$file" ENTRA_CLIENT_SECRET "$entra_secret"
    set_env_kv "$file" ENTRA_REDIRECT_URI "$entra_redirect"
    echo "  Saved — still needs turning on in Settings > Login Methods after first boot."
  fi

  # --- Prometheus-style metrics scrape endpoint (apps/api/src/metrics.ts) ---
  local metrics_yn=""
  read -r -p "Enable the /metrics scrape endpoint? [y/N]: " metrics_yn
  if [ "$metrics_yn" = "y" ] || [ "$metrics_yn" = "Y" ]; then
    local metrics_secret
    metrics_secret=$(openssl rand -hex 24)
    set_env_kv "$file" METRICS_SECRET "$metrics_secret"
    echo "  Generated METRICS_SECRET — send it as an x-metrics-secret header when scraping."
  fi

  # --- S3-compatible object storage (apps/api/src/storage.ts) ---
  local s3_yn=""
  read -r -p "Use S3-compatible storage for uploads instead of local disk? [y/N]: " s3_yn
  if [ "$s3_yn" = "y" ] || [ "$s3_yn" = "Y" ]; then
    local s3_endpoint="" s3_region="" s3_bucket="" s3_key="" s3_secret="" s3_path_style_yn="" s3_public_url=""
    read -r -p "  S3 endpoint (e.g. https://s3.amazonaws.com, or a MinIO/Sangfor URL): " s3_endpoint
    read -r -p "  S3 region (default us-east-1): " s3_region
    read -r -p "  S3 bucket name: " s3_bucket
    read -r -p "  S3 access key ID: " s3_key
    read -r -s -p "  S3 secret access key: " s3_secret
    echo ""
    set_env_kv "$file" STORAGE_DRIVER "s3"
    set_env_kv "$file" S3_ENDPOINT "$s3_endpoint"
    set_env_kv "$file" S3_REGION "${s3_region:-us-east-1}"
    set_env_kv "$file" S3_BUCKET "$s3_bucket"
    set_env_kv "$file" S3_ACCESS_KEY_ID "$s3_key"
    set_env_kv "$file" S3_SECRET_ACCESS_KEY "$s3_secret"
    read -r -p "  Path-style URLs needed (MinIO/Sangfor, not AWS)? [y/N]: " s3_path_style_yn
    if [ "$s3_path_style_yn" = "y" ] || [ "$s3_path_style_yn" = "Y" ]; then
      set_env_kv "$file" S3_FORCE_PATH_STYLE "true"
    fi
    read -r -p "  Public URL base for served media (blank = derive automatically): " s3_public_url
    [ -n "$s3_public_url" ] && set_env_kv "$file" S3_PUBLIC_URL_BASE "$s3_public_url"
  fi
  echo ""
}

# ---------------------------------------------------------------------------
# Scheduled backups — apps/api/scripts/backup.sh (pg_dump) + backup-media.sh
# (uploads rsync) exist but have no automatic schedule of their own (meant to
# be cron'd per the comment in each — see .claude/skills/deployment/SKILL.md).
# Skippable, same interactive-only/off-on-Enter convention as
# configure_optional_integrations — a non-interactive run gets no cron job.
# $1 = "docker" | "baremetal"
#
# Everything root's crontab actually points at lives under /opt/ucms/backup
# (root:root, 700), NEVER inside $REPO_DIR — REPO_DIR is typically owned by
# whoever ran `sudo ./install.sh` (install_production_mode explicitly chowns
# it back to them once root-only setup is done, and a plain `git clone` is
# already non-root-owned before this script ever runs). A root cron job
# pointing at a file inside that checkout — or `source`-ing its .env directly
# — would let anyone who can write to the repo (a compromised deploy
# credential, a second admin with repo access but no root) get root code
# execution once a day. Copying the dump scripts out and writing a fresh
# credentials file here, instead of referencing the repo at cron-run time,
# closes that off.
# ---------------------------------------------------------------------------

# Splits a postgres://user:pass@host[:port]/dbname URI into PG_URL_HOST/
# PG_URL_PORT/PG_URL_USER/PG_URL_PASSWORD/PG_URL_DATABASE globals, using pure
# parameter expansion — no external parser, and every password this
# installer itself generates (openssl rand -hex, see fill_env_if_blank) is
# plain hex, so this never has to handle URL-encoded special characters.
# Exists so psql/docker never has to be handed a raw connection URI as a CLI
# argument (see install_backup_cron's own comment on why that's a leak).
parse_pg_url() {
  local url="${1#postgres://}"
  url="${url#postgresql://}"
  local userinfo="${url%%@*}"
  local hostinfo="${url#*@}"
  PG_URL_USER="${userinfo%%:*}"
  PG_URL_PASSWORD="${userinfo#*:}"
  local hostport="${hostinfo%%/*}"
  PG_URL_DATABASE="${hostinfo#*/}"
  PG_URL_DATABASE="${PG_URL_DATABASE%%\?*}"
  if [[ "$hostport" == *:* ]]; then
    PG_URL_HOST="${hostport%%:*}"
    PG_URL_PORT="${hostport#*:}"
  else
    PG_URL_HOST="$hostport"
    PG_URL_PORT="5432"
  fi
}

install_backup_cron() {
  local mode="$1"
  if [ ! -t 0 ]; then
    return
  fi
  echo ""
  echo "-- Scheduled backups (pg_dump + uploads snapshot via cron) --"
  echo "   Without this, the backup scripts exist but never run automatically."
  local backup_yn=""
  read -r -p "Set up a daily backup cron job now? [Y/n]: " backup_yn
  if [ "$backup_yn" = "n" ] || [ "$backup_yn" = "N" ]; then
    echo "  Skipped — remember backups won't run until you schedule them yourself."
    return
  fi

  local backup_dir retention
  # Global (no `local`) — read by finish_backup_destination_setup, called
  # later from each mode's install function once the DB is actually up (this
  # function itself runs before the stack/DB exists in every mode, so it
  # can't seed platform_settings.backup_destination directly — see that
  # function's own comment). Reset here so a declined/non-interactive run
  # leaves it empty rather than carrying a stale value from a shell that
  # happened to already have it set.
  BACKUP_OFFSITE_TARGET=""
  read -r -p "  Backup directory [/var/backups/usim_cms]: " backup_dir
  backup_dir="${backup_dir:-/var/backups/usim_cms}"
  read -r -p "  Retention in days [14]: " retention
  retention="${retention:-14}"
  if ! [[ "$retention" =~ ^[0-9]+$ ]]; then
    echo "  Not a plain number — defaulting retention to 14." >&2
    retention=14
  fi
  echo "  A backup sitting on this same VPS doesn't survive the VPS itself dying."
  echo "  (S3/R2/Google Drive destinations can be set up afterward in the admin"
  echo "  panel's Settings tab or the ops monitor dashboard — this prompt only"
  echo "  covers a plain SSH/rsync target.)"
  read -r -p "  Off-site target to rsync a copy to after each run (user@host:/path, blank = skip): " BACKUP_OFFSITE_TARGET
  # This ends up inside a JSON value a later step inserts into the database
  # AND (every night after) an argument run.sh hands rsync — a stray quote or
  # shell metacharacter here would be a real injection either way, not just a
  # typo. Requires an actual [user@]host:path shape (a bare charset check
  # still let a colon-less, `..`-riddled value through — combined with
  # rsync --delete that could point root's nightly cron at an arbitrary
  # directory, not just a leading-dash option-injection risk). Bash's regex
  # engine has no lookahead to express "no .. segment" inline, so that's a
  # separate plain substring check — same two-part shape as the matching
  # validators in apps/api/src/routes/portal-settings.ts and
  # monitor/server.js. Caught by an automated security review as an
  # incomplete fix on the first pass (that pass only caught the leading-dash
  # case), not by hand-testing a normal user@host:/path value.
  if [ -n "$BACKUP_OFFSITE_TARGET" ] \
    && { ! [[ "$BACKUP_OFFSITE_TARGET" =~ ^(([A-Za-z0-9][A-Za-z0-9_.-]*)@)?[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9_./-]*$ ]] \
      || [[ "$BACKUP_OFFSITE_TARGET" == *".."* ]]; }; then
    echo "  Doesn't look like [user@]host:/path (or contains '..') — skipping off-site rsync." >&2
    BACKUP_OFFSITE_TARGET=""
  fi

  _apply_backup_cron_files "$mode" "$backup_dir" "$retention"
}

# The actual file/cron generation — split out of install_backup_cron() above
# so reapply_backup_cron() below (a non-interactive re-run, triggered by the
# ops monitor dashboard's "Apply backup-cron update" button once it detects
# an outdated /opt/ucms/backup/run.sh) can regenerate these from a freshly
# pulled checkout without needing a TTY to re-answer prompts that would just
# repeat whatever's already configured. $1=mode, $2=backup_dir, $3=retention.
_apply_backup_cron_files() {
  local mode="$1" backup_dir="$2" retention="$3"

  # Backup dumps contain password hashes, audit-log rows, every tenant's full
  # content — not something any other local account on this box should be
  # able to read just because mkdir's default mode allowed it.
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  # Likewise for the cron log: tenant hostnames and dump errors land in it,
  # and the first `>>` from cron would otherwise create it world-readable
  # under the default umask. Pre-creating it root-only beats fixing it after
  # the fact.
  touch /var/log/ucms-backup.log
  chown root:root /var/log/ucms-backup.log
  chmod 600 /var/log/ucms-backup.log

  # cron/cronie isn't on every minimal distro image — same PKG_MGR dispatch
  # detect_os_family already set up for everything else in this script.
  if ! command -v crontab >/dev/null 2>&1; then
    if [ "$PKG_MGR" = "apt" ]; then
      pkg_install cron
    else
      pkg_install cronie
      systemctl enable --now crond
    fi
  fi

  local cron_dir="/opt/ucms/backup"
  mkdir -p "$cron_dir"
  chown root:root "$cron_dir"
  chmod 700 "$cron_dir"
  cp "${REPO_DIR}/apps/api/scripts/backup.sh" "${cron_dir}/backup.sh"
  cp "${REPO_DIR}/apps/api/scripts/backup-media.sh" "${cron_dir}/backup-media.sh"
  chown root:root "${cron_dir}/backup.sh" "${cron_dir}/backup-media.sh"
  chmod 700 "${cron_dir}/backup.sh" "${cron_dir}/backup-media.sh"

  if [ "$mode" = "baremetal" ]; then
    # Needed only if/when the destination is later set to S3/R2/Google Drive
    # (admin panel Settings tab or the monitor dashboard) — installed
    # unconditionally up front, best-effort, so switching to it later never
    # needs a re-run of this installer. Docker mode instead runs rclone via
    # the rclone/rclone image at push time (see run.sh below), so the host
    # itself never needs the package — same "docker mode stays clean, bare-
    # metal installs natively" split this script already follows elsewhere
    # (compare ensure_postgres).
    pkg_install rclone || echo "  rclone install failed/unavailable — S3/R2/Google Drive backup destinations won't work until it's installed by hand." >&2
  fi

  # Credentials the dump needs, snapshotted into their OWN root-only file
  # instead of having the cron job `source` the repo's .env/apps/api/.env
  # directly (that file is just as writable as everything else above, so
  # sourcing it at every cron run would reopen the exact hole the copy above
  # closes — `source` executes whatever shell syntax is in it, not just reads
  # values). This is a point-in-time snapshot: rotating POSTGRES_APP_PASSWORD
  # or DATABASE_URL later needs this file regenerated too (re-run this
  # installer) — same already-documented caveat as PgBouncer's own
  # live-password-rotation steps in .claude/skills/deployment/SKILL.md.
  local env_file="${cron_dir}/backup.env"
  if [ "$mode" = "docker" ]; then
    local pg_app_password
    pg_app_password="$(grep -m1 '^POSTGRES_APP_PASSWORD=' "${REPO_DIR}/.env" | cut -d= -f2-)"
    {
      printf 'DATABASE_URL=postgres://usim_cms_app:%s@db:5432/usim_cms\n' "$pg_app_password"
      # PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE alongside the URL above —
      # backup.sh itself still reads DATABASE_URL (unchanged), but run.sh's
      # own off-site-destination queries (below) connect via these instead of
      # ever handing psql the URL as a CLI argument: a connection URI embeds
      # the password, and an argv is visible to any local user on this box
      # via `ps aux`, not just root — same class of leak `docker run -e`
      # already got fixed for below (see that comment on --env-file vs -e).
      # Discrete here already (no parsing needed) since docker mode's values
      # are fixed/known, not read back out of an opaque URL.
      printf 'PGHOST=db\n'
      printf 'PGPORT=5432\n'
      printf 'PGUSER=usim_cms_app\n'
      printf 'PGPASSWORD=%s\n' "$pg_app_password"
      printf 'PGDATABASE=usim_cms\n'
      # Read by monitor/server.js's getBackupCronStatus() to decide whether
      # the dashboard's "Apply update" recommendation shows — see
      # BACKUP_CRON_VERSION's own top-of-file comment.
      printf 'BACKUP_CRON_VERSION=%s\n' "$BACKUP_CRON_VERSION"
    } > "$env_file"
  else
    local db_url
    db_url="$(grep -m1 '^DATABASE_URL=' "${REPO_DIR}/apps/api/.env" | cut -d= -f2-)"
    parse_pg_url "$db_url"
    {
      printf 'DATABASE_URL=%s\n' "$db_url"
      printf 'PGHOST=%s\n' "$PG_URL_HOST"
      printf 'PGPORT=%s\n' "$PG_URL_PORT"
      printf 'PGUSER=%s\n' "$PG_URL_USER"
      printf 'PGPASSWORD=%s\n' "$PG_URL_PASSWORD"
      printf 'PGDATABASE=%s\n' "$PG_URL_DATABASE"
      printf 'UPLOADS_DIR=%s\n' "${REPO_DIR}/apps/api/uploads"
      printf 'BACKUP_CRON_VERSION=%s\n' "$BACKUP_CRON_VERSION"
    } > "$env_file"
  fi
  chown root:root "$env_file"
  chmod 600 "$env_file"

  local run_script="${cron_dir}/run.sh"
  if [ "$mode" = "docker" ]; then
    # DATABASE_URL reaches the dump container via `--env-file`, never `-e
    # VAR=value` — a `docker run -e` value is a literal command-line
    # argument, so the password would otherwise sit in plain text in `ps
    # aux` output for ANY local user to read, not just root. db's port is
    # deliberately never published to the host (see docker-compose.yml's own
    # comment on the db service) — only a container on ucms-net can reach it,
    # hence the one-off postgres:16-alpine container (same image `db` itself
    # uses, so pg_dump/psql versions always match) talking to `db:5432`
    # directly rather than through pgbouncer, so a long dump doesn't sit on
    # one of its few pooled backend connections for no benefit.
    cat > "$run_script" <<'EOF'
#!/usr/bin/env bash
# Generated by install.sh's install_backup_cron() — root-owned, deliberately
# NOT part of the git checkout (see that function's own comment for why). A
# future credential rotation or logic change needs this regenerated by
# re-running install.sh, not hand-edited here.
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm \
  --network ucms-net \
  --env-file backup.env \
  -e "BACKUP_DIR=/backup" \
  -e "RETENTION_DAYS=${RETENTION_DAYS:-14}" \
  -v "${BACKUP_DIR:-/var/backups/usim_cms}:/backup" \
  -v "$(pwd)/backup.sh:/backup.sh:ro" \
  postgres:16-alpine bash /backup.sh "$@"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/usim_cms}" \
RETENTION_DAYS="${RETENTION_DAYS:-14}" \
  bash backup-media.sh "$@"

# --- off-site push (platform_settings.backup_destination) ---
# Queried fresh on every run, never baked into this generated file, so a
# superadmin changing this in the admin panel's Settings tab or the ops
# monitor dashboard takes effect on the very next scheduled run with no
# re-install needed. db's port is never published to the host (see
# docker-compose.yml's own comment on the db service), so the query runs
# inside a one-off postgres:16-alpine container on ucms-net, same as the
# dump step above. No connection URI is ever passed to psql as a CLI
# argument — --env-file backup.env already forwards PGHOST/PGPORT/PGUSER/
# PGPASSWORD/PGDATABASE (install_backup_cron writes them alongside
# DATABASE_URL) into the container's own environment, where libpq picks
# them up automatically; an argv containing the password would otherwise be
# visible to any local user on this box via `ps aux`, not just root (same
# class of leak this function's own comment already flags for `-e`).
pg() {
  docker run --rm --network ucms-net --env-file backup.env postgres:16-alpine psql -tAc "$1" 2>/dev/null
}
dest_type="$(pg "SELECT backup_destination->>'type' FROM platform_settings WHERE id='singleton'" | tr -d '[:space:]')"
case "$dest_type" in
  ssh)
    target="$(pg "SELECT backup_destination->'ssh'->>'target' FROM platform_settings WHERE id='singleton'" | tr -d '[:space:]')"
    # Last line of defense, independent of whatever validation the value
    # passed before it ever reached this row: refuse anything without a
    # `:` (so this never silently falls back to a LOCAL rsync destination —
    # see apps/api/src/routes/portal-settings.ts's SSH_TARGET_RE comment for
    # why that matters) or containing `..` (path traversal). `--` then stops
    # rsync from parsing a leading-dash target as an option (argument
    # injection) on top of that.
    case "$target" in
      *..*|*[!A-Za-z0-9_./@:-]*) target="" ;;
      *:*) ;;
      *) target="" ;;
    esac
    [ -n "$target" ] && rsync -a --delete -- "${BACKUP_DIR:-/var/backups/usim_cms}/" "${target}/"
    ;;
  s3|gdrive)
    # rclone itself runs in its own container (rclone/rclone) rather than on
    # the host — docker mode keeps the host clean, see install_backup_cron's
    # own comment on this split. conf_dir holds the generated rclone.conf
    # (and, for gdrive, the service-account key) only for this run's
    # lifetime — trap cleans it up even if rclone itself fails.
    conf_dir="$(mktemp -d)"
    trap 'rm -rf "$conf_dir"' EXIT
    if [ "$dest_type" = "s3" ]; then
      {
        printf '[dest]\n'
        printf 'type = s3\n'
        printf 'provider = Other\n'
        printf 'access_key_id = %s\n' "$(pg "SELECT backup_destination->'s3'->>'accessKeyId' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        printf 'secret_access_key = %s\n' "$(pg "SELECT backup_destination->'s3'->>'secretAccessKey' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        printf 'endpoint = %s\n' "$(pg "SELECT backup_destination->'s3'->>'endpoint' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        region="$(pg "SELECT backup_destination->'s3'->>'region' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        [ -n "$region" ] && printf 'region = %s\n' "$region"
      } > "${conf_dir}/rclone.conf"
      bucket="$(pg "SELECT backup_destination->'s3'->>'bucket' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
      remote_path="dest:${bucket}/$(hostname)"
    else
      # Written via redirection straight from psql's own stdout, never
      # round-tripped through a bash variable — the service-account key is a
      # multi-line-shaped JSON blob, and this is the exact-byte-preserving
      # way to land it in a file (see install_backup_cron's own comment on
      # why this differs from the plain scalar fields above).
      pg "SELECT backup_destination->'gdrive'->>'serviceAccountJson' FROM platform_settings WHERE id='singleton'" > "${conf_dir}/sa.json"
      folder_id="$(pg "SELECT backup_destination->'gdrive'->>'folderId' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
      {
        printf '[dest]\n'
        printf 'type = drive\n'
        printf 'service_account_file = /config/sa.json\n'
        printf 'root_folder_id = %s\n' "$folder_id"
      } > "${conf_dir}/rclone.conf"
      remote_path="dest:"
    fi
    docker run --rm -v "${BACKUP_DIR:-/var/backups/usim_cms}:/data:ro" -v "${conf_dir}:/config:ro" \
      rclone/rclone:latest sync /data "${remote_path}" --config /config/rclone.conf
    ;;
esac
EOF
  else
    cat > "$run_script" <<'EOF'
#!/usr/bin/env bash
# Generated by install.sh's install_backup_cron() — root-owned, deliberately
# NOT part of the git checkout (see that function's own comment for why). A
# future credential rotation or logic change needs this regenerated by
# re-running install.sh, not hand-edited here.
set -euo pipefail
cd "$(dirname "$0")"
# Deliberately NOT `source backup.env` — a plain bash assignment's
# right-hand side still undergoes command substitution even when the line
# comes from a sourced file (`FOO=$(cmd)` runs `cmd`), so sourcing a
# DATABASE_URL copied verbatim out of apps/api/.env would execute anything
# shell-special a stored password/URL happened to contain, as root, once a
# day. Parameter-expansion splitting on the first `=` and exporting the
# pieces as a single already-literal string reads the same KEY=VALUE shape
# without ever re-interpreting the value's own content as shell syntax.
while IFS= read -r line; do
  case "$line" in
    *=*) export "${line%%=*}=${line#*=}" ;;
  esac
done < backup.env
bash backup.sh "$@"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/usim_cms}" \
RETENTION_DAYS="${RETENTION_DAYS:-14}" \
  bash backup-media.sh "$@"

# --- off-site push (platform_settings.backup_destination) --- same
# reasoning as the docker-mode run.sh's own comment on this block: queried
# fresh every run so a Settings/monitor-dashboard change takes effect
# immediately, no re-install needed. No connection URI is ever passed to
# psql as a CLI argument — PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE were
# already exported above by the read loop (same backup.env this generated),
# so libpq picks them up automatically; an argv containing the password
# would otherwise be visible to any local user on this box via `ps aux`,
# not just root. rclone (installed by install_backup_cron) runs natively —
# unlike docker mode, this host's own Postgres is directly reachable, no
# container wrapper needed.
pg() {
  psql -tAc "$1" 2>/dev/null
}
dest_type="$(pg "SELECT backup_destination->>'type' FROM platform_settings WHERE id='singleton'" | tr -d '[:space:]')"
case "$dest_type" in
  ssh)
    target="$(pg "SELECT backup_destination->'ssh'->>'target' FROM platform_settings WHERE id='singleton'" | tr -d '[:space:]')"
    # Last line of defense, independent of whatever validation the value
    # passed before it ever reached this row: refuse anything without a
    # `:` (so this never silently falls back to a LOCAL rsync destination —
    # see apps/api/src/routes/portal-settings.ts's SSH_TARGET_RE comment for
    # why that matters) or containing `..` (path traversal). `--` then stops
    # rsync from parsing a leading-dash target as an option (argument
    # injection) on top of that.
    case "$target" in
      *..*|*[!A-Za-z0-9_./@:-]*) target="" ;;
      *:*) ;;
      *) target="" ;;
    esac
    [ -n "$target" ] && rsync -a --delete -- "${BACKUP_DIR:-/var/backups/usim_cms}/" "${target}/"
    ;;
  s3|gdrive)
    # conf_dir holds the generated rclone.conf (and, for gdrive, the
    # service-account key) only for this run's lifetime — trap cleans it up
    # even if rclone itself fails.
    conf_dir="$(mktemp -d)"
    trap 'rm -rf "$conf_dir"' EXIT
    if [ "$dest_type" = "s3" ]; then
      {
        printf '[dest]\n'
        printf 'type = s3\n'
        printf 'provider = Other\n'
        printf 'access_key_id = %s\n' "$(pg "SELECT backup_destination->'s3'->>'accessKeyId' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        printf 'secret_access_key = %s\n' "$(pg "SELECT backup_destination->'s3'->>'secretAccessKey' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        printf 'endpoint = %s\n' "$(pg "SELECT backup_destination->'s3'->>'endpoint' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        region="$(pg "SELECT backup_destination->'s3'->>'region' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
        [ -n "$region" ] && printf 'region = %s\n' "$region"
      } > "${conf_dir}/rclone.conf"
      bucket="$(pg "SELECT backup_destination->'s3'->>'bucket' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
      remote_path="dest:${bucket}/$(hostname)"
    else
      # Written via redirection straight from psql's own stdout, never
      # round-tripped through a bash variable — see the docker-mode run.sh's
      # matching comment for why.
      pg "SELECT backup_destination->'gdrive'->>'serviceAccountJson' FROM platform_settings WHERE id='singleton'" > "${conf_dir}/sa.json"
      folder_id="$(pg "SELECT backup_destination->'gdrive'->>'folderId' FROM platform_settings WHERE id='singleton'" | tr -d '\r\n')"
      {
        printf '[dest]\n'
        printf 'type = drive\n'
        printf 'service_account_file = %s/sa.json\n' "$conf_dir"
        printf 'root_folder_id = %s\n' "$folder_id"
      } > "${conf_dir}/rclone.conf"
      remote_path="dest:"
    fi
    rclone sync "${BACKUP_DIR:-/var/backups/usim_cms}" "${remote_path}" --config "${conf_dir}/rclone.conf"
    ;;
esac
EOF
  fi
  chown root:root "$run_script"
  chmod 700 "$run_script"

  # Marker-delimited block, so re-running this installer replaces its own
  # prior entry instead of appending a duplicate every time (same idempotent-
  # rerun convention the rest of this script follows) — anything else already
  # in root's crontab, unrelated to usim_cms, is left untouched.
  local marker_start="# >>> usim_cms backup (install.sh) >>>"
  local marker_end="# <<< usim_cms backup (install.sh) <<<"
  # Off-site push is now a single run.sh step driven by
  # platform_settings.backup_destination (queried fresh every run), not a
  # second static crontab line — see run.sh's own "off-site push" comment
  # above. That is what lets a superadmin change the destination later from
  # the admin panel's Settings tab or the ops monitor dashboard and have it
  # take effect the very next night, with no crontab/installer re-run.
  local new_block="${marker_start}
BACKUP_DIR=${backup_dir}
RETENTION_DAYS=${retention}
0 2 * * * ${run_script} >> /var/log/ucms-backup.log 2>&1
${marker_end}"

  # `crontab -l` exits 1 (no output) when root has never had a crontab before
  # — the normal case on a fresh VPS. Under this script's own `set -euo
  # pipefail`, an unguarded `crontab -l | sed ...` would make THAT exit code
  # propagate as the whole pipeline's status and abort the entire installer
  # right here, on the single most common case. `|| true` neutralizes it;
  # real unexpected crontab errors still surface via `set -e` on the final
  # `| crontab -` write below.
  { (crontab -l 2>/dev/null || true) | sed "/${marker_start}/,/${marker_end}/d"; echo "$new_block"; } | crontab -

  echo "  Backup cron installed: daily 02:00, ${retention}-day retention -> ${backup_dir}"
  if [ -n "$BACKUP_OFFSITE_TARGET" ]; then
    echo "  Off-site rsync to ${BACKUP_OFFSITE_TARGET} right after each run — needs"
    echo "  passwordless SSH key auth to that host already set up (ssh-copy-id),"
    echo "  same requirement backup-media.sh's own SOURCE_HOST pull-mode documents."
  else
    echo "  NOTE: backups stay on this VPS only by default. Set an off-site target"
    echo "  (SSH/rsync, S3/R2, or Google Drive) any time afterward in the admin"
    echo "  panel's Settings tab or the ops monitor dashboard — no re-install needed."
  fi
}

# Re-generates /opt/ucms/backup/{backup.sh,backup-media.sh,backup.env,run.sh}
# and the crontab entry from the CURRENT checked-out code, reusing whatever
# BACKUP_DIR/RETENTION_DAYS this box's crontab already has — no prompts, so
# this is safe to call from a non-interactive context. Entry point for
# `install.sh --reapply-backup-cron --mode=<docker|bare-metal>`, which the
# ops monitor dashboard's own "Apply backup-cron update" button shells out to
# (see monitor/server.js's handleApplyBackupCronUpdate) once it notices the
# installed run.sh predates a feature it needs (the off-site-push block
# missing, or no PGHOST in /etc/ucms-monitor.env yet). Deliberately does NOT
# touch platform_settings.backup_destination — that's a live, superadmin-
# owned setting now (Settings tab / monitor dashboard), never something a
# code update should silently overwrite. Requires an existing backup cron
# (set up via the interactive prompt at least once already) — refuses to
# invent one from nothing non-interactively, same "don't guess at a human
# decision" principle install_backup_cron's own [Y/n] prompt embodies.
reapply_backup_cron() {
  local mode="$1"
  if ! crontab -l 2>/dev/null | grep -qF '# >>> usim_cms backup (install.sh) >>>'; then
    echo "No existing backup cron found on this box — run 'sudo ./install.sh --mode=${mode}' interactively first to set one up." >&2
    exit 1
  fi
  local backup_dir retention
  backup_dir="$(crontab -l 2>/dev/null | grep -m1 '^BACKUP_DIR=' | cut -d= -f2-)"
  retention="$(crontab -l 2>/dev/null | grep -m1 '^RETENTION_DAYS=' | cut -d= -f2-)"
  backup_dir="${backup_dir:-/var/backups/usim_cms}"
  retention="${retention:-14}"
  BACKUP_OFFSITE_TARGET=""
  _apply_backup_cron_files "$mode" "$backup_dir" "$retention"
  finish_backup_destination_setup "$mode"
  echo "Backup-cron scripts regenerated from the current checkout (dir=${backup_dir}, retention=${retention}d)."
}

# Finishes what install_backup_cron() started: gives the ops monitor (a
# separate, zero-dependency Node process — see monitor/server.js's own header
# comment) the same control-plane connection install_backup_cron already
# snapshotted into /opt/ucms/backup/backup.env, so its "Backup destination"
# card can read/write platform_settings.backup_destination too (via psql, not
# a pg driver — see that file's own comment on why). Also seeds that row
# with the off-site target install_backup_cron's own prompt collected, if
# any — BACKUP_OFFSITE_TARGET is the global that function sets, empty when
# the prompt was skipped, declined, or this is a non-interactive run, in
# which case this just wires the connection and leaves the column's own
# '{"type":"local"}' default alone. Must run after the DB is actually up and
# reachable (create_superadmin/create_superadmin_production already forced
# ensurePublicSchema to create platform_settings) and after install_monitor
# has created /etc/ucms-monitor.env — unlike install_backup_cron's own call
# site, which runs before any of that in every mode (the stack isn't even
# started yet), so it can't do this seeding itself.
finish_backup_destination_setup() {
  local mode="$1"
  if [ "$mode" = "docker" ]; then
    local pg_app_password
    pg_app_password="$(grep -m1 '^POSTGRES_APP_PASSWORD=' "${REPO_DIR}/.env" | cut -d= -f2-)"
    PG_URL_HOST="db"; PG_URL_PORT="5432"; PG_URL_USER="usim_cms_app"; PG_URL_PASSWORD="$pg_app_password"; PG_URL_DATABASE="usim_cms"
  else
    local db_url
    db_url="$(grep -m1 '^DATABASE_URL=' "${REPO_DIR}/apps/api/.env" | cut -d= -f2-)"
    parse_pg_url "$db_url"
  fi
  # PGHOST/PGPORT/.../PGPASSWORD, never a connection URI — the dashboard's
  # own psql calls (monitor/server.js's runPsql) read these the same way
  # run.sh's own `pg()` does, so the password never has to be an argv to
  # anything (see install_backup_cron's own comment on why that's a leak).
  set_env_kv /etc/ucms-monitor.env PGHOST "$PG_URL_HOST"
  set_env_kv /etc/ucms-monitor.env PGPORT "$PG_URL_PORT"
  set_env_kv /etc/ucms-monitor.env PGUSER "$PG_URL_USER"
  set_env_kv /etc/ucms-monitor.env PGPASSWORD "$PG_URL_PASSWORD"
  set_env_kv /etc/ucms-monitor.env PGDATABASE "$PG_URL_DATABASE"

  if [ -z "${BACKUP_OFFSITE_TARGET:-}" ]; then
    return
  fi
  # BACKUP_OFFSITE_TARGET was already regex-validated to a leading-alnum,
  # [A-Za-z0-9_.@:/-]-only shape (install_backup_cron above) — no quotes/
  # backslashes possible, so embedding it directly in this JSON literal and
  # then in this SQL string literal is safe without extra escaping.
  local json sql
  json="$(printf '{"type":"ssh","ssh":{"target":"%s"}}' "$BACKUP_OFFSITE_TARGET")"
  sql="INSERT INTO platform_settings (id, backup_destination) VALUES ('singleton', '${json}'::jsonb) ON CONFLICT (id) DO UPDATE SET backup_destination = EXCLUDED.backup_destination, updated_at = now();"
  local ok=true
  # PGPASSWORD is exported into THIS shell's own environment (never part of
  # the docker/psql command line itself) and, for docker, forwarded into the
  # container by name only (`-e PGPASSWORD` with no `=value`) — docker reads
  # the value from its own process environment, so it's never visible via
  # `ps aux` the way a `-e PGPASSWORD=...` or a bare connection URI would be.
  export PGHOST="$PG_URL_HOST" PGPORT="$PG_URL_PORT" PGUSER="$PG_URL_USER" PGPASSWORD="$PG_URL_PASSWORD" PGDATABASE="$PG_URL_DATABASE"
  if [ "$mode" = "docker" ]; then
    docker run --rm --network ucms-net -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE postgres:16-alpine psql -c "$sql" >/dev/null 2>&1 || ok=false
  else
    psql -c "$sql" >/dev/null 2>&1 || ok=false
  fi
  if [ "$ok" = "true" ]; then
    echo "  Seeded the off-site target into the admin panel's Settings/monitor Backup destination card."
  else
    echo "  Could not seed the off-site target into the database — set it by hand later in Settings or the monitor dashboard." >&2
  fi
}

# Private, pinned Node runtime — never touches system Node (no NodeSource
# repo, no global npm/pnpm), so it can never conflict with whatever Node
# version any other project on this VPS already relies on. Referenced only
# by the absolute path this prints, from systemd units and this script.
# Version is resolved from nodejs.org's own LTS feed at install time (same
# source monitor/server.js's getUpstreamLatest uses), not hardcoded — so a
# fresh install always lands on the current LTS instead of drifting stale
# against the Docker path's own node:NN-alpine, which bumps independently.
NODE_ROOT="/opt/ucms/node"
NODE_VERSION_FILE="${NODE_ROOT}/.node-version"
resolve_latest_node_lts() {
  curl -fsSL https://nodejs.org/dist/index.json \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const r=JSON.parse(d).find(x=>x.lts);if(!r){process.exit(1)}process.stdout.write(r.version.replace(/^v/,""))})'
}
ensure_private_node() {
  local arch node_bin node_version pinned_version
  case "$(uname -m)" in
    x86_64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported CPU arch: $(uname -m)" >&2; exit 1 ;;
  esac
  node_bin="${NODE_ROOT}/bin/node"
  # Trust-on-first-use only against a version WE recorded on a verified
  # install, not just "a binary happens to exist here" — otherwise a box
  # could end up running whatever bytes sit at that path with no record of
  # what they are.
  if [ -x "$node_bin" ] && [ -f "$NODE_VERSION_FILE" ]; then
    pinned_version="$(cat "$NODE_VERSION_FILE")"
    if "$node_bin" --version 2>/dev/null | grep -qF "v${pinned_version}"; then
      echo "$node_bin"
      return
    fi
  fi
  node_version="$(resolve_latest_node_lts)"
  # nodejs.org's index.json is untrusted input over the network — validate
  # strictly before it ever reaches a file path or a download URL below.
  if ! printf '%s' "$node_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "Resolved Node version '${node_version}' doesn't look like a real x.y.z version — refusing to use it (check network/DNS, or nodejs.org may be returning something unexpected)." >&2
    exit 1
  fi
  if ! command -v gpgv >/dev/null 2>&1; then
    if [ "$PKG_MGR" = "apt" ]; then
      pkg_install gpgv || true
    else
      pkg_install gnupg2 || true
    fi
  fi
  command -v gpgv >/dev/null 2>&1 || { echo "gpgv not available and couldn't be installed — refusing to install Node without signature verification." >&2; exit 1; }
  {
    echo "Downloading a private Node.js v${node_version} (${arch}) to ${NODE_ROOT}..." >&2
    mkdir -p "$NODE_ROOT"
    local tarball="node-v${node_version}-linux-${arch}.tar.gz"
    local tmp_dir expected_sha actual_sha
    tmp_dir="$(mktemp -d)"
    curl -fsSL "https://nodejs.org/dist/v${node_version}/${tarball}" -o "${tmp_dir}/${tarball}"
    # SHASUMS256.txt alone is fetched from the same host/CDN as the binary,
    # so it only catches transit corruption, not a compromised nodejs.org —
    # verify its GPG signature against the Node.js release keyring (a
    # separate trust root, from the nodejs/release-keys GitHub repo) before
    # trusting any checksum out of it. See node's own README.md "Verifying
    # binaries" section.
    curl -fsSL "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt.asc" -o "${tmp_dir}/SHASUMS256.txt.asc"
    curl -fsSL "https://github.com/nodejs/release-keys/raw/HEAD/gpg/pubring.kbx" -o "${tmp_dir}/nodejs-keyring.kbx"
    if ! gpgv --keyring="${tmp_dir}/nodejs-keyring.kbx" --output "${tmp_dir}/SHASUMS256.txt" < "${tmp_dir}/SHASUMS256.txt.asc"; then
      echo "GPG signature verification of SHASUMS256.txt.asc failed — refusing to install (possible tampered download or compromised mirror)." >&2
      rm -rf "$tmp_dir"
      exit 1
    fi
    expected_sha="$(grep -E "  ${tarball}\$" "${tmp_dir}/SHASUMS256.txt" | awk '{print $1}')"
    if [ -z "$expected_sha" ]; then
      echo "Couldn't find a checksum for ${tarball} in nodejs.org's signed SHASUMS256.txt — refusing to install an unverified binary." >&2
      rm -rf "$tmp_dir"
      exit 1
    fi
    actual_sha="$(sha256sum "${tmp_dir}/${tarball}" | awk '{print $1}')"
    if [ "$expected_sha" != "$actual_sha" ]; then
      echo "Checksum mismatch for ${tarball}: expected ${expected_sha}, got ${actual_sha} — refusing to install a corrupted or tampered download." >&2
      rm -rf "$tmp_dir"
      exit 1
    fi
    tar -xzf "${tmp_dir}/${tarball}" -C "$NODE_ROOT" --strip-components=1
    rm -rf "$tmp_dir"
    echo "$node_version" > "$NODE_VERSION_FILE"
  } >&2
  echo "$node_bin"
}

install_monitor() {
  # $1 = node_bin, $2 = deploy mode ("docker" or "systemd", written to
  # /etc/ucms-monitor.env for monitor/server.js's own dispatch), $3 = monitor
  # port, $4 = topology ("trial" default, or "production") — kept separate
  # from $2 since monitor/server.js itself doesn't need a third DEPLOY_MODE
  # value (it already tells trial vs blue-green apart at runtime via its own
  # isTrialModeActive()/.deploy-color); this just gates the trial-specific
  # api-recreate step below so it never runs for a blue-green install.
  local node_bin="$1" deploy_mode="$2" monitor_port="$3" topology="${4:-trial}"
  echo ""
  echo "Setting up the ops monitor..."
  if [ ! -f /etc/ucms-monitor.env ]; then
    local monitor_password
    monitor_password="$(openssl rand -hex 16)"
    cat > /etc/ucms-monitor.env <<EOF
MONITOR_PORT=${monitor_port}
REPO_DIR=${REPO_DIR}
MONITOR_USER=admin
MONITOR_PASSWORD=${monitor_password}
DEPLOY_MODE=${deploy_mode}
EOF
    chmod 600 /etc/ucms-monitor.env
    echo "Generated monitor password (saved in /etc/ucms-monitor.env)."
  else
    sed -i.bak \
      -e "s|^MONITOR_PORT=.*|MONITOR_PORT=${monitor_port}|" \
      -e "s|^REPO_DIR=.*|REPO_DIR=${REPO_DIR}|" \
      -e "s|^DEPLOY_MODE=.*|DEPLOY_MODE=${deploy_mode}|" \
      /etc/ucms-monitor.env
    rm -f /etc/ucms-monitor.env.bak
    echo "Reusing existing monitor password from /etc/ucms-monitor.env."
  fi

  # Alert webhook (monitor/server.js's up/down + disk-threshold alerts, see
  # that file's own ALERT_WEBHOOK_URL comment) — without this, every alert
  # this dashboard already tracks (service down, disk over threshold) stays
  # completely silent, since there's no email/SMTP client here by design.
  # Interactive-only, same off-on-non-interactive-run convention as
  # configure_optional_integrations; a blank reply keeps whatever is already
  # configured instead of wiping it, since this runs again on every
  # install.sh re-run (not just first install).
  if [ -t 0 ]; then
    local existing_webhook alert_webhook
    existing_webhook="$(grep -m1 '^ALERT_WEBHOOK_URL=' /etc/ucms-monitor.env 2>/dev/null | cut -d= -f2-)"
    echo ""
    if [ -n "$existing_webhook" ]; then
      echo "Alert webhook is already configured."
      read -r -p "Replace it? Slack/Discord/Teams incoming webhook, or custom endpoint (blank = keep current): " alert_webhook
    else
      echo "No alert webhook configured yet — service-down/disk-space alerts would go unnoticed."
      read -r -p "Alert webhook URL (Slack/Discord/Teams incoming webhook, or custom endpoint; blank = skip): " alert_webhook
    fi
    if [ -n "$alert_webhook" ]; then
      set_env_kv /etc/ucms-monitor.env ALERT_WEBHOOK_URL "$alert_webhook"
      echo "  Saved — test it from the monitor dashboard, or POST /api/alerts/test, once it's reachable."
    fi
  fi

  sed -e "s|__NODE_BIN__|${node_bin}|g" -e "s|__REPO_DIR__|${REPO_DIR}|g" \
    monitor/ucms-monitor.service.template > /etc/systemd/system/ucms-monitor.service
  systemctl daemon-reload
  systemctl enable --now ucms-monitor
  systemctl restart ucms-monitor
  MONITOR_PASSWORD="$(grep '^MONITOR_PASSWORD=' /etc/ucms-monitor.env | cut -d= -f2-)"

  ensure_certbot

  # Lets apps/api's own POST /api/portal/ssl/issue (admin panel's SSL card)
  # reach this same monitor process to run certbot. In docker mode api runs
  # inside a container — host.docker.internal:host-gateway (wired on the api
  # service in docker-compose.yml/.release.yml/.trial.yml) is how a
  # container reaches this host-level monitor port; in systemd mode api runs
  # directly on the host, so plain loopback works.
  if [ "$deploy_mode" = "docker" ]; then
    set_env_kv .env MONITOR_URL "http://host.docker.internal:${monitor_port}"
    set_env_kv .env MONITOR_USER "admin"
    set_env_kv .env MONITOR_PASSWORD "${MONITOR_PASSWORD}"
    if [ "$topology" = "trial" ]; then
      # api is already running by the time this function is called (see the
      # trial-mode call site) — recreate it so it actually picks up the 3
      # vars just written, since compose only reads .env at container start.
      docker compose -f docker-compose.yml -f docker-compose.trial.yml up -d api 2>/dev/null || true
    fi
    # Production/blue-green: the MONITOR_* vars just written above reach the
    # api container on the NEXT scripts/deploy.sh run (it always rebuilds and
    # recreates it) — no separate recreate step here, since forcing one via
    # docker-compose.trial.yml would stand up a second, unrelated "api"
    # container with nothing to do with the live blue/green one.
  else
    set_env_kv apps/api/.env MONITOR_URL "http://127.0.0.1:${monitor_port}"
    set_env_kv apps/api/.env MONITOR_USER "admin"
    set_env_kv apps/api/.env MONITOR_PASSWORD "${MONITOR_PASSWORD}"
  fi
}

open_firewall_ports() {
  if [ "$FIREWALL_TOOL" = "ufw" ]; then
    if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
      echo ""
      echo "ufw is active — opening the ports this stack uses..."
      for p in "$@"; do
        ufw allow "${p}/tcp" >/dev/null
      done
    fi
  else
    if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
      echo ""
      echo "firewalld is active — opening the ports this stack uses..."
      for p in "$@"; do
        firewall-cmd --permanent --add-port="${p}/tcp" >/dev/null
      done
      firewall-cmd --reload >/dev/null
    fi
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Creates the first superadmin against a healthy API's own /api/setup route
# (see index.ts: self-disabling once any user row exists). Safe to re-run —
# if setup was already completed (by this call or the admin's Setup Wizard),
# it just skips instead of erroring.
create_superadmin() {
  local api_port="$1" status status_rc resp
  echo ""
  echo "Creating superadmin account..."
  status=$(curl -fs "http://localhost:${api_port}/api/setup/status" 2>/dev/null)
  status_rc=$?
  if [ $status_rc -ne 0 ]; then
    echo "Warning: could not reach /api/setup/status on port ${api_port} — skipping superadmin creation." >&2
    echo "  Re-run with --admin-only once the API is reachable to create it." >&2
    return
  fi
  if ! echo "$status" | grep -q '"needsSetup":true'; then
    echo "Setup already completed — skipping (log in with the existing account)."
    return
  fi
  # JSON body goes over stdin, never as a curl argv — a password passed via
  # -d "..." would sit in this process's command line, readable by any local
  # user via `ps` for as long as the request is in flight.
  resp=$(printf '{"email":"%s","password":"%s"}' \
      "$(json_escape "$SUPERADMIN_EMAIL")" "$(json_escape "$SUPERADMIN_PASSWORD")" \
    | curl -fs -X POST "http://localhost:${api_port}/api/setup" \
        -H "Content-Type: application/json" --data-binary @- \
        2>/dev/null || true)
  # -i: /api/setup's success response carries a "csrfToken" field (the
  # cookie+CSRF session migration renamed the old bare "token"), and a
  # case-sensitive match here was reporting a real success as a failure.
  if echo "$resp" | grep -qi 'token'; then
    echo "Superadmin created: ${SUPERADMIN_EMAIL}"
  else
    echo "Warning: superadmin creation failed — create one later from the admin's Setup Wizard." >&2
    echo "  Response: ${resp:-<no response>}" >&2
  fi
}

wait_for_api_health() {
  # $1 = api_port, $2 = number of 2s tries (default 30 = 60s). Returns 0 the
  # moment /health answers, 1 if it never does within the budget — unlike
  # the old bare wait loop, callers can actually tell success from timeout.
  local api_port="$1" tries="${2:-30}" i
  for ((i = 0; i < tries; i++)); do
    curl -fs "http://localhost:${api_port}/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

curl_reachable() {
  # Reachability, not correctness: any HTTP response (even a 404/500) means
  # something answered; curl's %{http_code} is literally "000" only when it
  # never got a response at all (refused/reset/timed out).
  local url="$1" code
  code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$url" 2>/dev/null || true)
  [ -n "$code" ] && [ "$code" != "000" ]
}

# The check this whole round of hardening exists for: a container/service can
# report itself perfectly "healthy" via its OWN internal healthcheck (which
# only ever proves 127.0.0.1-inside-the-same-namespace works) while the
# published port is completely unreachable from outside — exactly what
# happened this session, twice, for two unrelated reasons (an app bound to
# 127.0.0.1 instead of 0.0.0.0; Docker's own iptables chains resetting
# forwarded connections). This hits the ports the same way a real browser
# would: from the host, through whatever NAT/proxy sits in front of them.
verify_external_reachability() {
  local api_port="$1" admin_port="$2" frontend_port="$3" ok="true"
  echo ""
  echo "Verifying the stack is reachable from outside (not just healthy inside its own container)..."
  if wait_for_api_health "$api_port" 30; then
    echo "  API (:${api_port})      — reachable"
  else
    echo "  API (:${api_port})      — NOT reachable" >&2
    ok="false"
  fi
  if curl_reachable "http://localhost:${admin_port}/"; then
    echo "  Admin (:${admin_port})    — reachable"
  else
    echo "  Admin (:${admin_port})    — NOT reachable" >&2
    ok="false"
  fi
  if curl_reachable "http://localhost:${frontend_port}/"; then
    echo "  Frontend (:${frontend_port}) — reachable"
  else
    echo "  Frontend (:${frontend_port}) — NOT reachable" >&2
    ok="false"
  fi
  [ "$ok" = "true" ]
}

diagnose_reachability() {
  # $1 = api_port. Prints the same evidence this session's manual debugging
  # session gathered by hand (docker compose ps, ss -ltnp, iptables -L
  # FORWARD / systemd unit status) — read-only, safe to run any time.
  local api_port="$1"
  echo "" >&2
  echo "---- diagnostic report (port :${api_port}) ----" >&2
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "-- docker compose ps --" >&2
    if [ -f .deploy-color ]; then
      docker compose -p "ucms-$(cat .deploy-color)" -f docker-compose.release.yml ps >&2 || true
    else
      docker compose -f docker-compose.yml -f docker-compose.trial.yml ps >&2 || true
    fi
    echo "-- port listener (ss -ltnp) --" >&2
    ss -ltnp 2>/dev/null | grep ":${api_port} " >&2 || echo "  (nothing listening on :${api_port})" >&2
    echo "-- iptables FORWARD chain --" >&2
    iptables -L FORWARD -n -v 2>/dev/null >&2 || echo "  (iptables not available)" >&2
  else
    echo "-- systemd unit status --" >&2
    systemctl status ucms-api --no-pager -l 2>&1 | head -20 >&2 || true
    echo "-- port listener (ss -ltnp) --" >&2
    ss -ltnp 2>/dev/null | grep ":${api_port} " >&2 || echo "  (nothing listening on :${api_port})" >&2
  fi
  echo "------------------------------------------------" >&2
}

# Verifies reachability; on failure, diagnoses, tries exactly one bounded
# self-heal (restart the thing most likely to be stuck), and re-verifies
# once more before giving up. Never claims success it didn't re-check.
ensure_reachable_or_selfheal() {
  local api_port="$1" admin_port="$2" frontend_port="$3" mode="$4"
  if verify_external_reachability "$api_port" "$admin_port" "$frontend_port"; then
    return 0
  fi
  echo "" >&2
  echo "Reachability check failed — diagnosing and attempting one self-heal..." >&2
  diagnose_reachability "$api_port"
  if [ "$mode" = "docker" ]; then
    echo "Restarting the Docker daemon (regenerates its NAT/iptables chains) and containers..." >&2
    systemctl restart docker
    sleep 5
    docker compose up -d >/dev/null 2>&1 || true
    # Trial mode's api/frontend/admin live in docker-compose.trial.yml, not
    # the bare `docker compose up -d` above — bring those back too, but only
    # on a box still in trial mode. .deploy-color only ever exists once
    # scripts/deploy.sh has adopted this box for real (see CLAUDE.md's
    # Deployment section) — bringing trial containers back up on a box
    # that's gone live would fight the blue/green containers for the same
    # host ports.
    if [ ! -f .deploy-color ]; then
      docker compose -f docker-compose.yml -f docker-compose.trial.yml up -d >/dev/null 2>&1 || true
    fi
  else
    echo "Restarting the app services..." >&2
    systemctl restart ucms-api ucms-frontend ucms-admin
  fi
  if verify_external_reachability "$api_port" "$admin_port" "$frontend_port"; then
    echo "Self-heal worked — stack is reachable now." >&2
    return 0
  fi
  echo "" >&2
  echo "Still not reachable after one self-heal attempt. This box's own firewall" >&2
  echo "and Docker's/systemd's own networking both look fine from here (see the" >&2
  echo "diagnostic above) — if this is a cloud VPS, check that provider's own" >&2
  echo "security group/firewall console for these ports next. Re-run any time" >&2
  echo "with --diagnose to repeat just this check without reinstalling." >&2
  diagnose_reachability "$api_port"
  return 1
}

# Keeps containers running (still serving traffic) across a dockerd
# restart/crash/package-upgrade instead of them being killed and waiting for
# dockerd to come back and re-start them — same self-heal spirit as compose's
# own restart:unless-stopped, one layer down. Off by default in upstream
# Docker; idempotent (no-ops if already set) and safe to call on every
# install.sh run, including against an already-installed box. Only writes a
# fresh file — a pre-existing /etc/docker/daemon.json (e.g. one already
# carrying a registry mirror) is left alone rather than risk clobbering it
# with a hand-rolled JSON merge; the operator is told to add the key by hand
# in that case.
ensure_docker_live_restore() {
  local daemon_json="/etc/docker/daemon.json"
  if [ -f "$daemon_json" ]; then
    if grep -q '"live-restore"[[:space:]]*:[[:space:]]*true' "$daemon_json" 2>/dev/null; then
      return 0
    fi
    if [ -s "$daemon_json" ]; then
      echo "NOTE: $daemon_json already exists and doesn't set live-restore — leaving it alone." >&2
      echo "      Add \"live-restore\": true to it by hand, then 'systemctl restart docker', to get this hardening." >&2
      return 0
    fi
  fi
  echo "Enabling Docker's live-restore (containers survive a dockerd restart)..."
  printf '{\n  "live-restore": true\n}\n' > "$daemon_json"
  systemctl restart docker
}

# systemd-journald's own on-disk log (/var/log/journal — host/SSH/kernel
# logs, separate from each container's own json-file log capped above) has
# no size limit by default on many distros and was observed growing past 1.8G
# on one live VPS. A drop-in file (not editing journald.conf directly) so a
# re-run or an operator's own journald.conf edits never conflict; idempotent,
# same pattern as ensure_docker_live_restore above.
ensure_journald_cap() {
  local dropin_dir="/etc/systemd/journald.conf.d"
  local dropin="$dropin_dir/00-usim-cms-size-cap.conf"
  if [ -f "$dropin" ]; then
    return 0
  fi
  echo "Capping systemd-journald's on-disk log size (SystemMaxUse=200M)..."
  mkdir -p "$dropin_dir"
  printf '[Journal]\nSystemMaxUse=200M\n' > "$dropin"
  systemctl restart systemd-journald
}

# ---------------------------------------------------------------------------
# Docker mode
# ---------------------------------------------------------------------------
install_docker_mode() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not found — installing via get.docker.com (adds its own repo for this distro only)..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  else
    echo "Docker already installed: $(docker --version)"
  fi
  ensure_docker_live_restore
  ensure_journald_cap
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker is installed but the 'compose' plugin is missing." >&2
    echo "Install it: https://docs.docker.com/compose/install/" >&2
    exit 1
  fi

  local api_port frontend_port admin_port monitor_port public_host
  api_port=$(find_free_port 3000)
  frontend_port=$(find_free_port 4321)
  admin_port=$(find_free_port 5173)
  monitor_port=$(find_free_port 5555)
  echo ""
  echo "Ports chosen (auto-picked next free one if the default was taken):"
  echo "  api      -> $api_port"
  echo "  frontend -> $frontend_port"
  echo "  admin    -> $admin_port"
  echo "  monitor  -> $monitor_port"

  public_host=$(detect_public_host)
  echo "Public host: $public_host"

  if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
  fi
  # Holds POSTGRES_SUPERUSER_PASSWORD/SESSION_SECRET/DEPLOY_SECRET/
  # MONITOR_PASSWORD — same treatment /etc/ucms-monitor.env already gets
  # right after it's written, so no other local account on the box can read it.
  chmod 600 .env
  fill_env_if_blank .env POSTGRES_SUPERUSER_PASSWORD
  fill_env_if_blank .env POSTGRES_APP_PASSWORD
  fill_env_if_blank .env SESSION_SECRET
  set_env_kv .env VITE_API_URL "http://${public_host}:${api_port}"
  set_env_kv .env VITE_FRONTEND_URL "http://${public_host}:${frontend_port}"
  # Without this, docker-compose.yml's own ADMIN_ORIGIN fallback
  # (http://localhost:${ADMIN_PORT}) never matches a real VPS's public
  # IP/domain — every admin request gets CORS-blocked. Whatever origin the
  # admin panel actually gets served from (this same public_host:admin_port)
  # must be the allowed one.
  set_env_kv .env ADMIN_ORIGIN "http://${public_host}:${admin_port}"
  # Host-side port remapping goes through .env (API_PORT/FRONTEND_PORT/
  # ADMIN_PORT, read by docker-compose.yml's `${VAR:-default}` port entries)
  # rather than a docker-compose.override.yml: Compose concatenates
  # list-valued keys like `ports` across files instead of replacing them, so
  # an override file here would bind BOTH the default and the picked port —
  # exactly the bug that made api still fail to bind :3000 even after this
  # script correctly picked a free 3001 elsewhere on a port-conflicted box.
  set_env_kv .env API_PORT "$api_port"
  set_env_kv .env FRONTEND_PORT "$frontend_port"
  set_env_kv .env ADMIN_PORT "$admin_port"
  configure_optional_integrations .env
  install_backup_cron "docker"
  # Remove a stale override from a previous run of this script (pre-fix
  # versions generated one) — leaving it in place would still trigger the
  # same bind-both-ports bug described above.
  rm -f docker-compose.override.yml

  echo ""
  echo "Building and starting containers (first run can take a few minutes)..."
  # docker-compose.trial.yml adds api/frontend/admin on host-published ports
  # (no Caddy) on top of this file's db+proxy — see that file's own header
  # for why docker-compose.yml alone no longer has those 3 services.
  docker compose -f docker-compose.yml -f docker-compose.trial.yml up -d --build db api frontend admin

  if ! ensure_reachable_or_selfheal "$api_port" "$admin_port" "$frontend_port" "docker"; then
    echo "" >&2
    echo "Aborting — the stack is up but not reachable, so it wouldn't work in a" >&2
    echo "browser either. See the diagnostic report above for what to check next." >&2
    exit 1
  fi

  create_superadmin "$api_port"

  local node_bin
  node_bin=$(ensure_private_node)
  install_monitor "$node_bin" "docker" "$monitor_port"
  finish_backup_destination_setup "docker"
  open_firewall_ports "$api_port" "$frontend_port" "$admin_port" "$monitor_port"

  echo ""
  echo "================================================================"
  echo " Done (docker mode)."
  echo "   Admin panel:  http://${public_host}:${admin_port}"
  echo "   Public site:  http://${public_host}:${frontend_port}"
  echo "   API:          http://${public_host}:${api_port}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/ucms-monitor.env on this VPS)"
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
  echo "================================================================"
}

# ---------------------------------------------------------------------------
# Production mode (blue-green + Caddy) — docker-compose.yml (base) +
# docker-compose.release.yml (blue/green app tier, via scripts/deploy.sh)
# ---------------------------------------------------------------------------

# Set by ensure_caddy_bind_ports — read by the reachability check below.
CADDY_HTTP_PORT="80"
NEEDS_NGINX_SNIPPET="false"

# Detects whether 80/443 already belong to another app on this shared VPS —
# never assumes. Free: Caddy binds them directly and keeps auto-HTTPS. Taken:
# Caddy moves to loopback-only ports (never touches the real 80/443 another
# app owns) and this box needs one manual nginx vhost added afterward (see
# print_nginx_snippet) — install.sh never edits another app's nginx config
# itself, that's too blind an action to automate on a shared box.
ensure_caddy_bind_ports() {
  if port_in_use 80 || port_in_use 443; then
    echo ""
    echo "Port 80 and/or 443 already in use by another app on this VPS."
    echo "Binding Caddy to loopback-only ports instead — you'll add one nginx"
    echo "vhost yourself afterward (exact snippet printed at the end)."
    CADDY_HTTP_PORT=$(find_free_port 8090)
    local https_port
    https_port=$(find_free_port 8091)
    set_env_kv .env PROXY_BIND_HTTP "127.0.0.1:${CADDY_HTTP_PORT}:80"
    set_env_kv .env PROXY_BIND_HTTPS "127.0.0.1:${https_port}:443"
    # Caddy can't prove domain ownership (ACME) on a port it doesn't really
    # own — auto-HTTPS must be off; whatever already holds 80/443 terminates
    # TLS instead. Idempotent: only touches the line if still commented.
    if grep -qE '^\s*# auto_https off' Caddyfile; then
      sed -i.bak -E 's/^(\s*)# auto_https off/\1auto_https off/' Caddyfile && rm -f Caddyfile.bak
    fi
    NEEDS_NGINX_SNIPPET="true"
  else
    CADDY_HTTP_PORT="80"
    NEEDS_NGINX_SNIPPET="false"
    # Clear any loopback bind left over from an EARLIER run where 80/443
    # were taken — docker-compose.yml's ${PROXY_BIND_HTTP:-80:80} only falls
    # back to the real default when the var is unset OR empty, so a stale
    # value here would keep Caddy on loopback forever even after whatever
    # was using 80/443 before is gone.
    set_env_kv .env PROXY_BIND_HTTP ""
    set_env_kv .env PROXY_BIND_HTTPS ""
    # Revert Caddyfile's auto_https toggle too, if an earlier run turned it
    # off — Caddy owns 80/443 for real now and can prove domain ownership.
    if grep -qE '^\s*auto_https off' Caddyfile; then
      sed -i.bak -E 's/^(\s*)auto_https off/\1# auto_https off/' Caddyfile && rm -f Caddyfile.bak
    fi
  fi
}

print_nginx_snippet() {
  echo ""
  echo "---- add this to your existing nginx config, then: nginx -t && systemctl reload nginx ----"
  for domain in "$ADMIN_DOMAIN" "$API_DOMAIN" $TENANT_DOMAINS; do
    cat <<EOF
server {
    listen 80;
    listen 443 ssl;
    server_name ${domain};
    # ... your existing ssl_certificate/ssl_certificate_key lines for this domain ...
    location / {
        proxy_pass http://127.0.0.1:${CADDY_HTTP_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  done
  echo "-------------------------------------------------------------------------------------------"
}

prompt_domains() {
  if [ -z "${ADMIN_DOMAIN:-}" ] && [ -t 0 ]; then
    read -r -p "Admin panel domain (blank = admin.localhost, test-only): " ADMIN_DOMAIN
  fi
  if [ -z "${API_DOMAIN:-}" ] && [ -t 0 ]; then
    read -r -p "API domain (blank = api.localhost, test-only): " API_DOMAIN
  fi
  if [ -z "${TENANT_DOMAINS:-}" ] && [ -t 0 ]; then
    read -r -p "Tenant site domain(s), space-separated (blank = tenant.localhost, test-only): " TENANT_DOMAINS
  fi
  ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.localhost}"
  API_DOMAIN="${API_DOMAIN:-api.localhost}"
  TENANT_DOMAINS="${TENANT_DOMAINS:-tenant.localhost}"
  case "$ADMIN_DOMAIN $API_DOMAIN" in
    *.localhost*)
      echo "" >&2
      echo "Warning: using a *.localhost placeholder domain — Caddy's automatic" >&2
      echo "HTTPS needs a real domain with DNS already pointed at this VPS to" >&2
      echo "work. Fine for internal testing only." >&2
      ;;
  esac
}

# Blue-green never publishes api to the host (see docker-compose.release.yml)
# — reaches it the same way scripts/deploy.sh's own promote() does, via
# `docker compose exec` into the currently-live color. The JSON body goes
# over stdin into the node process (never argv/-e env vars) for the same
# reason the trial-mode create_superadmin() above already avoids that: a
# password on this process's own command line would be readable via `ps` by
# any local user for as long as the request is in flight.
SETUP_SCRIPT_PRODUCTION='
let body = "";
process.stdin.on("data", (c) => (body += c));
process.stdin.on("end", () => {
  fetch("http://127.0.0.1:3000/api/setup/status")
    .then((r) => r.json())
    .then((status) => {
      if (!status.needsSetup) { console.log("ALREADY_SETUP"); return; }
      return fetch("http://127.0.0.1:3000/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).then((r) => r.text()).then((t) => console.log(t.toLowerCase().includes("token") ? "CREATED" : "FAILED:" + t));
    })
    .catch((e) => { console.error(String(e)); process.exit(1); });
});
'
create_superadmin_production() {
  echo ""
  echo "Creating superadmin account..."
  local color resp
  color="$(cat .deploy-color 2>/dev/null || echo blue)"
  if ! resp=$(printf '{"email":"%s","password":"%s"}' \
      "$(json_escape "$SUPERADMIN_EMAIL")" "$(json_escape "$SUPERADMIN_PASSWORD")" \
    | docker compose -p "ucms-${color}" -f docker-compose.release.yml exec -T api node -e "$SETUP_SCRIPT_PRODUCTION" 2>&1); then
    echo "Warning: could not reach the API container to create superadmin —" >&2
    echo "  create one later from the admin's Setup Wizard, or re-run with --admin-only." >&2
    return
  fi
  case "$resp" in
    *ALREADY_SETUP*) echo "Setup already completed — skipping (log in with the existing account)." ;;
    *CREATED*) echo "Superadmin created: ${SUPERADMIN_EMAIL}" ;;
    *) echo "Warning: superadmin creation failed — create one later from the admin's Setup Wizard." >&2
       echo "  Response: ${resp}" >&2 ;;
  esac
}

# Caddy routes by Host header, so this checks routing works — not just "port
# 80 accepts connections" — the same reasoning verify_external_reachability
# (trial mode) already applies to raw ports. Doesn't depend on public DNS
# actually pointing here yet, unlike hitting the real domain would.
verify_production_reachability() {
  local ok="true" domain
  echo ""
  echo "Verifying the stack is reachable through Caddy (Host-based routing)..."
  for domain in "$ADMIN_DOMAIN" "$API_DOMAIN" ${TENANT_DOMAINS%% *}; do
    if curl_reachable_host "$domain" "$CADDY_HTTP_PORT"; then
      echo "  ${domain} — reachable"
    else
      echo "  ${domain} — NOT reachable" >&2
      ok="false"
    fi
  done
  [ "$ok" = "true" ]
}
curl_reachable_host() {
  local domain="$1" port="$2" code
  code=$(curl -s -o /dev/null --max-time 5 -H "Host: ${domain}" "http://127.0.0.1:${port}/" -w '%{http_code}' 2>/dev/null || true)
  [ -n "$code" ] && [ "$code" != "000" ]
}

install_production_mode() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not found — installing via get.docker.com (adds its own repo for this distro only)..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  else
    echo "Docker already installed: $(docker --version)"
  fi
  ensure_docker_live_restore
  ensure_journald_cap
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker is installed but the 'compose' plugin is missing." >&2
    echo "Install it: https://docs.docker.com/compose/install/" >&2
    exit 1
  fi

  local monitor_port public_host
  monitor_port=$(find_free_port 5555)
  public_host=$(detect_public_host)
  echo "Public host: $public_host"

  if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
  fi
  # Holds POSTGRES_SUPERUSER_PASSWORD/SESSION_SECRET/DEPLOY_SECRET/
  # MONITOR_PASSWORD — same treatment /etc/ucms-monitor.env already gets
  # right after it's written, so no other local account on the box can read it.
  chmod 600 .env
  ensure_caddy_bind_ports
  prompt_domains

  fill_env_if_blank .env POSTGRES_SUPERUSER_PASSWORD
  fill_env_if_blank .env POSTGRES_APP_PASSWORD
  fill_env_if_blank .env SESSION_SECRET
  fill_env_if_blank .env DEPLOY_SECRET
  set_env_kv .env ADMIN_DOMAIN "$ADMIN_DOMAIN"
  set_env_kv .env API_DOMAIN "$API_DOMAIN"
  set_env_kv .env TENANT_DOMAINS "$TENANT_DOMAINS"
  set_env_kv .env ADMIN_ORIGIN "https://${ADMIN_DOMAIN}"
  set_env_kv .env VITE_API_URL "https://${API_DOMAIN}"
  set_env_kv .env VITE_FRONTEND_URL "https://${TENANT_DOMAINS%% *}"
  # scripts/deploy.sh's own smoke_test() reads this — a real tenant domain
  # to fetch through Caddy before promoting, so a broken deploy never goes
  # live just because the api container's own /health happened to pass.
  # The first TENANT_DOMAINS entry is always a real one already collected
  # above, so this needs no separate prompt — unset before this fix meant
  # every fresh production install silently fell back to health-check-only.
  set_env_kv .env SMOKE_TEST_HOST "${TENANT_DOMAINS%% *}"
  # Default to 1 replica each, but never clobber a value from a previous
  # install/re-run — unlike the secrets above, this isn't meant to reset.
  grep -qE '^API_REPLICAS=.+' .env || set_env_kv .env API_REPLICAS "1"
  grep -qE '^FRONTEND_REPLICAS=.+' .env || set_env_kv .env FRONTEND_REPLICAS "1"
  grep -qE '^ADMIN_REPLICAS=.+' .env || set_env_kv .env ADMIN_REPLICAS "1"
  configure_optional_integrations .env
  install_backup_cron "docker"

  write_pgbouncer_userlist

  echo ""
  echo "-- ensuring base (db+pgbouncer+redis+proxy) is up --"
  docker compose up -d db pgbouncer redis proxy
  docker volume create ucms-uploads >/dev/null

  echo ""
  echo "-- first deploy (build+test+health-check+promote, see scripts/deploy.sh) --"
  if ! bash scripts/deploy.sh; then
    echo "" >&2
    echo "Aborting — the first deploy failed. Nothing was live before this run," >&2
    echo "so there's nothing to roll back; fix the error above and re-run" >&2
    echo "sudo ./install.sh --mode=production (safe to re-run)." >&2
    exit 1
  fi

  # Hand the repo dir back to whoever actually owns it — this whole function
  # ran as root, so .env/.deploy-color/etc were all just written as root,
  # which would otherwise block that same person's later non-sudo
  # `bash scripts/deploy.sh` runs (the normal way to redeploy) with a
  # confusing "Permission denied" on .deploy-color specifically.
  if [ -n "$ORIG_OWNER" ] && [ "$ORIG_OWNER" != "root:root" ]; then
    chown -R "$ORIG_OWNER" "$REPO_DIR"
  fi

  verify_production_reachability || echo "  (continuing anyway — deploy.sh's own health-check already gated success; see above for what's not reachable yet)" >&2

  create_superadmin_production

  local node_bin
  node_bin=$(ensure_private_node)
  install_monitor "$node_bin" "docker" "$monitor_port" "production"
  finish_backup_destination_setup "docker"

  if [ "$NEEDS_NGINX_SNIPPET" = "true" ]; then
    open_firewall_ports "$monitor_port"
  else
    open_firewall_ports "80" "443" "$monitor_port"
  fi

  echo ""
  echo "================================================================"
  echo " Done (production mode)."
  echo "   Admin panel:  https://${ADMIN_DOMAIN}"
  echo "   Public site:  https://${TENANT_DOMAINS%% *}"
  echo "   API:          https://${API_DOMAIN}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/ucms-monitor.env on this VPS)"
  if [ "$NEEDS_NGINX_SNIPPET" = "true" ]; then
    print_nginx_snippet
    echo ""
    echo " Note: the Caddyfile edit above (auto_https off) lives in a tracked repo"
    echo " file. A future 'git reset --hard origin/main' (Monitor's own 'Pull latest"
    echo " & rebuild', or scripts/deploy.sh's own pull step) will silently revert it"
    echo " next time the proxy container gets recreated. If Caddy starts trying (and"
    echo " failing) to auto-issue certs again after a future pull, re-run:"
    echo "   sudo ./install.sh --mode=production"
  fi
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
  echo " Future deploys: bash scripts/deploy.sh (zero-downtime) or the Monitor's"
  echo " own 'Pull latest & rebuild' button."
  echo "================================================================"
}

# ---------------------------------------------------------------------------
# Bare-metal mode
# ---------------------------------------------------------------------------
ensure_postgres() {
  # Reuses an already-running local Postgres cluster if one exists — never
  # installs a second one. This mirrors apps/api's own tenant model: one
  # Postgres server, one database per tenant (here: one database for this
  # app, alongside whatever else already lives on the same cluster).
  if command -v pg_isready >/dev/null 2>&1 && pg_isready -q -h 127.0.0.1 -p 5432 2>/dev/null; then
    echo "Reusing existing local PostgreSQL cluster on :5432."
    DB_MANAGED="false"
  else
    echo "No local PostgreSQL found — installing..."
    if [ "$PKG_MGR" = "apt" ]; then
      pkg_install postgresql
    else
      pkg_install postgresql-server
      # Debian's postgresql package auto-initializes its data directory on
      # install; RHEL-family's postgresql-server package doesn't — it needs
      # an explicit initdb before it can start at all. A no-op (exit 1, "|| true")
      # if this cluster was already initialized by an earlier run.
      postgresql-setup --initdb >/dev/null 2>&1 || true
    fi
    systemctl enable --now postgresql
    DB_MANAGED="true"
  fi
}

ensure_app_database() {
  # Idempotent: safe to re-run. Only rotates usim_cms_app's password the
  # first time this creates apps/api/.env's DATABASE_URL — an existing,
  # already-deployed password is never silently invalidated.
  local exists
  exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='usim_cms'" 2>/dev/null || true)
  if [ "$exists" != "1" ]; then
    echo "Creating usim_cms database..."
    sudo -u postgres psql -c "CREATE DATABASE usim_cms" >/dev/null
  fi
  sudo -u postgres psql -d usim_cms -f apps/api/scripts/setup-db-role.sql >/dev/null

  if ! grep -qE "^DATABASE_URL=.+" apps/api/.env 2>/dev/null; then
    local db_password
    db_password="$(openssl rand -hex 24)"
    sudo -u postgres psql -d usim_cms -c "ALTER ROLE usim_cms_app WITH PASSWORD '${db_password}'" >/dev/null
    set_env_kv apps/api/.env DATABASE_URL "postgres://usim_cms_app:${db_password}@127.0.0.1:5432/usim_cms"
    echo "Created usim_cms_app role with a fresh generated password."
  else
    echo "Reusing existing DATABASE_URL in apps/api/.env."
  fi
}

install_baremetal_mode() {
  local node_bin
  node_bin=$(ensure_private_node)
  echo "Using Node: $node_bin ($($node_bin --version))"

  ensure_postgres
  cp -n apps/api/.env.example apps/api/.env 2>/dev/null || true
  chmod 600 apps/api/.env
  ensure_app_database

  local api_port frontend_port admin_port monitor_port public_host
  api_port=$(find_free_port 3000)
  frontend_port=$(find_free_port 4321)
  admin_port=$(find_free_port 5173)
  monitor_port=$(find_free_port 5555)
  echo ""
  echo "Ports chosen (auto-picked next free one if the default was taken):"
  echo "  api      -> $api_port"
  echo "  frontend -> $frontend_port"
  echo "  admin    -> $admin_port"
  echo "  monitor  -> $monitor_port"

  public_host=$(detect_public_host)
  echo "Public host: $public_host"

  set_env_kv apps/api/.env PORT "$api_port"
  set_env_kv apps/api/.env STORAGE_DRIVER "local"
  # Docker/production/trial modes all get this for free (the api Dockerfile
  # bakes ENV NODE_ENV=production) — bare-metal's systemd unit just sources
  # apps/api/.env directly with nothing else setting it, so it must be
  # written here too. Without it, lib/cookies.ts only adds the `Secure`
  # cookie attribute in production — silently shipping sessions without it
  # even when this box is fronted by the operator's own TLS reverse proxy.
  set_env_kv apps/api/.env NODE_ENV "production"
  # Bare-metal mode has no docker-compose.yml wrapping it, so there's no
  # localhost fallback to fall back to — apps/api/.env is the only place
  # this gets set, and it must match wherever the admin panel actually gets
  # served from (this same public_host:admin_port), same reasoning as the
  # docker-mode .env above.
  set_env_kv apps/api/.env ADMIN_ORIGIN "http://${public_host}:${admin_port}"
  grep -q '^SESSION_SECRET=' apps/api/.env || echo "SESSION_SECRET=" >> apps/api/.env
  fill_env_if_blank apps/api/.env SESSION_SECRET
  configure_optional_integrations apps/api/.env
  install_backup_cron "baremetal"

  echo ""
  echo "Installing dependencies (pnpm via corepack, first run can take a while)..."
  # `corepack enable` writes a `pnpm` shim into node's own bin dir (it reads
  # this repo's package.json "packageManager" field and fetches that exact
  # pnpm version on first use) — you then call `pnpm` directly, same as any
  # other CLI; `corepack pnpm ...` is not itself a valid invocation.
  local node_dir="$(dirname "$node_bin")"
  export PATH="${node_dir}:${PATH}"
  # A host's bundled Node can ship a corepack release whose embedded npm
  # registry signing keys predate npm's own key rotation — any fresh fetch
  # then fails signature verification outright ("Cannot find matching
  # keyid"), which would otherwise hard-fail this entire install under
  # `set -euo pipefail` with no retry. Update corepack first (a plain npm
  # install, not subject to corepack's own check); if this script is being
  # re-run after an earlier interrupted attempt, also clear out whatever
  # partial download that attempt may have left behind, since corepack
  # skips re-downloading a version whose cache dir already exists even if
  # it's incomplete. If pnpm install still fails after that, fail hard with
  # a clear message rather than silently retrying with
  # COREPACK_INTEGRITY_KEYS=0 — a supply-chain verification step should
  # never auto-bypass itself on failure.
  npm install -g "corepack@${COREPACK_PIN_VERSION}" >/dev/null 2>&1 || echo "corepack self-update failed, continuing with bundled corepack"
  "${node_dir}/corepack" enable
  local pinned_pnpm corepack_cache
  pinned_pnpm="$(node -p "require('./package.json').packageManager" | sed 's/^pnpm@//')"
  corepack_cache="${COREPACK_HOME:-$HOME/.cache/node/corepack}"
  if [ -n "$corepack_cache" ] && [ -n "$pinned_pnpm" ]; then
    rm -rf "${corepack_cache}/v1/pnpm/${pinned_pnpm}" 2>/dev/null || true
  fi
  if ! pnpm install --frozen-lockfile; then
    echo "pnpm install failed — possible corepack signature verification failure even after updating corepack. Not auto-bypassing integrity checks: investigate (registry reachability, 'corepack enable' output above) before retrying, or re-run with COREPACK_INTEGRITY_KEYS=0 by hand once you've confirmed why verification failed." >&2
    exit 1
  fi

  echo "Building api..."
  pnpm --filter @ucms/api build

  echo "Building admin (VITE_API_URL=http://${public_host}:${api_port})..."
  VITE_API_URL="http://${public_host}:${api_port}" \
  VITE_FRONTEND_URL="http://${public_host}:${frontend_port}" \
  pnpm --filter @ucms/admin build

  echo "Building frontend (API_URL=http://127.0.0.1:${api_port})..."
  API_URL="http://127.0.0.1:${api_port}" pnpm --filter @ucms/frontend build

  # ---- systemd units for the 3 app processes ----
  cat > /etc/systemd/system/ucms-api.service <<EOF
[Unit]
Description=usim_cms API
After=network.target postgresql.service

[Service]
Type=simple
ExecStart=${node_bin} dist/index.js
WorkingDirectory=${REPO_DIR}/apps/api
EnvironmentFile=${REPO_DIR}/apps/api/.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/ucms-frontend.service <<EOF
[Unit]
Description=usim_cms frontend
After=network.target ucms-api.service

[Service]
Type=simple
ExecStart=${node_bin} server.mjs
WorkingDirectory=${REPO_DIR}/apps/frontend
Environment=PORT=${frontend_port}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/ucms-admin.service <<EOF
[Unit]
Description=usim_cms admin (static)
After=network.target

[Service]
Type=simple
ExecStart=${node_bin} ${REPO_DIR}/monitor/static-server.js ${REPO_DIR}/apps/admin/dist ${admin_port}
WorkingDirectory=${REPO_DIR}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now ucms-api ucms-frontend ucms-admin
  systemctl restart ucms-api ucms-frontend ucms-admin

  if ! ensure_reachable_or_selfheal "$api_port" "$admin_port" "$frontend_port" "bare-metal"; then
    echo "" >&2
    echo "Aborting — the services are running but not reachable, so it wouldn't" >&2
    echo "work in a browser either. See the diagnostic report above." >&2
    exit 1
  fi

  create_superadmin "$api_port"

  install_monitor "$node_bin" "systemd" "$monitor_port"
  finish_backup_destination_setup "baremetal"
  # Record whether we own Postgres (so the monitor only offers to restart it
  # when it's not something another app on this VPS also depends on) and the
  # values its "pull latest & rebuild" action needs to redo the build step —
  # docker mode doesn't need these, docker-compose already carries them.
  set_env_kv /etc/ucms-monitor.env DB_MANAGED "$DB_MANAGED"
  set_env_kv /etc/ucms-monitor.env NODE_BIN "$node_bin"
  set_env_kv /etc/ucms-monitor.env API_PORT "$api_port"
  set_env_kv /etc/ucms-monitor.env FRONTEND_PORT "$frontend_port"
  set_env_kv /etc/ucms-monitor.env ADMIN_PORT "$admin_port"
  set_env_kv /etc/ucms-monitor.env PUBLIC_HOST "$public_host"
  systemctl restart ucms-monitor
  open_firewall_ports "$api_port" "$frontend_port" "$admin_port" "$monitor_port"

  echo ""
  echo "================================================================"
  echo " Done (bare-metal mode)."
  echo "   Admin panel:  http://${public_host}:${admin_port}"
  echo "   Public site:  http://${public_host}:${frontend_port}"
  echo "   API:          http://${public_host}:${api_port}"
  echo "   Ops monitor:  http://${public_host}:${monitor_port}"
  echo "     user: admin"
  echo "     pass: ${MONITOR_PASSWORD}"
  echo "     (also saved in /etc/ucms-monitor.env on this VPS)"
  echo "   PostgreSQL:   $([ "$DB_MANAGED" = "true" ] && echo "installed by this script" || echo "reusing your existing cluster")"
  echo ""
  echo " First time here? Open the admin panel URL above — with zero users"
  echo " in the database it shows a setup wizard automatically."
  echo "================================================================"
}

# Reads the 3 published ports back out of wherever install_*_mode already
# wrote them, for the two "re-run against an already-installed stack" modes
# below — never re-picks a free one, since the stack is expected to already
# be up on the ports it was actually installed with.
resolve_running_ports() {
  if [ "$MODE" = "docker" ]; then
    API_PORT_VAL="$(grep '^API_PORT=' .env 2>/dev/null | cut -d= -f2-)"
    ADMIN_PORT_VAL="$(grep '^ADMIN_PORT=' .env 2>/dev/null | cut -d= -f2-)"
    FRONTEND_PORT_VAL="$(grep '^FRONTEND_PORT=' .env 2>/dev/null | cut -d= -f2-)"
  else
    API_PORT_VAL="$(grep '^PORT=' apps/api/.env 2>/dev/null | cut -d= -f2-)"
    ADMIN_PORT_VAL="$(grep '^ADMIN_PORT=' /etc/ucms-monitor.env 2>/dev/null | cut -d= -f2-)"
    FRONTEND_PORT_VAL="$(grep '^FRONTEND_PORT=' /etc/ucms-monitor.env 2>/dev/null | cut -d= -f2-)"
  fi
  if [ -z "$API_PORT_VAL" ]; then
    echo "Could not find an existing API port for mode=$MODE — is the stack installed?" >&2
    exit 1
  fi
}

# Production mode has no fixed API/admin/frontend ports to resolve (nothing
# is host-published — see docker-compose.release.yml) — re-derives what it
# needs straight from .env instead of resolve_running_ports's port-file
# lookups, which only apply to the trial/bare-metal port-publishing modes.
resolve_production_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.localhost}"
  API_DOMAIN="${API_DOMAIN:-api.localhost}"
  TENANT_DOMAINS="${TENANT_DOMAINS:-tenant.localhost}"
  CADDY_HTTP_PORT="80"
  [ -n "${PROXY_BIND_HTTP:-}" ] && CADDY_HTTP_PORT="$(echo "$PROXY_BIND_HTTP" | cut -d: -f2)"
}

if [ "$DIAGNOSE_ONLY" = "true" ]; then
  if [ "$MODE" = "production" ]; then
    resolve_production_env
    if verify_production_reachability; then
      echo ""
      echo "Everything's reachable from outside — no problem found."
      exit 0
    fi
    exit 1
  fi
  resolve_running_ports
  if verify_external_reachability "$API_PORT_VAL" "$ADMIN_PORT_VAL" "$FRONTEND_PORT_VAL"; then
    echo ""
    echo "Everything's reachable from outside — no problem found."
    exit 0
  fi
  diagnose_reachability "$API_PORT_VAL"
  exit 1
fi

if [ "$REAPPLY_BACKUP_CRON" = "true" ]; then
  detect_os_family
  reapply_backup_cron "$MODE"
  exit 0
fi

if [ "$ADMIN_ONLY" = "true" ]; then
  if [ "$MODE" = "production" ]; then
    resolve_production_env
    create_superadmin_production
    exit 0
  fi
  resolve_running_ports
  echo "Waiting for the API to become healthy..."
  wait_for_api_health "$API_PORT_VAL" 30 || true
  create_superadmin "$API_PORT_VAL"
  exit 0
fi

detect_os_family
if [ "$MODE" = "docker" ]; then
  install_docker_mode
elif [ "$MODE" = "production" ]; then
  install_production_mode
else
  install_baremetal_mode
fi
