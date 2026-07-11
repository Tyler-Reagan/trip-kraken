#!/usr/bin/env bash
# Full ingestion pipeline (ADR-0019, issue #87/J2): a pinned Geofabrik Japan .osm.pbf extract,
# filtered to rail-only by osmium, converted to OSM XML, and handed to the Node transform.
#
# Dev-time only: never shipped, never run at request time. Requires `osmium` on PATH
# (`brew install osmium-tool` / `apt install osmium-tool`) and network access for the download.
# Regenerating db/transit-japan.db is expected to be an occasional, manual, re-runnable operation
# — not part of any build or request path.
#
# Usage: scripts/ingest-transit-graph.sh [outputDbPath]

set -euo pipefail

# Pinned, dated snapshot — reproducibility (ADR-0019). Bump this URL deliberately when
# refreshing the graph; never point at a rolling "-latest" URL from automation.
GEOFABRIK_URL="https://download.geofabrik.de/asia/japan-260101.osm.pbf"

OUTPUT_DB="${1:-db/transit-japan.db}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

RAW_PBF="$WORK_DIR/japan.osm.pbf"
RAIL_PBF="$WORK_DIR/japan-rail.osm.pbf"
RAIL_XML="$WORK_DIR/japan-rail.osm"

echo "Downloading pinned extract: $GEOFABRIK_URL"
curl -fL -o "$RAW_PBF" "$GEOFABRIK_URL"

echo "Filtering to rail-only (heavy/commuter rail, subway, light rail, monorail; buses excluded)"
osmium tags-filter "$RAW_PBF" \
  r/route=train,subway,light_rail,monorail \
  r/public_transport=stop_area,stop_area_group \
  -o "$RAIL_PBF"

echo "Converting filtered extract to OSM XML"
osmium cat "$RAIL_PBF" -f osm -o "$RAIL_XML"

echo "Building the graph and writing $OUTPUT_DB"
npx tsx scripts/ingest-transit-graph.ts "$RAIL_XML" "$OUTPUT_DB"
