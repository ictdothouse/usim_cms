#!/usr/bin/env bash
# One-time migration from the legacy single-process monitor unit. Subsequent
# updates use systemctl reload and keep the old worker serving until ready.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo; the systemd unit is root-owned." >&2
  exit 1
fi
cd "$(dirname "$0")/.."
repo_dir="$(pwd)"
unit=/etc/systemd/system/ucms-monitor.service
backup=/etc/systemd/system/ucms-monitor.service.pre-rolling
env_file=/etc/ucms-monitor.env
if [ ! -f "$unit" ] || [ ! -f "$env_file" ]; then
  echo "Existing monitor service and /etc/ucms-monitor.env are required." >&2
  exit 1
fi
node_bin="$(sed -n 's/^NODE_BIN=//p' "$env_file" | head -1)"
[ -n "$node_bin" ] || node_bin="$(command -v node)"
if [ ! -x "$node_bin" ]; then
  echo "Node executable is missing: $node_bin" >&2
  exit 1
fi
"$node_bin" --check "$repo_dir/monitor/server.js"
"$node_bin" --check "$repo_dir/monitor/supervisor.js"
"$node_bin" --check "$repo_dir/monitor/security.js"
changed_unit=false
if ! grep -q 'monitor/supervisor.js' "$unit"; then
  cp -p "$unit" "$backup"
  sed -e "s|__NODE_BIN__|${node_bin}|g" -e "s|__REPO_DIR__|${repo_dir}|g" \
    monitor/ucms-monitor.service.template > "$unit"
  systemctl daemon-reload
  changed_unit=true
fi
main_pid="$(systemctl show ucms-monitor -p MainPID --value 2>/dev/null || true)"
running_command=""
if [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] && [ -r "/proc/${main_pid}/cmdline" ]; then
  running_command="$(tr '\0' ' ' < "/proc/${main_pid}/cmdline")"
fi
if [[ "$running_command" != *monitor/supervisor.js* ]]; then
  # This one-time adoption replaces the legacy listener and can briefly
  # interrupt monitor requests. Later code releases use rolling reload.
  if ! systemctl restart ucms-monitor; then
    if [ "$changed_unit" = true ]; then
      cp -p "$backup" "$unit"
      systemctl daemon-reload
      systemctl restart ucms-monitor || true
    fi
    echo "Rolling monitor service failed to start; inspect journalctl -u ucms-monitor." >&2
    exit 1
  fi
fi
host="$(sed -n 's/^MONITOR_HOST=//p' "$env_file" | head -1)"
port="$(sed -n 's/^MONITOR_PORT=//p' "$env_file" | head -1)"
host="${host:-127.0.0.1}"
port="${port:-5555}"
for attempt in $(seq 1 30); do
  code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 \
    --header 'Host: 127.0.0.1' "http://${host}:${port}/" || true)"
  if [ "$code" = 401 ]; then
    echo "Rolling monitor is ready on ${host}:${port}. Future deploys can reload it without replacing the listener."
    exit 0
  fi
  sleep 1
done
if [ "$changed_unit" = true ]; then
  cp -p "$backup" "$unit"
  systemctl daemon-reload
  systemctl restart ucms-monitor || true
  echo "Rolling monitor probe failed; previous service unit restored." >&2
fi
echo "Monitor did not answer its private health probe; inspect journalctl -u ucms-monitor." >&2
exit 1
