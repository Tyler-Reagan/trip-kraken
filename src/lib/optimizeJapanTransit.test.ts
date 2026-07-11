/**
 * End-to-end integration tracer (issue #86): "optimizing a Japan Trip demonstrably uses real
 * transit line names / transfer counts (against whatever graph file is present)." Standalone (no
 * test runner): run with `tsx src/lib/optimizeJapanTransit.test.ts`.
 *
 * This repo has no real ingested `db/transit-japan.db` yet — the OSM ingestion pipeline that would
 * produce one is out of scope for #86 (parent issue #81's slice order: J2 only built the graph
 * model/persistence layer, not an actual OSM-extract transform). So this test stands in a small
 * hand-built graph fixture (identical in spirit to `osmTransitProvider.test.ts`'s Seam 1 fixture)
 * for "whatever graph file is present": it's saved to and reloaded from a real on-disk SQLite file
 * via `transitGraphStore.ts`'s `save()`/`load()` — genuinely round-tripping through disk, not just
 * an in-memory object — then run through `solve()`'s real sequencing path with `mode: "transit"`,
 * exactly as `optimize.ts`'s orchestrator would for a real Japan Trip once ingestion exists. The
 * point being demonstrated: once a graph file is present, the solved plan's Legs carry real line
 * names and a real transfer count, not haversine's plain distance/time.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createGraph, type TransitGraph } from "./transitGraph";
import { save, load } from "./transitGraphStore";
import { createOsmTransitProvider } from "./osmTransitProvider";
import { solve } from "./solver";

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

// Three activities near real stations on the fixture's two lines, one day, no lodging — enough to
// force sequencing to route between stations on different lines (an interchange at Tokyo).
const locations = [
  { id: "near-akihabara", lat: 35.6983, lng: 139.7733 }, // ~10m from loop-akihabara
  { id: "near-otemachi", lat: 35.6869, lng: 139.7644 }, // ~10m from spur-otemachi
  { id: "near-kanda", lat: 35.6917, lng: 139.7707 }, // ~10m from loop-kanda
];

const itinerary = await solve({
  locations,
  numDays: 1,
  provider,
  mode: "transit",
});

assert.equal(itinerary.days.length, 1, "one day plan for one day's worth of stops");
const stopIds = itinerary.days[0].locationIds;
assert.equal(stopIds.length, 3, "all three activities are placed");

// Walk the solved day's consecutive stops through describeLeg — the same lazy, display-time call
// optimize.ts's caller would make for the plan's Legs (ADR-0018) — and confirm at least one
// consecutive pair reports real line names and a real transfer count, not haversine's plain numbers.
const byId = new Map(locations.map((l) => [l.id, l]));
let sawRealTransitLeg = false;
for (let i = 0; i < stopIds.length - 1; i++) {
  const from = byId.get(stopIds[i])!;
  const to = byId.get(stopIds[i + 1])!;
  const leg = await provider.describeLeg(from, to, "transit");
  if (leg.lineNames && leg.lineNames.length > 0) {
    sawRealTransitLeg = true;
    assert.ok(leg.transferCount !== undefined, "a real transit Leg also reports a transfer count");
  }
}
assert.ok(
  sawRealTransitLeg,
  "the solved plan's Legs demonstrably carry real transit line names once a graph file is present (#86)"
);

fs.rmSync(dir, { recursive: true, force: true });

console.log("✓ optimizeJapanTransit.test.ts passed");
}
