#!/usr/bin/env bash
# Root-console recovery for forgotten monitor passwords.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/monitor-users.sh reset <username>" >&2
  exit 1
fi
cd "$(dirname "$0")/.."
if [ -x /opt/ucms/node/bin/node ]; then
  node_bin=/opt/ucms/node/bin/node
else
  node_bin="$(command -v node)"
fi
exec "$node_bin" monitor/manage-users.js "$@"
