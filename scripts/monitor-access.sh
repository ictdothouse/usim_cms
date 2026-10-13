#!/usr/bin/env bash
# Switch the host-level ops monitor between HTTPS access and SSH-only access
# without rebuilding the app tier or disturbing the current blue/green color.
set -euo pipefail

cd "$(dirname "$0")/.."
mode="${1:-}"
if [ "$mode" != "public" ] && [ "$mode" != "ssh" ] && [ "$mode" != "cloud" ]; then
  echo "Usage: sudo bash scripts/monitor-access.sh public <domain> | cloud <domain> | ssh" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo): changing the monitor service requires systemctl." >&2
  exit 1
fi
if [ ! -f .env ] || [ ! -f /etc/ucms-monitor.env ]; then
  echo "Install the production stack and monitor first." >&2
  exit 1
fi
env_owner="$(stat -c '%u:%g' .env)"
env_mode="$(stat -c '%a' .env)"

read_env() { grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- || true; }
write_env() {
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env
    rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
  chown "$env_owner" .env
  chmod "$env_mode" .env
}

previous_domain="$(read_env MONITOR_PUBLIC_DOMAIN .env)"
domain="${2:-$previous_domain}"
domain="${domain,,}"
if [ "$mode" = "ssh" ]; then domain=""; fi
if [ "$mode" != "ssh" ]; then
  if ! [[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] ||
     [ "${#domain}" -gt 253 ] || [ "${domain#*.}" = "$domain" ] ||
     [[ "$domain" == *..* ]] || [[ "$domain" == *.localhost ]]; then
    echo "Provide a valid public DNS name, e.g. monitor.43-163-113-24.sslip.io." >&2
    exit 2
  fi
  IFS='.' read -r -a labels <<< "$domain"
  for label in "${labels[@]}"; do
    if [ "${#label}" -gt 63 ] || ! [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
      echo "Monitor domain has an invalid DNS label." >&2
      exit 2
    fi
  done
  read -r -a tenant_domains <<< "$(read_env TENANT_DOMAINS .env)"
  for reserved in "$(read_env ADMIN_DOMAIN .env)" "$(read_env API_DOMAIN .env)" "${tenant_domains[@]}"; do
    if [ "$domain" = "$reserved" ]; then
      echo "Monitor domain must be separate from admin, API and tenant domains." >&2
      exit 2
    fi
  done
  password="$(read_env MONITOR_PASSWORD /etc/ucms-monitor.env)"
  if [ "${#password}" -lt 24 ]; then
    echo "Public access requires a monitor password of at least 24 characters in /etc/ucms-monitor.env." >&2
    exit 1
  fi
fi
if [ "$mode" = "public" ]; then
  proxy_http="$(read_env PROXY_BIND_HTTP .env)"
  proxy_https="$(read_env PROXY_BIND_HTTPS .env)"
  if [[ "$proxy_http" == 127.0.0.1:* ]] || [[ "$proxy_https" == 127.0.0.1:* ]]; then
    echo "Public mode needs Caddy to own public TLS on 80/443. Use cloud mode with an identity-protected edge instead." >&2
    exit 1
  fi
fi

host="$(read_env MONITOR_HOST /etc/ucms-monitor.env)"
port="$(read_env MONITOR_PORT /etc/ucms-monitor.env)"
# Installations created before MONITOR_HOST was introduced only have
# MONITOR_PORT. Migrate that one setting here so enabling HTTPS does not
# require rerunning the full production installer (and its deploy prompts).
if [ -z "$host" ]; then
  gateway="$(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' bridge 2>/dev/null || true)"
  if ! [[ "$gateway" =~ ^(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3})$ ]]; then
    echo "Could not determine a private Docker bridge gateway for MONITOR_HOST." >&2
    exit 1
  fi
  if grep -q '^MONITOR_HOST=' /etc/ucms-monitor.env; then
    sed -i "s|^MONITOR_HOST=.*|MONITOR_HOST=$gateway|" /etc/ucms-monitor.env
  else
    printf 'MONITOR_HOST=%s\n' "$gateway" >> /etc/ucms-monitor.env
  fi
  chmod 600 /etc/ucms-monitor.env
  host="$gateway"
  echo "Migrated legacy monitor listener to Docker bridge $host."
fi
if ! [[ "$host" =~ ^(127\.0\.0\.1|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3})$ ]]; then
  echo "MONITOR_HOST must be a private IPv4 address or 127.0.0.1." >&2
  exit 1
