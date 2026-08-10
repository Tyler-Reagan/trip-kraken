#!/usr/bin/env bash
# Builds the two OSRM MLD graphs PR 2 ships (ADR-0024 §1, amended 2026-08-09 to drop `bicycle` —
# see the ADR for why): one Kanto extract, extracted/partitioned/customized once per profile,
# using each profile exactly as it ships in the image. Nothing is vendored or patched.
#
# Dev-time only: never shipped, never run at request time. Requires Docker. Regenerating
# db/osrm/ is a manual, re-runnable operation, same convention as ingest-transit-graph.sh.
#
# Usage: scripts/build-osrm-graphs.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=./osm-snapshot.env
source "$SCRIPT_DIR/osm-snapshot.env"

# Keep in sync with docker-compose.yml's `x-osrm` anchor — both must build/serve the same
# revision, or the graph a profile was built against may not match the binary reading it.
# GHCR, not Docker Hub: osrm/osrm-backend on Hub stopped at v5.25.0 in 2021. The `-debian`
# suffix matters on arm64 hosts — the bare numeric tag is amd64-only and would silently build
# under emulation.
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:26.4.1-debian"

ROAD_URL="${GEOFABRIK_BASE}/${OSM_ROAD_REGION}-${OSM_SNAPSHOT}.osm.pbf"
WORK_DIR="$REPO_ROOT/db/osrm"
RAW_PBF="$WORK_DIR/road-${OSM_SNAPSHOT}.osm.pbf"

mkdir -p "$WORK_DIR"

if [ -f "$RAW_PBF" ]; then
  echo "Using cached extract: $RAW_PBF"
else
  echo "Downloading pinned extract: $ROAD_URL"
  curl -fL -o "$RAW_PBF" "$ROAD_URL"
fi

for PROFILE in foot car; do
  PROFILE_DIR="$WORK_DIR/$PROFILE"
  mkdir -p "$PROFILE_DIR"

  # OSRM names its output after its input, so every profile gets the same input filename —
  # otherwise the served path would embed the region/snapshot and force a docker-compose.yml
  # edit every time OSM_SNAPSHOT moves.
  cp "$RAW_PBF" "$PROFILE_DIR/road.osm.pbf"

  if [ -f "$PROFILE_DIR/road.osrm.partition" ]; then
    echo "[$PROFILE] already built — skipping (delete $PROFILE_DIR to force a rebuild)"
    continue
  fi

  echo "[$PROFILE] osrm-extract (profile: /opt/$PROFILE.lua, stock — unmodified)"
  docker run --rm -v "$PROFILE_DIR:/data" "$OSRM_IMAGE" \
    osrm-extract -p "/opt/$PROFILE.lua" /data/road.osm.pbf

  echo "[$PROFILE] osrm-partition (MLD — osrm-contract is CH and is wrong here)"
  docker run --rm -v "$PROFILE_DIR:/data" "$OSRM_IMAGE" \
    osrm-partition /data/road.osrm

  echo "[$PROFILE] osrm-customize"
  docker run --rm -v "$PROFILE_DIR:/data" "$OSRM_IMAGE" \
    osrm-customize /data/road.osrm

  echo "[$PROFILE] done: $PROFILE_DIR/road.osrm.*"
done

echo "Both graphs built. Bring the stack up with: docker compose up -d"
