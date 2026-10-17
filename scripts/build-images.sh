#!/usr/bin/env bash
# Builds the api/frontend/admin images once, tagged with the git commit, and
# with --push publishes them to any OCI registry (GHCR, GitLab, Docker Hub,
# Harbor, ECR, ...). CI-neutral on purpose: GitHub Actions, GitLab CI,
# Jenkins or a plain build server all just run this after `docker login`.
# Each Dockerfile runs its app's tests, so a pushed image has passed them.
# scripts/deploy.sh runs it too, to build on the server itself when no
# registry is configured.
#
#   UCMS_IMAGE_REPO=ghcr.io/acme/ucms bash scripts/build-images.sh --push
#
# Tags: <repo>/{api,frontend,admin}:<commit>, plus :latest, which the next
# build reads its cache from (inline cache), so even a CI runner with no
# local cache reuses an unchanged dependency layer instead of re-uploading it.
# A release build (UCMS_IMAGE_VERSION=v1.2.3, set by the CI wrappers on a tag
# push) is also tagged with its version: organisations' servers pull that,
# and registry retention can keep v* tags while pruning per-commit ones.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${UCMS_IMAGE_REPO:?set UCMS_IMAGE_REPO, e.g. ghcr.io/acme/ucms}"
TAG="${UCMS_IMAGE_TAG:-$(git rev-parse HEAD)}"
VERSION="${UCMS_IMAGE_VERSION:-}"
BUILD_CACHE_MAX="${BUILD_CACHE_MAX:-5GB}"
if [ -n "$VERSION" ] && ! [[ "$VERSION" =~ ^v[0-9][0-9A-Za-z._-]{0,126}$ ]]; then
  echo "UCMS_IMAGE_VERSION '$VERSION' is not a release tag like v1.2.3" >&2
  exit 1
fi

# Build cache is capped by size, on whatever machine builds (a server, a
# self-hosted runner): a size-limited prune drops the least recently used
# layers first, so the base image and `pnpm install` layers every build
# reuses stay warm. The old `until=24h` filter kept every layer from a busy
# deploy day (14GB on the demo VPS, 2026-10-17). Docker 28+ takes
# --max-used-space; there --keep-storage is only a deprecated alias (of
# --reserved-space, which still caps on its own), so it's the fallback for
# older engines. Runs on every exit, failed builds included.
prune_build_cache() {
  local flag=--keep-storage
  [[ "$(docker builder prune --help 2>&1)" == *--max-used-space* ]] && flag=--max-used-space
  echo "-- trimming build cache to $BUILD_CACHE_MAX --"
  docker builder prune -af "$flag" "$BUILD_CACHE_MAX" >/dev/null || true
}
trap prune_build_cache EXIT

# ponytail: native architecture only; add `docker buildx build --platform`
# if an organisation's servers differ from its build machine (e.g. arm64).
tags=("$TAG" latest ${VERSION:+"$VERSION"})
for svc in api frontend admin; do
  args=()
  for t in "${tags[@]}"; do args+=(-t "$REPO/$svc:$t"); done
  echo "-- building $REPO/$svc (tags: ${tags[*]}) --"
  docker build -f "apps/$svc/Dockerfile" \
    --build-arg BUILDKIT_INLINE_CACHE=1 --cache-from "$REPO/$svc:latest" "${args[@]}" .
done

if [ "${1:-}" = "--push" ]; then
  for svc in api frontend admin; do
    for t in "${tags[@]}"; do docker push "$REPO/$svc:$t"; done
  done
fi
