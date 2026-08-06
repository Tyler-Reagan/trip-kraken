/**
 * Provider-selection registry tests (issue #86, Seam 4; `kinds` per ADR-0022 P2). Standalone (no
 * test runner): run with `tsx src/lib/travelCostRegistry.test.ts`. Direct assertions on the pure
 * `selectPathProvider` function — precedence, region/kind gating (by set intersection, not
 * equality), and the "errors propagate, no fallthrough" contract — per issue #81's Seam 4 spec:
 * "Japan + rail-willing → OSM-Japan; non-Japan → Google; no key → haversine; precedence order; a
 * selected provider that throws propagates (no fallthrough)."
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { haversineProvider } from "./pathProvider";
import { googleRoutesProvider } from "./googleRoutesProvider";
import { selectPathProvider, getPathProviderById } from "./travelCostRegistry";
import { DEFAULT_GRAPH_PATH } from "./transitGraphStore";

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

// ── Japan + rail-willing selects OSM-Japan ──
withApiKey("test-key", () => {
  const provider = selectPathProvider([TOKYO], ["rail"]);
  assert.equal(provider, getPathProviderById("osm-japan"), "Japan + rail-willing selects the OSM-Japan provider");
});

// ── Non-Japan selects Google when a key is present ──
withApiKey("test-key", () => {
  const provider = selectPathProvider([PARIS], ["rail"]);
  assert.equal(provider, googleRoutesProvider, "non-Japan selects Google when an API key is present");
});

// ── Japan but no rail willingness does not select the rail-only OSM-Japan provider ──
withApiKey("test-key", () => {
  const provider = selectPathProvider([TOKYO], ["driving"]);
  assert.equal(provider, googleRoutesProvider, "Japan + driving-only falls through to Google, not OSM-Japan");
});

// ── appliesTo tests set intersection, not equality: a set that includes rail alongside other
//    kinds still selects OSM-Japan (ADR-0022, revised — willingness, not a constraint) ──
withApiKey("test-key", () => {
  const provider = selectPathProvider([TOKYO], ["driving", "rail", "walking"]);
  assert.equal(provider, getPathProviderById("osm-japan"), "rail anywhere in the willing set is enough, not the only kind");
});

// ── No API key at all falls to haversine, the always-applicable floor ──
withApiKey(undefined, () => {
  const provider = selectPathProvider([PARIS], ["rail"]);
  assert.equal(provider, haversineProvider, "no API key falls back to the haversine floor");
});

// ── Precedence: OSM-Japan beats Google even when a key is present for the same query ──
withApiKey("test-key", () => {
  const provider = selectPathProvider([TOKYO], ["rail"]);
  assert.notEqual(provider, googleRoutesProvider, "OSM-Japan takes precedence over Google for Japan + rail-willing");
});

// ── A selected provider's errors propagate — no silent fallthrough to haversine/Google ──
// Forces the "not ingested" case regardless of whether this dev environment has a real graph
// file (issue #88's manual eval ingested one): temporarily hides it, mirroring
// transitGraphStore.test.ts's own backup/restore pattern around its singleton test — this must
// never clobber a real ingested graph. Safe to do here: nothing earlier in this file calls
// costMatrix/describeJourney on the OSM-Japan provider, so getTransitGraph()'s cache is never
// populated before this point in this process.
const hadRealGraph = fs.existsSync(DEFAULT_GRAPH_PATH);
const backupPath = `${DEFAULT_GRAPH_PATH}.bak-${Date.now()}`;
if (hadRealGraph) fs.renameSync(DEFAULT_GRAPH_PATH, backupPath);
try {
  await assert.rejects(
    () => selectPathProvider([TOKYO], ["rail"]).costMatrix([TOKYO], ["rail"]),
    /transit graph not ingested/,
    "a selected provider's error propagates instead of falling through to a lower-precedence provider"
  );
} finally {
  if (hadRealGraph) fs.renameSync(backupPath, DEFAULT_GRAPH_PATH);
}

console.log("✓ travelCostRegistry.test.ts passed");
}
