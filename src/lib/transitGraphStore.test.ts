/**
 * Round-trip test for the transit graph's read-only SQLite serialization (issue #84). Standalone
 * (no test runner): run with `tsx src/lib/transitGraphStore.test.ts`. A small hand-built graph
 * (two lines, one interchange cluster) is saved to a throwaway temp file and reloaded; the
 * reloaded graph must be structurally identical to the original. Also covers the "missing file"
 * loud-error contract, since a silent empty graph is the one outcome the design forbids.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createGraph, type TransitGraph } from "./transitGraph";
import Database from "better-sqlite3";
import { save, load, getTransitGraph, DEFAULT_GRAPH_PATH } from "./transitGraphStore";

function buildFixture(): TransitGraph {
  const graph = createGraph();

  // Yamanote line: two consecutive stops.
  graph.stopNodes.set("yamanote-tokyo", {
    id: "yamanote-tokyo",
    lineId: "yamanote",
    lineName: "Yamanote Line",
    lineType: "commuter",
    stationName: "Tokyo",
    lat: 35.6812,
    lng: 139.7671,
    sequence: 0,
  });
  graph.stopNodes.set("yamanote-kanda", {
    id: "yamanote-kanda",
    lineId: "yamanote",
    lineName: "Yamanote Line",
    lineType: "commuter",
    stationName: "Kanda",
    lat: 35.6918,
    lng: 139.7708,
    sequence: 1,
  });
  // Carries traced track (ADR-0030 §5): a bent shape, so a codec that dropped or reordered
  // vertices would show up as a changed line rather than an unchanged straight one.
  graph.rideEdges.push({
    fromStopId: "yamanote-tokyo",
    toStopId: "yamanote-kanda",
    distanceMeters: 1200,
    geometry: {
      type: "LineString",
      coordinates: [[139.76712, 35.68124], [139.76789, 35.6831], [139.76834, 35.68546], [139.77081, 35.69183]],
    },
    tracedLengthMeters: 1289.4,
  });

  // Marunouchi line: a stop node at the same physical station as Tokyo (an interchange).
  graph.stopNodes.set("marunouchi-tokyo", {
    id: "marunouchi-tokyo",
    lineId: "marunouchi",
    lineName: "Marunouchi Line",
    lineType: "subway",
    stationName: "Tokyo",
    lat: 35.6812,
    lng: 139.7671,
    sequence: 0,
  });
  graph.stopNodes.set("marunouchi-otemachi", {
    id: "marunouchi-otemachi",
    lineId: "marunouchi",
    lineName: "Marunouchi Line",
    lineType: "subway",
    stationName: "Otemachi",
    lat: 35.687,
    lng: 139.7645,
    sequence: 1,
  });
  graph.rideEdges.push({ fromStopId: "marunouchi-tokyo", toStopId: "marunouchi-otemachi", distanceMeters: 900 });

  // Tokyo Station interchange cluster, joining the two lines' Tokyo stop nodes.
  graph.clusters.set("cluster-tokyo", {
    id: "cluster-tokyo",
    name: "Tokyo",
    stopNodeIds: ["yamanote-tokyo", "marunouchi-tokyo"],
  });
  graph.transferEdges.push({ fromStopId: "yamanote-tokyo", toStopId: "marunouchi-tokyo", clusterId: "cluster-tokyo" });
  graph.transferEdges.push({ fromStopId: "marunouchi-tokyo", toStopId: "yamanote-tokyo", clusterId: "cluster-tokyo" });

  return graph;
}

function normalize(graph: TransitGraph) {
  return {
    stopNodes: [...graph.stopNodes.entries()].sort(([a], [b]) => a.localeCompare(b)),
    clusters: [...graph.clusters.entries()]
      .map(([id, c]) => [id, { ...c, stopNodeIds: [...c.stopNodeIds].sort() }] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
    rideEdges: [...graph.rideEdges].sort((a, b) => a.fromStopId.localeCompare(b.fromStopId)),
    transferEdges: [...graph.transferEdges].sort((a, b) => a.fromStopId.localeCompare(b.fromStopId)),
  };
}

const dir = fs.mkdtempSync(path.join(tmpdir(), "tk-transit-graph-"));
const dbPath = path.join(dir, "transit-japan.db");

// ── Missing file: loud error, never a silent empty graph ──
assert.throws(() => load(dbPath), /transit graph not ingested/, "missing graph file must throw loudly");

// ── Round trip: save then load must be structurally identical ──
const original = buildFixture();
save(original, dbPath);
const { graph: reloaded, spatialIndex } = load(dbPath);

assert.deepEqual(normalize(reloaded), normalize(original), "reloaded graph matches the original structurally");
assert.equal(reloaded.stopNodes.size, 4, "all stop nodes round-trip");
assert.equal(reloaded.clusters.size, 1, "all clusters round-trip");
assert.equal(reloaded.rideEdges.length, 2, "all ride edges round-trip");
assert.equal(reloaded.transferEdges.length, 2, "all transfer edges round-trip");

// ── load() also reconstructs a usable spatial index over the reloaded graph ──
const nearTokyo = spatialIndex.nearby(35.6812, 139.7671, 200);
assert.deepEqual(
  new Set(nearTokyo.map((s) => s.id)),
  new Set(["yamanote-tokyo", "marunouchi-tokyo"]),
  "spatial index finds both Tokyo Station stop nodes within a tight radius"
);
assert.equal(spatialIndex.nearby(35.6812, 139.7671, 200).length, 2, "no other stop is within 200m of Tokyo Station");
assert.equal(spatialIndex.nearby(0, 0, 200).length, 0, "an empty-ocean point far from any stop finds nothing");

// ── save() is idempotent against a pre-existing file (re-running ingestion) ──
save(original, dbPath);
const { graph: resaved } = load(dbPath);
assert.deepEqual(normalize(resaved), normalize(original), "re-saving over an existing file produces the same graph");

// ── getTransitGraph() caches the singleton across calls (module/global cache, per ADR),
// against the one real default path (it takes no argument, mirroring getDrizzle()). Back up
// any pre-existing file first — this must never clobber a real ingested graph.
const backupPath = `${DEFAULT_GRAPH_PATH}.bak-${Date.now()}`;
const hadExisting = fs.existsSync(DEFAULT_GRAPH_PATH);
if (hadExisting) fs.renameSync(DEFAULT_GRAPH_PATH, backupPath);
try {
  save(original, DEFAULT_GRAPH_PATH);
  const first = getTransitGraph();
  const second = getTransitGraph();
  assert.equal(first, second, "getTransitGraph returns the same cached instance on repeat calls");
} finally {
  fs.rmSync(DEFAULT_GRAPH_PATH, { force: true });
  if (hadExisting) fs.renameSync(backupPath, DEFAULT_GRAPH_PATH);
}

fs.rmSync(dir, { recursive: true, force: true });

// ── Geometry and provenance (ADR-0030 §5, §6) ───────────────────────────────────────────
const withGeometry = reloaded.rideEdges.find((e) => e.fromStopId === "yamanote-tokyo")!;
const withoutGeometry = reloaded.rideEdges.find((e) => e.fromStopId === "marunouchi-tokyo")!;

assert.ok(withGeometry.geometry, "a ride edge's traced shape survives the round trip");
assert.equal(withGeometry.geometry!.coordinates.length, 4, "every vertex comes back");
assert.equal(withGeometry.tracedLengthMeters, 1289.4, "traced track length round-trips exactly — it is a plain REAL");
// The BLOB is lossy at the 5th decimal place by design, so this is a bound, not an equality.
for (const [i, [lng, lat]] of withGeometry.geometry!.coordinates.entries()) {
  const [wantLng, wantLat] = [
    [139.76712, 35.68124], [139.76789, 35.6831], [139.76834, 35.68546], [139.77081, 35.69183],
  ][i];
  assert.ok(Math.abs(lng - wantLng) <= 1e-5 && Math.abs(lat - wantLat) <= 1e-5, `vertex ${i} within 5dp`);
}

// Absent geometry must stay absent. An empty LineString would read as "we traced this and it is
// nothing", which is the opposite of what a refused segment means (ADR-0030 §1).
assert.equal(withoutGeometry.geometry, undefined, "an untraced ride edge comes back with no geometry at all");
assert.equal(withoutGeometry.tracedLengthMeters, undefined, "and no traced length");

const metaDbDir = fs.mkdtempSync(path.join(tmpdir(), "tk-graph-meta-"));
const metaDbPath = path.join(metaDbDir, "transit-japan.db");
save(original, metaDbPath, { snapshotDate: "260101", region: "asia/japan" });
const metaDb = new Database(metaDbPath, { readonly: true });
const meta = metaDb.prepare("SELECT snapshotDate, region, ingestedAt FROM Meta").all() as {
  snapshotDate: string;
  region: string;
  ingestedAt: string;
}[];
metaDb.close();
assert.equal(meta.length, 1, "Meta is one row, not a log");
assert.equal(meta[0].snapshotDate, "260101", "the graph file records which Extract built it");
assert.equal(meta[0].region, "asia/japan");
assert.ok(!Number.isNaN(Date.parse(meta[0].ingestedAt)), "ingestedAt is a parseable timestamp");
fs.rmSync(metaDbDir, { recursive: true, force: true });

console.log("transitGraphStore round-trip: OK");
