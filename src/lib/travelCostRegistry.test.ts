/**
 * Provider registry tests (ADR-0024) — capability dispatch, not selection. Standalone (no test
 * runner): run with `tsx src/lib/travelCostRegistry.test.ts`. Direct assertions on `REGISTRY`'s
 * shape (order, `kinds`, `terminal`), each entry's `isAvailable` gate in isolation (no network),
 * one end-to-end `buildTravelMatrix` call proving the whole pipeline wires together, and
 * `isPersistable` (`types/path.ts`) since #158's rule is only as good as this test keeping it
 * honest.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { REGISTRY, buildTravelMatrix } from "./travelCostRegistry";
import { DEFAULT_GRAPH_PATH } from "./transitGraphStore";
import { isPersistable, makeTravelCost, type ProviderId } from "@/types/path";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {

const TOKYO = { lat: 35.6812, lng: 139.7671 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

// Async-aware and always awaited at call sites: a sync try/finally around an async `fn` would
// restore env vars before `fn`'s awaited work actually finishes, which is exactly the bug the
// end-to-end test below would otherwise have (it awaits buildTravelMatrix inside `fn`).
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const originals = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function entry(id: ProviderId) {
  const e = REGISTRY.find((e) => e.id === id);
  assert.ok(e, `registry has a "${id}" entry`);
  return e!;
}

// ── The table (ADR-0024 §4, amended 2026-08-10): four rows, this order, these kinds ──
// A literal, so re-ordering or re-declaring a row's competence is a visible diff here, not just
// in the module doc or the ADR.
assert.deepEqual(
  REGISTRY.map((e) => ({ id: e.id, kinds: [...e.kinds], terminal: e.terminal ?? false })),
  [
    { id: "osm-japan", kinds: ["rail"], terminal: false },
    { id: "osrm", kinds: ["walking", "driving"], terminal: false },
    { id: "google", kinds: ["bus"], terminal: false },
    { id: "haversine", kinds: ["rail", "bus", "walking", "driving", "bicycle", "other"], terminal: true },
  ],
  "registry order and declared competence match ADR-0024 §4 exactly"
);

// ── osm-japan's gate: region AND graph presence, both required ──
assert.equal(entry("osm-japan").isAvailable([PARIS]), false, "declines outside Japan regardless of graph presence");
{
  const hadRealGraph = fs.existsSync(DEFAULT_GRAPH_PATH);
  const backupPath = `${DEFAULT_GRAPH_PATH}.bak-${Date.now()}`;
  if (hadRealGraph) fs.renameSync(DEFAULT_GRAPH_PATH, backupPath);
  try {
    assert.equal(entry("osm-japan").isAvailable([TOKYO]), false, "declines in Japan with no graph file");
  } finally {
    if (hadRealGraph) fs.renameSync(backupPath, DEFAULT_GRAPH_PATH);
  }
  if (hadRealGraph) {
    assert.equal(entry("osm-japan").isAvailable([TOKYO]), true, "available in Japan once the graph file is back");
  }
}

// ── osrm's gate: both URLs, not either ──
await withEnv({ OSRM_FOOT_URL: undefined, OSRM_CAR_URL: undefined }, () => {
  assert.equal(entry("osrm").isAvailable([TOKYO]), false, "unavailable with neither URL set");
});
await withEnv({ OSRM_FOOT_URL: "http://localhost:5002", OSRM_CAR_URL: undefined }, () => {
  assert.equal(entry("osrm").isAvailable([TOKYO]), false, "unavailable with only the foot URL set");
});
await withEnv({ OSRM_FOOT_URL: "http://localhost:5002", OSRM_CAR_URL: "http://localhost:5010" }, () => {
  assert.equal(entry("osrm").isAvailable([TOKYO]), true, "available once both URLs are set");
});

// ── google's gate: the API key, region-independent ──
await withEnv({ GOOGLE_MAPS_API_KEY: undefined }, () => {
  assert.equal(entry("google").isAvailable([TOKYO]), false, "unavailable with no key");
});
await withEnv({ GOOGLE_MAPS_API_KEY: "test-key" }, () => {
  assert.equal(entry("google").isAvailable([PARIS]), true, "available anywhere once a key is set — not Japan-gated");
});

// ── haversine: always ──
assert.equal(entry("haversine").isAvailable([PARIS]), true);
assert.equal(entry("haversine").terminal, true, "exactly one entry is marked terminal");

// ── Deliberate posture flip from ADR-0018 §4 (ADR-0024, amended 2026-08-11): a missing graph
//    file used to throw the moment OSM-Japan was selected — "selection is by applicability, not
//    try-and-fallback." Under capability dispatch, graph presence is one clause of an entry gate:
//    missing it now means osm-japan silently declines and the cell falls through, the same as any
//    other unavailable entry. This is the new contract, asserted explicitly so nobody "fixes" it
//    back to a throw believing this to be a regression. ──
{
  const hadRealGraph = fs.existsSync(DEFAULT_GRAPH_PATH);
  const backupPath = `${DEFAULT_GRAPH_PATH}.bak-${Date.now()}`;
  if (hadRealGraph) fs.renameSync(DEFAULT_GRAPH_PATH, backupPath);
  try {
    // kinds: ["rail"] only — osrm doesn't declare rail and google isn't queried for it, so this
    // never touches the network; only osm-japan (declines) and haversine (terminal) are in play.
    const matrix = await buildTravelMatrix([TOKYO, TOKYO], { kinds: ["rail"] });
    assert.equal(matrix[0][1].answeredBy, "haversine", "falls through to haversine instead of throwing");
  } finally {
    if (hadRealGraph) fs.renameSync(backupPath, DEFAULT_GRAPH_PATH);
  }
}

// ── End to end, no gates available: every cell in the composed matrix is haversine, none null ──
// Paris keeps osm-japan out on region alone regardless of graph presence; no env var is set for
// osrm or google, so this exercises the real four-row walk with no network calls at all.
await withEnv({ OSRM_FOOT_URL: undefined, OSRM_CAR_URL: undefined, GOOGLE_MAPS_API_KEY: undefined }, async () => {
  const points = [PARIS, { lat: 48.86, lng: 2.29 }];
  const matrix = await buildTravelMatrix(points, { kinds: ["rail", "bus", "walking", "driving"] });
  assert.equal(matrix.length, 2);
  for (const row of matrix) {
    for (const cell of row) {
      assert.equal(cell.answeredBy, "haversine");
      assert.equal(cell.basisOfCost, "straightLine");
    }
  }
});

// ── isPersistable (types/path.ts): the #158 gate. Google Maps Platform ToS §3.2.3(a) names
//    "distance matrix results" under its no-pre-fetch/no-caching clause; the Routes API's caching
//    exception (§19.3) covers lat/lng only, not durations or distances. Anything answeredBy
//    "google" must fail this check; everything else must pass it. ──
const sample = (answeredBy: ProviderId) => makeTravelCost(1000, 100, "routingService", answeredBy);
assert.equal(isPersistable(sample("google")), false, "a Google-derived cost is never persistable");
assert.equal(isPersistable(sample("osrm")), true);
assert.equal(isPersistable(sample("osm-japan")), true);
assert.equal(isPersistable(sample("haversine")), true);

console.log("✓ travelCostRegistry.test.ts passed");
}
