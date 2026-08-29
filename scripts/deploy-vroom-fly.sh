#!/usr/bin/env bash
# ADR-0037: deploy VROOM to Fly.io. Fly's compose-import support for a service whose
# build.context is a remote git URL (docker-compose.yml's vroom service) is unconfirmed, so this
# sidesteps the question: clone the pinned tag locally, then deploy from that clone, exactly the
# fallback ADR-0037 names. Safe to re-run — it re-clones into a fresh temp dir each time and
# `fly deploy` is itself idempotent.
set -euo pipefail

VROOM_RELEASE="v1.15.0" # kept in sync with docker-compose.yml's vroom service
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Cloning VROOM-Project/vroom-docker@${VROOM_RELEASE} into ${TMP_DIR}..."
git clone --branch "$VROOM_RELEASE" --depth 1 https://github.com/VROOM-Project/vroom-docker.git "$TMP_DIR"

cp "$REPO_ROOT/deploy/fly/vroom.toml" "$TMP_DIR/fly.toml"

echo "Deploying from the pinned clone..."
(cd "$TMP_DIR" && fly deploy --config fly.toml)
