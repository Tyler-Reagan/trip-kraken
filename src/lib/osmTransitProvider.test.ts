/**
 * OSM-Japan `TravelCostProvider` tests (issue #85, Seam 1). Standalone (no test runner): run with
 * `tsx src/lib/osmTransitProvider.test.ts`. Exercises the provider purely through its public
 * `TravelCostProvider` interface (`costMatrix`/`describeLeg`) against a small hand-built graph
 * fixture — no runtime network I/O, so the fixture is a graph, not an HTTP mock (unlike
 * googleRoutesProvider.test.ts, which mocks `global.fetch`).
 *
 * Fixture geography (all coordinates real Tokyo-area positions, distances/lines invented for the
 * test): a Shinkansen trunk (Tokyo <-> Shin-Yokohama, one long hop) crossed with a subway loop
 * (Yamanote-ish: Tokyo <-> Kanda <-> Akihabara) and a short Marunouchi-ish subway spur off Tokyo
 * (Tokyo <-> Otemachi), joined to the Yamanote-ish line only at Tokyo (an interchange cluster).
 * One isolated station (Machida) sits far from everything to exercise the no-path-in-range case.
 */

import assert from "node:assert/strict";
import { createGraph, buildSpatialIndex, type TransitGraph } from "./transitGraph";
import { createOsmTransitProvider, snapStations } from "./osmTransitProvider";

// tsx compiles this file to CJS (no "type": "module" in package.json), which doesn't support
// top-level await — same wrapper as optimizer.test.ts, with an explicit exit-1 on failure.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {

function buildFixture(): TransitGraph {
  const graph = createGraph();

  // Commuter loop: Tokyo -> Kanda -> Akihabara (two consecutive hops, same line).
  graph.stopNodes.set("loop-tokyo", {
    id: "loop-tokyo", lineId: "loop", lineName: "Loop Line", lineType: "commuter",
    stationName: "Tokyo", lat: 35.6812, lng: 139.7671, sequence: 0,
  });
  graph.stopNodes.set("loop-kanda", {
    id: "loop-kanda", lineId: "loop", lineName: "Loop Line", lineType: "commuter",
    stationName: "Kanda", lat: 35.6918, lng: 139.7708, sequence: 1,
  });
  graph.stopNodes.set("loop-akihabara", {
    id: "loop-akihabara", lineId: "loop", lineName: "Loop Line", lineType: "commuter",
    stationName: "Akihabara", lat: 35.6984, lng: 139.7731, sequence: 2,
  });
  graph.rideEdges.push({ fromStopId: "loop-tokyo", toStopId: "loop-kanda", distanceMeters: 1200 });
  graph.rideEdges.push({ fromStopId: "loop-kanda", toStopId: "loop-akihabara", distanceMeters: 1300 });

  // Subway spur: Tokyo -> Otemachi (one hop, different line, interchanges with the loop at Tokyo).
  graph.stopNodes.set("spur-tokyo", {
    id: "spur-tokyo", lineId: "spur", lineName: "Spur Subway", lineType: "subway",
    stationName: "Tokyo", lat: 35.6812, lng: 139.7671, sequence: 0,
  });
  graph.stopNodes.set("spur-otemachi", {
    id: "spur-otemachi", lineId: "spur", lineName: "Spur Subway", lineType: "subway",
    stationName: "Otemachi", lat: 35.687, lng: 139.7645, sequence: 1,
  });
  graph.rideEdges.push({ fromStopId: "spur-tokyo", toStopId: "spur-otemachi", distanceMeters: 900 });

  // Interchange cluster at Tokyo Station, joining the loop and the spur.
  graph.clusters.set("cluster-tokyo", {
    id: "cluster-tokyo", name: "Tokyo", stopNodeIds: ["loop-tokyo", "spur-tokyo"],
  });
  graph.transferEdges.push({ fromStopId: "loop-tokyo", toStopId: "spur-tokyo", clusterId: "cluster-tokyo" });
  graph.transferEdges.push({ fromStopId: "spur-tokyo", toStopId: "loop-tokyo", clusterId: "cluster-tokyo" });

  // Shinkansen trunk: one long hop from Tokyo to a distant city stop, same real-world distance
  // class as a subway hop would need many stops for — used to compare effective speed, not to
  // interchange with the loop/spur (an isolated one-line network is enough for a speed check).
  graph.stopNodes.set("shinkansen-tokyo", {
    id: "shinkansen-tokyo", lineId: "shinkansen", lineName: "Tokaido Shinkansen", lineType: "shinkansen",
    stationName: "Tokyo (Shinkansen)", lat: 35.6812, lng: 139.7671, sequence: 0,
  });
  graph.stopNodes.set("shinkansen-nagoya", {
    id: "shinkansen-nagoya", lineId: "shinkansen", lineName: "Tokaido Shinkansen", lineType: "shinkansen",
    stationName: "Nagoya", lat: 35.1709, lng: 136.8815, sequence: 1,
  });
  graph.rideEdges.push({ fromStopId: "shinkansen-tokyo", toStopId: "shinkansen-nagoya", distanceMeters: 260_000 });

  return graph;
}

