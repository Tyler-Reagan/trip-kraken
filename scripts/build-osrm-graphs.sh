#!/usr/bin/env bash
# Builds the two OSRM MLD graphs (ADR-0024 §1, amended 2026-08-09 to drop `bicycle`; Extract
# widened 2026-08-10 to Kanto+Kansai+Chubu — see the ADR for why on both). Each profile is
# extracted/partitioned/customized from one merged Extract, using each profile exactly as it
# ships in the image. Nothing is vendored or patched.
#
# Dev-time only: never shipped, never run at request time. Requires Docker and `osmium` on PATH
# (`brew install osmium-tool` / `apt install osmium-tool`) — same prerequisite as
# ingest-transit-graph.sh, which already uses host osmium rather than a pinned container; this
# script follows that precedent instead of introducing a second pinning mechanism for the same
# tool. Regenerating db/osrm/ is a manual, re-runnable operation.
#
# The merged Extract is roughly 1.2 GB (Kanto 431 MB + Kansai 321 MB + Chubu 448 MB) — larger
# than the ~460 MB single-region input this script used to build from. Docker Desktop's default
# memory allocation (7.75 GB measured on a 16 GB host, in this repo — self-imposed, not a
# hardware ceiling) should be raised to at least 12 GB before running this for the first time
# against the merged input; see README.md.
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

WORK_DIR="$REPO_ROOT/db/osrm"
MERGED_PBF="$WORK_DIR/road-${OSM_SNAPSHOT}.osm.pbf"

mkdir -p "$WORK_DIR"

if [ -f "$MERGED_PBF" ]; then
  echo "Using cached merged Extract: $MERGED_PBF"
else
  REGION_PBFS=()
  for REGION in $OSM_ROAD_REGIONS; do
    REGION_FILE="$WORK_DIR/$(basename "$REGION")-${OSM_SNAPSHOT}.osm.pbf"
    if [ ! -f "$REGION_FILE" ]; then
      REGION_URL="${GEOFABRIK_BASE}/${REGION}-${OSM_SNAPSHOT}.osm.pbf"
      echo "Downloading pinned extract: $REGION_URL"
      curl -fL -o "$REGION_FILE" "$REGION_URL"
    else
      echo "Using cached region download: $REGION_FILE"
    fi
    REGION_PBFS+=("$REGION_FILE")
  done

  if [ "${#REGION_PBFS[@]}" -eq 1 ]; then
    mv "${REGION_PBFS[0]}" "$MERGED_PBF"
  else
    # OSRM has no merge of its own — regions must combine before osrm-extract, not after; there
    # is no way to build N region graphs and combine the compiled output.
    echo "Merging ${#REGION_PBFS[@]} regions into one Extract: $MERGED_PBF"
    osmium merge "${REGION_PBFS[@]}" -o "$MERGED_PBF"
    rm -f "${REGION_PBFS[@]}"
  fi
fi

for PROFILE in foot car; do
  PROFILE_DIR="$WORK_DIR/$PROFILE"
  mkdir -p "$PROFILE_DIR"

  if [ -f "$PROFILE_DIR/road.osrm.partition" ]; then
    echo "[$PROFILE] already built — skipping (delete $PROFILE_DIR to force a rebuild)"
    continue
  fi

  # OSRM names its output after its input, so every profile gets the same input filename —
  # otherwise the served path would embed the region/snapshot and force a docker-compose.yml
  # edit every time OSM_SNAPSHOT moves.
  cp "$MERGED_PBF" "$PROFILE_DIR/road.osm.pbf"

  echo "[$PROFILE] osrm-extract (profile: /opt/$PROFILE.lua, stock — unmodified)"
  docker run --rm -v "$PROFILE_DIR:/data" "$OSRM_IMAGE" \
    osrm-extract -p "/opt/$PROFILE.lua" /data/road.osm.pbf

  echo "[$PROFILE] osrm-partition (MLD — osrm-contract is CH and is wrong here)"
  docker run --rm -v "$PROFILE_DIR:/data" "$OSRM_IMAGE" \
    osrm-partition /data/road.osrm

  echo "[$PROFILE] osrm-customize"
  docker run --rm -v "$PROFILE_DIR:/data" "$OSRM_IMAGE" \
    osrm-customize /data/road.osrm

  # Build-only files, verified this session (moved aside, container restarted, /table and
  # /route?steps=true re-queried, byte-identical output both times): the edge-based graph and its
  # build-stage companions, and the per-profile copy of the input. osrm-routed memory-maps only
  # what serving actually reads.
  #
  # Caveat: osrm-customize can normally be re-run alone (to fold in new weights) without
  # repeating osrm-extract, but that path needs road.osrm.ebg. Deleting it here means any future
  # re-customize needs a full rebuild from road.osm.pbf. Costless today — no traffic feed, stock
  # profiles, we never re-customize — but worth knowing before reaching for osrm-customize alone.
  echo "[$PROFILE] pruning build-only files (~1.2 GB)"
  rm -f "$PROFILE_DIR/road.osm.pbf" "$PROFILE_DIR/road.osrm.ebg" "$PROFILE_DIR/road.osrm.enw" \
        "$PROFILE_DIR/road.osrm.cnbg" "$PROFILE_DIR/road.osrm.cnbg_to_ebg"

  echo "[$PROFILE] done: $PROFILE_DIR/road.osrm.*"
done

echo "Both graphs built. Bring the stack up with: docker compose up -d"
