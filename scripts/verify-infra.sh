#!/usr/bin/env bash
# The acceptance bar for PR 2 (ADR-0023 §8, #157): "infrastructure is done" means proving it,
# not just standing containers up. Three stages, each stricter than the last.
#
# Not wired into `npm test`, which must keep passing with no Docker running. Requires `docker
# compose up -d` (see README.md) and `jq` on PATH.
#
# Usage: scripts/verify-infra.sh

set -euo pipefail

VROOM_URL="${VROOM_URL:-http://localhost:8080}"
OSRM_FOOT_URL="${OSRM_FOOT_URL:-http://localhost:5002}"
OSRM_CAR_URL="${OSRM_CAR_URL:-http://localhost:5010}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE="$SCRIPT_DIR/fixtures/vroom-planmode.json"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "== Stage 1/3: VROOM health ($VROOM_URL) =="
if ! curl -fsS "$VROOM_URL/health" > /dev/null; then
  fail "VROOM did not respond healthy at $VROOM_URL/health — is 'docker compose up -d' running?"
fi
echo "ok"

echo "== Stage 2/3: OSRM graphs actually route =="
# Tokyo Station -> Tokyo Tower, well inside the Kanto extract. A port probe only proves a socket
# opened; a real /route query proves the graph loaded and is routable.
for ENTRY in "foot:$OSRM_FOOT_URL" "car:$OSRM_CAR_URL"; do
  PROFILE="${ENTRY%%:*}"
  URL="${ENTRY#*:}"
  RESPONSE="$(curl -fsS "$URL/route/v1/$PROFILE/139.7671,35.6812;139.7454,35.6586?overview=false" || true)"
  CODE="$(echo "$RESPONSE" | jq -r '.code // "MISSING"' 2>/dev/null || echo "MISSING")"
  if [ "$CODE" != "Ok" ]; then
    fail "osrm-$PROFILE ($URL) did not return a route (code: $CODE) — is its graph built and mounted?"
  fi
  echo "ok: osrm-$PROFILE routes"
done

echo "== Stage 3/3: VROOM plan mode reports violations =="
RESPONSE="$(curl -fsS -H 'Content-Type: application/json' -d @"$FIXTURE" "$VROOM_URL/")"
VIOLATION_COUNT="$(echo "$RESPONSE" | jq '[.routes[]?.steps[]? | (.violations // []) | length] | add // 0')"
if [ "$VIOLATION_COUNT" -lt 1 ]; then
  fail "plan mode returned no violations for a fixture built to violate (options.c may not be
honored, or the VROOM image may lack glpk — see #157). Response: $RESPONSE"
fi
echo "ok: $VIOLATION_COUNT violation(s) reported"

echo
echo "All infrastructure checks passed."
