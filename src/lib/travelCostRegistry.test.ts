/**
 * Provider-selection registry tests (issue #86, Seam 4). Standalone (no test runner): run with
 * `tsx src/lib/travelCostRegistry.test.ts`. Direct assertions on the pure `selectTravelCostProvider`
 * function — precedence, region/mode gating, and the "errors propagate, no fallthrough" contract —
 * per issue #81's Seam 4 spec: "Japan + transit → OSM-Japan; non-Japan → Google; no key →
 * haversine; precedence order; a selected provider that throws propagates (no fallthrough)."
 */

import assert from "node:assert/strict";
import { haversineProvider, resolvePrimaryMode, DEFAULT_ALLOWED_MODES } from "./travelCost";
import { googleRoutesProvider } from "./googleRoutesProvider";
import { selectTravelCostProvider, getTravelCostProviderById } from "./travelCostRegistry";

// tsx compiles this file to CJS (no "type": "module" in package.json), which doesn't support
// top-level await — same wrapper as optimizer.test.ts, with an explicit exit-1 on failure.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {

const TOKYO = { lat: 35.6812, lng: 139.7671 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

const originalKey = process.env.GOOGLE_MAPS_API_KEY;
function withApiKey<T>(value: string | undefined, fn: () => T): T {
  if (value === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = value;
  try {
    return fn();
  } finally {
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
  }
}

// ── Japan + transit selects OSM-Japan ──
withApiKey("test-key", () => {
  const provider = selectTravelCostProvider([TOKYO], "transit");
  assert.equal(provider, getTravelCostProviderById("osm-japan"), "Japan + transit selects the OSM-Japan provider");
});

// ── Non-Japan selects Google when a key is present ──
withApiKey("test-key", () => {
  const provider = selectTravelCostProvider([PARIS], "transit");
  assert.equal(provider, googleRoutesProvider, "non-Japan selects Google when an API key is present");
});

// ── Japan but a non-transit mode does not select the transit-only OSM-Japan provider ──
withApiKey("test-key", () => {
  const provider = selectTravelCostProvider([TOKYO], "driving");
  assert.equal(provider, googleRoutesProvider, "Japan + driving falls through to Google, not OSM-Japan");
});

// ── No API key at all falls to haversine, the always-applicable floor ──
withApiKey(undefined, () => {
  const provider = selectTravelCostProvider([PARIS], "transit");
  assert.equal(provider, haversineProvider, "no API key falls back to the haversine floor");
});

// ── Precedence: OSM-Japan beats Google even when a key is present for the same query ──
withApiKey("test-key", () => {
  const provider = selectTravelCostProvider([TOKYO], "transit");
  assert.notEqual(provider, googleRoutesProvider, "OSM-Japan takes precedence over Google for Japan + transit");
});

// ── A selected provider's errors propagate — no silent fallthrough to haversine/Google ──
// This test environment has no real ingested db/transit-japan.db, so OSM-Japan's costMatrix
// throws its loud "not ingested" error; selection must not swallow that and quietly retry a
// lower-precedence provider instead.
await assert.rejects(
  () => selectTravelCostProvider([TOKYO], "transit").costMatrix([TOKYO], "transit"),
  /transit graph not ingested/,
  "a selected provider's error propagates instead of falling through to a lower-precedence provider"
);

// ── resolvePrimaryMode: precedence + defaulting ──
assert.equal(resolvePrimaryMode(["walking", "transit"]), "transit", "transit wins over walking when both are allowed");
assert.equal(resolvePrimaryMode(["driving", "walking"]), "driving", "driving wins over walking when transit isn't allowed");
assert.equal(resolvePrimaryMode(["bicycle"]), "bicycle", "falls through to bicycle when nothing higher-precedence is allowed");
assert.equal(resolvePrimaryMode(null), "transit", "an unset Trip resolves to the default set, transit first");
assert.equal(resolvePrimaryMode([]), "transit", "an empty allowed-mode set also resolves to the default set");
assert.equal(DEFAULT_ALLOWED_MODES.includes("transit"), true, "the default allowed-mode set includes transit");

console.log("✓ travelCostRegistry.test.ts passed");
}
