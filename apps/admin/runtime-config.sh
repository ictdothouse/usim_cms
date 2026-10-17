#!/bin/sh
# Runs from nginx's /docker-entrypoint.d before nginx starts. Writes the
# admin SPA's runtime config and the CSP that allows its API origin from the
# container's env, so one image serves any organisation's domains. The
# VITE_* names are kept so existing .env files work unchanged (they used to
# be build args). Output goes to /tmp, the container's writable tmpfs.
set -eu

api="${VITE_API_URL:-http://localhost:3000}"
frontend="${VITE_FRONTEND_URL:-http://localhost:4321}"

# Both values land verbatim in JavaScript and in an nginx directive, so only
# URL characters are accepted (no quotes, spaces, newlines, '&' or '|').
for url in "$api" "$frontend"; do
  case "$url" in
    *[!A-Za-z0-9.:/-]*) ;;
    http://?* | https://?*) continue ;;
  esac
  echo "runtime-config: invalid URL '$url' (expected http(s)://host[:port])" >&2
  exit 1
done
api="${api%/}"
frontend="${frontend%/}"

mkdir -p /tmp/ucms
printf 'window.__UCMS_CONFIG__ = {"apiUrl":"%s","frontendUrl":"%s"};\n' "$api" "$frontend" >/tmp/ucms/config.js
sed "s|__UCMS_API_ORIGIN__|$api|" /etc/nginx/ucms-security-headers.conf >/tmp/ucms/security-headers.conf