fi
if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "Invalid MONITOR_PORT in /etc/ucms-monitor.env." >&2
  exit 1
fi
if [ "$mode" != "ssh" ] && ! [[ "$host" =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.) ]]; then
  echo "Public HTTPS mode needs the monitor bound to Docker's private bridge gateway; rerun the production installer." >&2
  exit 1
fi
upstream="${host}:${port}"
mkdir -p monitor/access
chmod 755 monitor/access
umask 077
temp_file="$(mktemp monitor/access/.config.XXXXXX)"
trap 'rm -f "$temp_file"' EXIT
printf '{"mode":"%s","domain":"%s","upstream":"%s"}\n' "$mode" "$domain" "$upstream" > "$temp_file"
chmod 644 "$temp_file" # nonsecret; the unprivileged API container must read it
mv -f "$temp_file" monitor/access/config.json

# The monitor reads the config file at startup. In SSH mode this immediately
# rejects requests for the former public hostname, even if Caddy is down and
# the route removal cannot yet be applied.
main_pid="$(systemctl show ucms-monitor -p MainPID --value 2>/dev/null || true)"
if [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] && [ -r "/proc/${main_pid}/cmdline" ] && \
   tr '\0' ' ' < "/proc/${main_pid}/cmdline" | grep -q 'monitor/supervisor.js'; then
  systemctl reload ucms-monitor
else
  systemctl restart ucms-monitor
fi
systemctl is-active --quiet ucms-monitor
if [ "$mode" = "public" ]; then
  temp_route="$(mktemp monitor/access/.route.XXXXXX)"
  printf 'https://%s {\n\theader Strict-Transport-Security "max-age=31536000"\n\treverse_proxy %s\n}\n' \
    "$domain" "$upstream" > "$temp_route"
  chmod 644 "$temp_route"
  mv -f "$temp_route" monitor/access/route.caddy
else
  rm -f monitor/access/route.caddy
fi
write_env MONITOR_ACCESS_MODE "$mode"
write_env MONITOR_PUBLIC_DOMAIN "$domain"
write_env MONITOR_UPSTREAM "$upstream"

container=""
if [ -f .deploy-color ]; then
  color="$(tr -d '\r\n' < .deploy-color)"
  if [ "$color" = "blue" ] || [ "$color" = "green" ]; then
    container="$(docker compose -p "ucms-${color}" -f docker-compose.release.yml ps -q api)"
  fi
fi
if [ -z "$container" ]; then
  echo "Monitor mode saved. No live production API container found; the HTTPS route will sync on the next deploy." >&2
  exit 0
fi
docker exec -i -e "MONITOR_ACCESS_MODE=$mode" -e "MONITOR_PUBLIC_DOMAIN=$domain" \
  -e "MONITOR_PREVIOUS_DOMAIN=$previous_domain" -e "MONITOR_UPSTREAM=$upstream" \
  "$container" node --input-type=module < scripts/monitor-access-caddy.mjs
if ! docker exec "$container" sh -c '[ -n "${MONITOR_ACCESS_CONFIG:-}" ]' >/dev/null 2>&1; then
  echo "Current API container predates persistent monitor routing. The route works now, but a later Caddy resync/restart can remove it until the next successful app deploy; rerun this command if needed." >&2
fi
if [ "$mode" = "public" ]; then
  echo "Open https://${domain}/ and sign in with a monitor administrator account. The initial account uses the credentials in /etc/ucms-monitor.env; later password changes are managed in Accounts."
elif [ "$mode" = "cloud" ]; then
  echo "Caddy public route removed. Configure your identity-protected cloud tunnel for https://${domain}/ -> http://${host}:${port}/."
else
  echo "Public route removed. Use: ssh -L ${port}:${host}:${port} user@server"
  echo "Then open http://localhost:${port}/."
fi
