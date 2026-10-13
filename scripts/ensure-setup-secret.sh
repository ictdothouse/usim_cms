#!/usr/bin/env bash
# Backfills the production-only first-admin bootstrap credential before
# docker-compose.release.yml validates its required environment variable.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env; copy .env.example and configure the deployment first." >&2
  exit 1
fi

setup_secret="$(LC_ALL=C sed -n 's/^SETUP_SECRET=//p' .env | head -n 1)"
if [ "${#setup_secret}" -lt 32 ]; then
  setup_secret="$(openssl rand -hex 32)"
  if grep -qE '^SETUP_SECRET=' .env; then
    sed -i.bak "s|^SETUP_SECRET=.*|SETUP_SECRET=${setup_secret}|" .env
    rm -f .env.bak
  else
    printf '\nSETUP_SECRET=%s\n' "$setup_secret" >> .env
  fi
  chmod 600 .env
  echo "Generated SETUP_SECRET for the installer-only first-admin route."
fi

# This file contains credentials even when SETUP_SECRET was already present.
chmod 600 .env