const graph = buildFixture();
const spatialIndex = buildSpatialIndex(graph);
const provider = createOsmTransitProvider(graph, spatialIndex);

const P = (lat: number, lng: number) => ({ lat, lng });

// Points near each real station, but not exactly on it (a realistic "committed Location" a short
// walk from the platform) — exercises station-snapping, not just an exact-coordinate match.
const nearAkihabara = P(35.6983, 139.7733); // ~10m from loop-akihabara
const nearOtemachi = P(35.6869, 139.7644); // ~10m from spur-otemachi
const nearKanda = P(35.6917, 139.7707); // ~10m from loop-kanda
const nearNagoya = P(35.1708, 136.8816); // ~10m from shinkansen-nagoya
const nearTokyoForShinkansen = P(35.6813, 139.767); // ~10m from shinkansen-tokyo
const isolated = P(36.5, 140.5); // far from every stop node in the fixture

// ── Multi-line journey: Akihabara -> Otemachi crosses the Tokyo interchange (loop -> spur) ──
const multiLine = await provider.describeLeg(nearAkihabara, nearOtemachi, "transit");
assert.deepEqual(multiLine.lineNames, ["Loop Line", "Spur Subway"], "reports both real line names in ride order");
assert.equal(multiLine.transferCount, 1, "one transfer edge traversed at the Tokyo interchange");

// ── Single-ride journey: Akihabara -> Kanda stays on one line, zero transfers ──
const singleRide = await provider.describeLeg(nearAkihabara, nearKanda, "transit");
assert.deepEqual(singleRide.lineNames, ["Loop Line"], "single-line journey reports just that line");
assert.equal(singleRide.transferCount, 0, "no transfer edges traversed on a single-ride journey");

// ── Shinkansen vs. subway: an equal-distance hop is faster on the Shinkansen ──
const shinkansenLeg = await provider.describeLeg(nearTokyoForShinkansen, nearNagoya, "transit");
// A same-distance subway hop, built from the loop's per-meter rate (its two real hops average
// ~1250m at commuter speed) scaled up to the Shinkansen distance, isolates line-type speed from
// trip length: same distance, different effective speed.
const subwayRatePerMeter = (await provider.describeLeg(nearAkihabara, nearKanda, "transit")).durationSeconds / 1300;
const equalDistanceSubwaySeconds = subwayRatePerMeter * 260_000;
assert.ok(
  shinkansenLeg.durationSeconds < equalDistanceSubwaySeconds,
  "a Shinkansen hop is faster than an equal-distance subway hop"
);

// ── Station-snapping picks the nearest station, not just any station in range ──
const nearestStops = snapStations(spatialIndex, nearAkihabara);
assert.equal(nearestStops[0]?.id, "loop-akihabara", "the nearest stop in range is Akihabara");

// ── No station in range: falls back to a haversine-as-walking estimate, visibly marked ──
const noStationLeg = await provider.describeLeg(isolated, nearAkihabara, "transit");
assert.equal(noStationLeg.lineNames, undefined, "an unrouted walking estimate carries no line names");
assert.equal(noStationLeg.transferCount, undefined, "an unrouted walking estimate carries no transfer count");
assert.ok(noStationLeg.durationSeconds > 0, "still reports a usable (walking-estimate) duration");

// ── costMatrix backs the same provider surface in bulk, consistent with describeLeg ──
const matrix = await provider.costMatrix([nearAkihabara, nearOtemachi, isolated], "transit");
assert.equal(matrix.length, 3, "one row per point");
assert.equal(matrix[0][1].durationSeconds, multiLine.durationSeconds, "costMatrix agrees with describeLeg for the same pair");
assert.ok(matrix[0][2].durationSeconds > 0, "an isolated point still gets a walking-estimate cost in the matrix");
assert.equal(matrix[0][0].distanceMeters, 0, "a point costed against itself is zero");

console.log("✓ osmTransitProvider.test.ts passed");
}
