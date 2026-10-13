#!/usr/bin/env bash
# Adds the provisioner secret to existing .env files before Compose evaluates
# the new required database-role settings. Safe to run on every deployment.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env; copy .env.example and configure the deployment first." >&2
  exit 1
fi

if ! grep -qE '^POSTGRES_PROVISIONER_PASSWORD=.+' .env; then
  password="$(openssl rand -hex 24)"
  if grep -qE '^POSTGRES_PROVISIONER_PASSWORD=' .env; then
    sed -i.bak "s|^POSTGRES_PROVISIONER_PASSWORD=.*|POSTGRES_PROVISIONER_PASSWORD=${password}|" .env
    rm -f .env.bak
  else
    printf '\nPOSTGRES_PROVISIONER_PASSWORD=%s\n' "$password" >> .env
  fi
  chmod 600 .env
  echo "Generated POSTGRES_PROVISIONER_PASSWORD for the dedicated tenant provisioner role."
fi
