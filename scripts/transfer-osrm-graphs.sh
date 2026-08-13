#!/usr/bin/env bash
# Packages or unpacks db/osrm/{foot,car} for moving a built road graph between machines — the
# lever ADR-0024's 2026-08-10 amendment names for building the merged Extract where memory
# already fits rather than raising this machine's Docker Desktop allocation: build on a box with
# headroom, then move only the built artifact. build-osrm-graphs.sh already prunes its five
# build-only files per profile before this runs, so what gets packaged is the ~15 GB serving set,
# not the larger in-progress build peak.
#
# zstd compression is for movement/archive only, never for serving — osrm-routed needs these
# files as plain uncompressed data on disk, whether it's reading them via --mmap or copying them
# into process memory (the default; see docker-compose.yml), and a compressed file is neither
# mappable nor directly readable. Measured this session on the largest served file
# (cell_metrics): ~2.3x, so ~15 GB unpacked becomes roughly 6-7 GB in transit.
#
# Usage:
#   On the build machine, after `pnpm build:osrm-graphs`:
#     scripts/transfer-osrm-graphs.sh pack [output.tar.zst]
#   Copy the resulting archive to the target machine (scp, rsync, a shared bucket — this script
#   doesn't care how), then on the target machine:
#     scripts/transfer-osrm-graphs.sh unpack <input.tar.zst>
#     docker compose up -d osrm-foot osrm-car
#     pnpm infra:verify

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OSRM_DIR="$REPO_ROOT/db/osrm"

usage() {
  echo "Usage: $0 pack [output.tar.zst] | unpack <input.tar.zst>" >&2
  exit 1
}

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1 (brew install $1 / apt install $1)" >&2; exit 1; }
}

MODE="${1:-}"
[ -n "$MODE" ] || usage

require tar
require zstd

case "$MODE" in
  pack)
    OUT="${2:-$REPO_ROOT/osrm-graphs-$(date +%Y%m%d).tar.zst}"
    for PROFILE in foot car; do
      if [ ! -f "$OSRM_DIR/$PROFILE/road.osrm.partition" ]; then
        echo "Missing $OSRM_DIR/$PROFILE/road.osrm.partition — run 'pnpm build:osrm-graphs' first" >&2
        exit 1
      fi
    done
    echo "Packing db/osrm/{foot,car} -> $OUT"
    tar -C "$REPO_ROOT" -cf - db/osrm/foot db/osrm/car | zstd -T0 -q -o "$OUT"
    echo "Done: $(du -h "$OUT" | cut -f1)"
    echo "Copy $OUT to the target machine, then run:"
    echo "  scripts/transfer-osrm-graphs.sh unpack $(basename "$OUT")"
    ;;
  unpack)
    IN="${2:-}"
    [ -n "$IN" ] || usage
    if [ ! -f "$IN" ]; then
      echo "Not found: $IN" >&2
      exit 1
    fi
    mkdir -p "$OSRM_DIR"
    echo "Unpacking $IN -> $OSRM_DIR/"
    zstd -dc "$IN" | tar -C "$REPO_ROOT" -xf -
    echo "Done. Bring the stack up with: docker compose up -d osrm-foot osrm-car"
    echo "Then verify with: pnpm infra:verify"
    ;;
  *)
    usage
    ;;
esac
