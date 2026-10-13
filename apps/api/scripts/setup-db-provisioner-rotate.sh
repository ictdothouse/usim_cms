#!/bin/bash
# Runs after setup-db-role.sql during first database initialization. Existing
# installations rotate this role from install.sh when it applies DB roles.
set -euo pipefail

: "${POSTGRES_PROVISIONER_PASSWORD:?POSTGRES_PROVISIONER_PASSWORD must be set (see .env.example)}"

psql -v ON_ERROR_STOP=1 \
  -v provisioner_password="$POSTGRES_PROVISIONER_PASSWORD" \
  --username postgres --dbname "$POSTGRES_DB" <<-'EOSQL'
  SET password_encryption = 'scram-sha-256';
  ALTER ROLE usim_cms_provisioner WITH PASSWORD :'provisioner_password';
EOSQL
