/**
 * Facts-layer integration tracer (issue #86): "once a Japan transit graph is present, routing
 * between real stations demonstrably uses real transit line names / transfer counts." Standalone
 * (no test runner): run with `tsx src/lib/optimizeJapanTransit.test.ts`.
 *
 * Retargeted under ADR-0023 (PR 4): #86's actual claim is about the Facts layer
 * (`osmTransitProvider.ts`/`describeJourney`, ADR-0024) producing `basisOfCost: "railNetwork"`
 * costs from a real graph file — it was never a claim about the solver, and coupling it to
 * `solve()` only ever made it fragile to solver changes unrelated to what it's checking. This test
 * now calls the provider directly rather than routing through `solve()`.
 *
 * This repo has no real ingested `db/transit-japan.db` yet — the OSM ingestion pipeline that would
 * produce one is out of scope for #86 (parent issue #81's slice order: J2 only built the graph
 * model/persistence layer, not an actual OSM-extract transform). So this test stands in a small
 * hand-built graph fixture (identical in spirit to `osmTransitProvider.test.ts`'s Seam 1 fixture)
 * for "whatever graph file is present": it's saved to and reloaded from a real on-disk SQLite file
 * via `transitGraphStore.ts`'s `save()`/`load()` — genuinely round-tripping through disk, not just
 * an in-memory object.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createGraph, type TransitGraph } from "./transitGraph";
import { save, load } from "./transitGraphStore";
import { createOsmTransitProvider } from "./osmTransitProvider";

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

  // Subway spur: Tokyo -> Otemachi (different line, interchanges with the loop at Tokyo).
  graph.stopNodes.set("spur-tokyo", {
    id: "spur-tokyo", lineId: "spur", lineName: "Spur Subway", lineType: "subway",
    stationName: "Tokyo", lat: 35.6812, lng: 139.7671, sequence: 0,
  });
  graph.stopNodes.set("spur-otemachi", {
    id: "spur-otemachi", lineId: "spur", lineName: "Spur Subway", lineType: "subway",
    stationName: "Otemachi", lat: 35.687, lng: 139.7645, sequence: 1,
  });
  graph.rideEdges.push({ fromStopId: "spur-tokyo", toStopId: "spur-otemachi", distanceMeters: 900 });

  graph.clusters.set("cluster-tokyo", {
    id: "cluster-tokyo", name: "Tokyo", stopNodeIds: ["loop-tokyo", "spur-tokyo"],
  });
  graph.transferEdges.push({ fromStopId: "loop-tokyo", toStopId: "spur-tokyo", clusterId: "cluster-tokyo" });
  graph.transferEdges.push({ fromStopId: "spur-tokyo", toStopId: "loop-tokyo", clusterId: "cluster-tokyo" });

  return graph;
}

// Save to and reload from a real on-disk file — "whatever graph file is present" is a genuine
// file, not just an in-memory fixture object.
const dir = fs.mkdtempSync(path.join(tmpdir(), "tk-japan-transit-"));
const graphPath = path.join(dir, "transit-japan.db");
save(buildFixture(), graphPath);
const { graph, spatialIndex } = load(graphPath);
const provider = createOsmTransitProvider(graph, spatialIndex);

// Three points near real stations on the fixture's two lines — enough to force routing between
// stations on different lines (an interchange at Tokyo) across at least one consecutive pair.
const points = [
  { locationId: "near-akihabara", lat: 35.6983, lng: 139.7733 }, // ~10m from loop-akihabara
  { locationId: "near-otemachi", lat: 35.6869, lng: 139.7644 }, // ~10m from spur-otemachi
  { locationId: "near-kanda", lat: 35.6917, lng: 139.7707 }, // ~10m from loop-kanda
];

// The same lazy, display-time call a plan's Paths would make (ADR-0018, ADR-0021, ADR-0022) —
// confirm at least one consecutive pair reports a real rail-routed cost, not haversine's plain
// straight-line numbers.
let sawRealTransitPath = false;
for (let i = 0; i < points.length - 1; i++) {
  const journey = await provider.describeJourney(points[i], points[i + 1], ["rail"]);
  // A decline (ADR-0024 §4) is a legitimate outcome for a pair with no station in range — this
  // loop is looking for at least one real rail Path among the consecutive points, not asserting
  // every pair routes.
  // A decomposed Journey (ADR-0032) leads with its access walk, so the rail Paths are looked for
  // across the whole chain rather than at its head.
  for (const railPath of journey?.filter((p) => p.kind === "rail") ?? []) {
    sawRealTransitPath = true;
    assert.equal(railPath.travelCost.basisOfCost, "railNetwork", "a real transit Path is routed, not estimated");
  }
}
assert.ok(
  sawRealTransitPath,
  "the Facts layer demonstrably uses real rail routing once a graph file is present (#86)"
);

fs.rmSync(dir, { recursive: true, force: true });

console.log("✓ optimizeJapanTransit.test.ts passed");
}
