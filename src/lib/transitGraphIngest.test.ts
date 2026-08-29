/**
 * Seam 2 tests for the OSM → transit-graph pure transform (issue #87). Standalone (no test
 * runner): run with `tsx src/lib/transitGraphIngest.test.ts`. Small hand-built OSM-element
 * fixtures (already "parsed" — plain `OsmNode`/`OsmRelation` objects, no XML text) exercise
 * `buildTransitGraph` directly, per the ticket's explicit seam: download/osmium/file-write are
 * I/O and untested here.
 *
 * A second section below (clearly separated) is a pipeline smoke test that *does* touch real XML
 * text and a real SQLite file — proving the "running the pipeline yields an inspectable
 * db/transit-japan.db queryable with plain SQL" acceptance criterion, without needing a live
 * `osmium`/network run (a hand-written OSM XML fixture stands in for a filtered extract).
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { buildTransitGraph, type OsmNode, type OsmRelation, type OsmWay } from "./transitGraphIngest";
import { parseOsmXml } from "./parsers/osmXml";
import { save, load } from "./transitGraphStore";

// ── Fixture: a small hand-built OSM extract ─────────────────────────────────────────────
//
// Lines:
//  - R1 Tokaido Shinkansen (route=train, service=high_speed): tokyoA -> nagoya
//  - R2 Marunouchi Line (route=subway): tokyoB -> otemachi
//  - R3 Yamanote Line (route=train, no service tag): tokyoA -> kanda
//  - R4 Toei Bus 1 (route=bus): must be fully excluded
//  - R6 Shibuya JR (route=train): shibuyaJR -> harajuku
//  - R7 Shibuya Metro (route=monorail): shibuyaMetro -> meijijingumae
//  - R8 Shinjuku JR (route=train): shinjukuA -> minamiShinjuku
//  - R9 Shinjuku Metro (route=subway): shinjukuB -> yoyogi
//  - R10 Osaka decoy (route=train), station also named "Shinjuku" but far away in Osaka
//
// Groupings:
//  - R5 stop_area "Tokyo Station" joins tokyoA + tokyoB -> merges R1:tokyoA, R3:tokyoA, R2:tokyoB
//  - Area A (members: shibuyaJR, harajuku) + Area B (members: shibuyaMetro), absorbed into
//    Group G (stop_area_group over A + B) -> one merged "Shibuya" cluster, Area A never emitted
//    separately despite having 2+ members on its own.
//  - shinjukuA/shinjukuB have no grouping relation at all -> must cluster via the proximity +
//    normalized-name fallback; the Osaka decoy shares the name but is far away -> must NOT join.

const nodes: OsmNode[] = [
  { id: "tokyoA", lat: 35.6812, lon: 139.7671, tags: { name: "Tokyo" } },
  { id: "tokyoB", lat: 35.6812, lon: 139.7671, tags: { name: "Tokyo" } },
  { id: "nagoya", lat: 35.1709, lon: 136.8815, tags: { name: "Nagoya" } },
  { id: "kanda", lat: 35.6918, lon: 139.7708, tags: { name: "Kanda" } },
  { id: "otemachi", lat: 35.687, lon: 139.7645, tags: { name: "Otemachi" } },
  { id: "busStop1", lat: 35.6812, lon: 139.7671, tags: { name: "Tokyo Bus Stop" } },
  { id: "busStop2", lat: 35.6918, lon: 139.7708, tags: { name: "Kanda Bus Stop" } },
  { id: "shibuyaJR", lat: 35.658, lon: 139.7016, tags: { name: "Shibuya" } },
  { id: "harajuku", lat: 35.6702, lon: 139.7027, tags: { name: "Harajuku" } },
  { id: "shibuyaMetro", lat: 35.6581, lon: 139.7017, tags: { name: "Shibuya" } },
  { id: "meijijingumae", lat: 35.6703, lon: 139.7038, tags: { name: "Meiji-jingumae" } },
  { id: "shinjukuA", lat: 35.6896, lon: 139.7006, tags: { name: "Shinjuku" } },
  { id: "minamiShinjuku", lat: 35.6851, lon: 139.7013, tags: { name: "Minami-Shinjuku" } },
  { id: "shinjukuB", lat: 35.69, lon: 139.7005, tags: { name: "SHINJUKU " } },
  { id: "yoyogi", lat: 35.6828, lon: 139.7021, tags: { name: "Yoyogi" } },
  { id: "shinjukuOsaka", lat: 34.6937, lon: 135.5023, tags: { name: "Shinjuku" } },
  { id: "osakaNext", lat: 34.7, lon: 135.51, tags: { name: "Osaka Next" } },
  // A second, unclustered Tokyo/Nagoya pair (same coordinates as tokyoA/nagoya, distinct ids) for
  // the `duration`-based classification fixtures below — kept off tokyoA/nagoya deliberately so
  // reusing this pair across several relations can't pull extra stop nodes into the R5 stop_area
  // cluster asserted above.
  { id: "tokyoC", lat: 35.6812, lon: 139.7671, tags: { name: "Tokyo" } },
  { id: "nagoyaC", lat: 35.1709, lon: 136.8815, tags: { name: "Nagoya" } },
];

function route(id: string, name: string, routeValue: string, stopIds: string[], extraTags: Record<string, string> = {}): OsmRelation {
  return {
    id,
    tags: { route: routeValue, name, ...extraTags },
    members: stopIds.map((ref) => ({ type: "node", ref, role: "stop" })),
  };
}

const relations: OsmRelation[] = [
  route("R1", "Tokaido Shinkansen", "train", ["tokyoA", "nagoya"], { service: "high_speed" }),
  route("R2", "Marunouchi Line", "subway", ["tokyoB", "otemachi"]),
  route("R3", "Yamanote Line", "train", ["tokyoA", "kanda"]),
  route("R4", "Toei Bus 1", "bus", ["busStop1", "busStop2"]),
  // Same Tokyo-Nagoya distance as R1 (~268 km), but no `service` tag — real Japanese Shinkansen/
  // limited-express relations mostly don't carry one (issue #192). Only `duration` distinguishes
  // these three from each other and from R3's plain commuter hop above.
  route("R11", "Nozomi (no service tag)", "train", ["tokyoC", "nagoyaC"], { duration: "1:00" }),
  route("R12", "Odoriko (no service tag)", "train", ["tokyoC", "nagoyaC"], { duration: "3:00" }),
  route("R13", "Slow local (no service tag)", "train", ["tokyoC", "nagoyaC"], { duration: "10:00" }),
  route("R14", "Malformed duration", "train", ["tokyoC", "nagoyaC"], { duration: "not-a-duration" }),
  route("R6", "Shibuya JR", "train", ["shibuyaJR", "harajuku"]),
  route("R7", "Shibuya Metro", "monorail", ["shibuyaMetro", "meijijingumae"]),
  route("R8", "Shinjuku JR", "train", ["shinjukuA", "minamiShinjuku"]),
  route("R9", "Shinjuku Metro", "subway", ["shinjukuB", "yoyogi"]),
  route("R10", "Osaka Decoy Line", "train", ["shinjukuOsaka", "osakaNext"]),
  {
    id: "R5",
    tags: { public_transport: "stop_area", name: "Tokyo Station" },
    members: [
      { type: "node", ref: "tokyoA", role: "stop" },
      { type: "node", ref: "tokyoB", role: "stop" },
    ],
  },
  {
    id: "AreaA",
    tags: { public_transport: "stop_area", name: "Shibuya JR side" },
    members: [
      { type: "node", ref: "shibuyaJR", role: "stop" },
      { type: "node", ref: "harajuku", role: "stop" },
    ],
  },
  {
    id: "AreaB",
    tags: { public_transport: "stop_area", name: "Shibuya Metro side" },
    members: [{ type: "node", ref: "shibuyaMetro", role: "stop" }],
  },
  {
    id: "GroupShibuya",
    tags: { public_transport: "stop_area_group", name: "Shibuya" },
    members: [
      { type: "relation", ref: "AreaA", role: "" },
      { type: "relation", ref: "AreaB", role: "" },
    ],
  },
];

const graph = buildTransitGraph(nodes, [], relations);

// ── Ride edges follow the ordered stop sequence with real distances ──
assert.ok(graph.stopNodes.has("R1:tokyoA"), "Shinkansen stop node created");
assert.ok(graph.stopNodes.has("R1:nagoya"), "Shinkansen stop node created");
const shinkansenEdge = graph.rideEdges.find((e) => e.fromStopId === "R1:tokyoA" && e.toStopId === "R1:nagoya");
assert.ok(shinkansenEdge, "ride edge follows the relation's member order");
assert.ok(
  shinkansenEdge!.distanceMeters > 250_000 && shinkansenEdge!.distanceMeters < 280_000,
  "Tokyo-Nagoya ride edge carries the real haversine distance, not a placeholder"
);
assert.equal(graph.stopNodes.get("R1:tokyoA")!.lineType, "shinkansen", "route=train + service=high_speed -> shinkansen");
assert.equal(graph.stopNodes.get("R2:tokyoB")!.lineType, "subway", "route=subway -> subway");
assert.equal(graph.stopNodes.get("R3:tokyoA")!.lineType, "commuter", "plain route=train, no duration tag -> commuter");
assert.equal(graph.stopNodes.get("R7:shibuyaMetro")!.lineType, "commuter", "route=monorail -> commuter");

// ── Classification falls back to implied average speed (`duration` ÷ distance) when `service`
// is absent, per ADR-0019's own fix (issue #192) — same ~268 km Tokyo-Nagoya hop as R1, unlabeled ──
assert.equal(
  graph.stopNodes.get("R11:tokyoC")!.lineType,
  "shinkansen",
  "no service tag, but 268 km in 1:00 (~268 km/h, over the 150 km/h threshold) -> shinkansen"
);
assert.equal(
  graph.stopNodes.get("R12:tokyoC")!.lineType,
  "limitedExpress",
  "no service tag, 268 km in 3:00 (~89 km/h, between the two thresholds) -> limitedExpress"
);
assert.equal(
  graph.stopNodes.get("R13:tokyoC")!.lineType,
  "commuter",
  "no service tag, 268 km in 10:00 (~27 km/h, under both thresholds) -> commuter"
);
assert.equal(
  graph.stopNodes.get("R14:tokyoC")!.lineType,
  "commuter",
  "an unparseable duration tag is not guessed at -> commuter, same as no tag at all"
);
assert.equal(graph.stopNodes.get("R1:tokyoA")!.sequence, 0, "first member sequenced 0");
assert.equal(graph.stopNodes.get("R1:nagoya")!.sequence, 1, "second member sequenced 1");

// ── Buses excluded entirely ──
assert.ok(!graph.stopNodes.has("R4:busStop1"), "bus route produces no stop nodes");
assert.equal(graph.rideEdges.some((e) => e.fromStopId.startsWith("R4:")), false, "bus route produces no ride edges");

// ── Clusters form from stop_area / stop_area_group relations ──
const tokyoCluster = [...graph.clusters.values()].find((c) => c.id === "R5");
assert.ok(tokyoCluster, "stop_area relation becomes a cluster");
assert.deepEqual(
  new Set(tokyoCluster!.stopNodeIds),
  new Set(["R1:tokyoA", "R3:tokyoA", "R2:tokyoB"]),
  "cluster joins every stop node whose raw OSM node the stop_area references, across lines"
);

// ── Issue #159: no transfer edge between two stop nodes at the same raw OSM node ──
// R1:tokyoA (Shinkansen) and R3:tokyoA (Yamanote) both sit on raw node "tokyoA" — two route
// relations sharing one physical point, exactly the through-running/direction-split shape that
// used to charge a phantom 5-minute "transfer" for staying put. R2:tokyoB sits on a genuinely
// different raw node ("tokyoB") in the same cluster, so it's a real interchange and keeps its edge.
const hasTransferEdge = (a: string, b: string) =>
  graph.transferEdges.some(
    (e) => (e.fromStopId === a && e.toStopId === b) || (e.fromStopId === b && e.toStopId === a)
  );
assert.equal(
  hasTransferEdge("R1:tokyoA", "R3:tokyoA"),
  false,
  "same raw OSM node -> no transfer edge, not a real interchange"
);
assert.ok(
  hasTransferEdge("R1:tokyoA", "R2:tokyoB"),
  "different raw OSM nodes in one cluster -> still a real transfer edge"
);
assert.ok(
  hasTransferEdge("R3:tokyoA", "R2:tokyoB"),
  "different raw OSM nodes in one cluster -> still a real transfer edge"
);
assert.equal(
  graph.stopNodes.get("R1:tokyoA")!.osmNodeId,
  "tokyoA",
  "a stop node records the raw OSM node it sits at"
);

const shibuyaCluster = [...graph.clusters.values()].find((c) => c.id === "GroupShibuya");
assert.ok(shibuyaCluster, "stop_area_group relation becomes a merged cluster");
assert.deepEqual(
  new Set(shibuyaCluster!.stopNodeIds),
  new Set(["R6:shibuyaJR", "R6:harajuku", "R7:shibuyaMetro"]),
  "group cluster unions its member stop_areas' stop nodes"
);
assert.ok(
  ![...graph.clusters.values()].some((c) => c.id === "AreaA"),
  "an absorbed stop_area is not also emitted as its own separate cluster"
);

// ── Proximity + normalized-name fallback clusters co-located same-name stops ──
const shinjukuCluster = [...graph.clusters.values()].find(
  (c) => c.stopNodeIds.includes("R8:shinjukuA") && c.stopNodeIds.includes("R9:shinjukuB")
);
assert.ok(shinjukuCluster, "two same-name, nearby, ungrouped stop nodes cluster via the fallback");
assert.equal(shinjukuCluster!.stopNodeIds.length, 2, "the fallback cluster holds exactly the matching pair");
assert.ok(
  !shinjukuCluster!.stopNodeIds.includes("R10:shinjukuOsaka"),
  "a same-name stop far outside the fallback radius does not join"
);
assert.ok(
  ![...graph.clusters.values()].some((c) => c.stopNodeIds.includes("R10:shinjukuOsaka")),
  "the distant same-name decoy forms no cluster of its own (only one lone stop with that name there)"
);

console.log("transitGraphIngest Seam 2 tests: OK");

// ── Pipeline smoke test (not Seam 2 — exercises real XML parsing + a real SQLite file) ──
// Demonstrates the full chain a real ingestion run takes: OSM XML text -> parseOsmXml ->
// buildTransitGraph -> save() -> a plain-SQL-queryable db/transit-japan.db.
const osmXml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="smoke1" lat="35.6812" lon="139.7671">
    <tag k="name" v="Tokyo"/>
  </node>
  <node id="smoke2" lat="35.6918" lon="139.7708">
    <tag k="name" v="Kanda"/>
  </node>
  <node id="smokeMid" lat="35.6870" lon="139.7690"/>
  <way id="smokeW1">
    <nd ref="smoke1"/>
    <nd ref="smokeMid"/>
    <nd ref="smoke2"/>
  </way>
  <relation id="smokeR1">
    <tag k="route" v="train"/>
    <tag k="name" v="Smoke Line"/>
    <member type="node" ref="smoke1" role="stop"/>
    <member type="node" ref="smoke2" role="stop"/>
    <member type="way" ref="smokeW1" role=""/>
  </relation>
</osm>`;

const { nodes: smokeNodes, ways: smokeWays, relations: smokeRelations } = parseOsmXml(osmXml);
assert.equal(smokeWays.length, 1, "parseOsmXml now returns way elements");
assert.deepEqual(smokeWays[0].nodeRefs, ["smoke1", "smokeMid", "smoke2"], "a way's node refs survive parsing, in order");
const smokeGraph = buildTransitGraph(smokeNodes, smokeWays, smokeRelations);
assert.equal(smokeGraph.stopNodes.size, 2, "the XML-parsed fixture yields the expected stop nodes");
assert.equal(smokeGraph.rideEdges[0].geometry?.coordinates.length, 3, "the ride edge carries the traced track, untagged vertex included");

const smokeDir = fs.mkdtempSync(path.join(tmpdir(), "tk-ingest-smoke-"));
const smokeDbPath = path.join(smokeDir, "transit-japan.db");
save(smokeGraph, smokeDbPath);

const sqlite = new Database(smokeDbPath, { readonly: true });
const rows = sqlite.prepare("SELECT stationName FROM StopNode ORDER BY sequence").all() as { stationName: string }[];
const blob = sqlite.prepare("SELECT geometry, tracedLengthMeters FROM RideEdge").get() as {
  geometry: Buffer | null;
  tracedLengthMeters: number | null;
};
sqlite.close();
assert.deepEqual(rows.map((r) => r.stationName), ["Tokyo", "Kanda"], "db/transit-japan.db is inspectable with plain SQL after ingestion");
assert.ok(blob.geometry instanceof Buffer && blob.geometry.length > 0, "geometry reaches the file as a BLOB");
assert.ok((blob.tracedLengthMeters ?? 0) > 0, "traced track length is stored beside it");

fs.rmSync(smokeDir, { recursive: true, force: true });

console.log("transitGraphIngest pipeline smoke test: OK");

// ── Regression (issue #88's manual eval against a real Geofabrik extract): fast-xml-parser's
// entity-expansion guard defaults to 1000 total expansions — a billion-laughs safeguard sized for
// arbitrary untrusted input — and parsing the real, pinned Japan extract during #88's eval threw
// exactly this error ("Entity expansion limit exceeded: 1001 > 1000") on real data, which is not
// untrusted input (a trusted Geofabrik snapshot), just large. A DOCTYPE-declared entity referenced
// past the default ceiling reproduces the identical failure/limit on a small fixture (plain
// `&amp;`-style predefined entities in attribute values didn't reproduce it in isolation — the
// real file's trigger wasn't isolated further — but this exercises the same counter and the same
// guard `parseOsmXml`'s raised `maxTotalExpansions`/`maxExpandedLength` must tolerate).
const manyEntityXml =
  `<?xml version="1.0"?><!DOCTYPE osm [<!ENTITY amp2 "AB">]><osm>` +
  Array.from({ length: 1200 }, (_, i) => `<node id="${i}" lat="35.0" lon="139.0"><tag k="name" v="&amp2;"/></node>`).join("") +
  `</osm>`;
const { nodes: manyEntityParsed } = parseOsmXml(manyEntityXml);
assert.equal(manyEntityParsed.length, 1200, "parseOsmXml tolerates entity expansion past the library's default 1000-expansion ceiling");
assert.equal(manyEntityParsed[0].tags.name, "AB", "the DOCTYPE entity still decodes correctly past the raised ceiling");

console.log("transitGraphIngest entity-expansion regression: OK");

// ── Rail geometry tracing (ADR-0030 §1–§3) ──────────────────────────────────────────────
//
// Five relations, each isolating one thing the assembler has to get right. Every figure the ADR
// gates on was measured nationally (research §C7); these fixtures assert the *mechanism* those
// figures describe, at a size a human can check by hand.

const geoNodes: OsmNode[] = [
  // A closed loop: four corners of a square, ~1.1 km on a side.
  { id: "L0", lat: 35.68, lon: 139.76, tags: { name: "Loop A" } },
  { id: "L1", lat: 35.69, lon: 139.76, tags: { name: "Loop B" } },
  { id: "L2", lat: 35.69, lon: 139.77, tags: { name: "Loop C" } },
  { id: "L3", lat: 35.68, lon: 139.77, tags: { name: "Loop D" } },
  // Two ways that do not meet: D1 and D2 are 2 km apart and share no node.
  { id: "D0", lat: 35.60, lon: 139.60, tags: { name: "Gap A" } },
  { id: "D1", lat: 35.61, lon: 139.60, tags: {} },
  { id: "D2", lat: 35.63, lon: 139.60, tags: { name: "Gap B" } },
  { id: "D3", lat: 35.64, lon: 139.60, tags: { name: "Gap C" } },
  // Straight track, with two stations that are not vertices of it.
  { id: "T0", lat: 35.70, lon: 139.80, tags: { name: "Track A" } },
  { id: "T1", lat: 35.70, lon: 139.81, tags: {} },
  { id: "T2", lat: 35.70, lon: 139.82, tags: { name: "Track B" } },
  { id: "Snapped", lat: 35.7005, lon: 139.81, tags: { name: "Beside The Tracks" } },
  { id: "TooFar", lat: 35.72, lon: 139.81, tags: { name: "Two Km Away" } },
  // A way declared against the direction of travel.
  { id: "V0", lat: 35.50, lon: 139.50, tags: { name: "Rev A" } },
  { id: "V1", lat: 35.51, lon: 139.50, tags: {} },
  { id: "V2", lat: 35.52, lon: 139.50, tags: { name: "Rev B" } },
  // A whole chain running against the line's stop order.
  { id: "B0", lat: 35.40, lon: 139.40, tags: { name: "Back A" } },
  { id: "B1", lat: 35.41, lon: 139.40, tags: {} },
  { id: "B2", lat: 35.42, lon: 139.40, tags: { name: "Back B" } },
  // A lasso: a stem out to P1, then a loop P1 -> P2 -> P3 -> P1. Not a closed chain.
  { id: "P0", lat: 35.30, lon: 139.30, tags: { name: "Lasso Stem" } },
  { id: "P1", lat: 35.31, lon: 139.30, tags: { name: "Lasso Junction" } },
  { id: "P2", lat: 35.32, lon: 139.30, tags: { name: "Lasso B" } },
  { id: "P3", lat: 35.32, lon: 139.31, tags: { name: "Lasso C" } },
  // A stop order the chain cannot explain: the route claims to run Q0 -> Q2 -> Q1.
  { id: "Q0", lat: 35.20, lon: 139.20, tags: { name: "Skip A" } },
  { id: "Q1", lat: 35.21, lon: 139.20, tags: { name: "Skip B" } },
  { id: "Q2", lat: 35.22, lon: 139.20, tags: { name: "Skip C" } },
];

const geoWays: OsmWay[] = [
  { id: "WL1", nodeRefs: ["L0", "L1", "L2"] },
  { id: "WL2", nodeRefs: ["L2", "L3", "L0"] },
  { id: "WD1", nodeRefs: ["D0", "D1"] },
  { id: "WD2", nodeRefs: ["D2", "D3"] },
  { id: "WT", nodeRefs: ["T0", "T1", "T2"] },
  { id: "WV1", nodeRefs: ["V1", "V0"] }, // laid backwards on purpose
  { id: "WV2", nodeRefs: ["V1", "V2"] },
  { id: "WB", nodeRefs: ["B0", "B1", "B2"] },
  { id: "WP1", nodeRefs: ["P0", "P1"] },
  { id: "WP2", nodeRefs: ["P1", "P2", "P3", "P1"] },
  { id: "WQ", nodeRefs: ["Q0", "Q1", "Q2"] },
];

function tracedRoute(id: string, name: string, stopIds: string[], wayIds: string[]): OsmRelation {
  return {
    id,
    tags: { route: "train", name },
    members: [
      ...stopIds.map((ref) => ({ type: "node" as const, ref, role: "stop" })),
      ...wayIds.map((ref) => ({ type: "way" as const, ref, role: "" })),
    ],
  };
}

const geoGraph = buildTransitGraph(geoNodes, geoWays, [
  // The relation lists its first station again at the end, which is what makes the last hop close
  // the loop — and what a naive index-based cut traces the long way round.
  tracedRoute("RLoop", "Loop Line", ["L0", "L1", "L2", "L3", "L0"], ["WL1", "WL2"]),
  tracedRoute("RGap", "Gap Line", ["D0", "D2", "D3"], ["WD1", "WD2"]),
  tracedRoute("RSnap", "Snap Line", ["T0", "Snapped", "T2"], ["WT"]),
  tracedRoute("RFar", "Far Line", ["T0", "TooFar"], ["WT"]),
  tracedRoute("RRev", "Reversed Line", ["V0", "V2"], ["WV1", "WV2"]),
  tracedRoute("RBack", "Backwards Line", ["B2", "B1", "B0"], ["WB"]),
  tracedRoute("RLasso", "Lasso Line", ["P0", "P1", "P2", "P3", "P1"], ["WP1", "WP2"]),
  tracedRoute("RSkip", "Unexplainable Line", ["Q0", "Q2", "Q1"], ["WQ"]),
]);

const edgeOf = (from: string, to: string) =>
  geoGraph.rideEdges.find((e) => e.fromStopId === from && e.toStopId === to);

// A clean trace keeps the track's own vertices, so it is longer than the chord between stations.
const revEdge = edgeOf("RRev:V0", "RRev:V2");
assert.ok(revEdge?.geometry, "a way declared backwards still assembles — its orientation is inferred from its neighbour");
assert.deepEqual(
  revEdge!.geometry!.coordinates,
  [[139.5, 35.5], [139.5, 35.51], [139.5, 35.52]],
  "the reversed way is flipped into travel order, intermediate vertex included"
);

// §2: the hop that closes a loop is cut the short way round, not the long way.
const closingHop = edgeOf("RLoop:L3", "RLoop:L0");
assert.ok(closingHop?.geometry, "the loop's closing hop is traced, not refused");
assert.equal(closingHop!.geometry!.coordinates.length, 2, "the closing hop is one side of the square, not three");
assert.ok(
  Math.abs(closingHop!.tracedLengthMeters! - closingHop!.distanceMeters) < 1,
  "the closing hop's traced length matches its chord — the long way round would be ~3x"
);
assert.ok(edgeOf("RLoop:L0", "RLoop:L1")?.geometry, "the loop's other hops trace normally");

// §1: a segment built across a known discontinuity gets no geometry — and only that segment.
assert.equal(edgeOf("RGap:D0", "RGap:D2")?.geometry, undefined, "the hop spanning the gap is refused");
assert.equal(edgeOf("RGap:D0", "RGap:D2")?.tracedLengthMeters, undefined, "a refused hop stores no length either");
assert.ok(edgeOf("RGap:D2", "RGap:D3")?.geometry, "the hop on the far side of the gap still traces");

// §3: a station beside the tracks is cut at the nearest point on the chain, within the radius.
const snapped = edgeOf("RSnap:T0", "RSnap:Snapped");
assert.ok(snapped?.geometry, "a station that is not a vertex of the track snaps onto it");
const snapEnd = snapped!.geometry!.coordinates[snapped!.geometry!.coordinates.length - 1];
assert.ok(Math.abs(snapEnd[1] - 35.70) < 1e-9, "the cut lands on the track, not at the station's own coordinates");
assert.ok(Math.abs(snapEnd[0] - 139.81) < 1e-6, "and at the nearest point along it");
assert.ok(edgeOf("RSnap:Snapped", "RSnap:T2")?.geometry, "the segment on the far side of the snap traces too");

// Beyond the radius the same mechanism refuses rather than dragging the cut somewhere arbitrary.
assert.equal(edgeOf("RFar:T0", "RFar:TooFar")?.geometry, undefined, "a station 2 km off the track is out of snap range");

// A chain assembled against the line's stop order is turned around once, before any cutting, so
// every hop traces forward. Deciding this per line rather than per segment is what keeps the lasso
// case below from being mistaken for it.
const backEdge = edgeOf("RBack:B2", "RBack:B1");
assert.ok(backEdge?.geometry, "a chain running against stop order is reversed once and still traces");
assert.deepEqual(
  backEdge!.geometry!.coordinates,
  [[139.4, 35.42], [139.4, 35.41]],
  "and traces in travel order, not chain order"
);

// A lasso — a stem out to a junction, then a loop back to it. The junction is two vertices of the
// chain, not one, and the return hop is the second. Taking the first instead traces the entire
// outbound journey: measured at 4.70 km for a 0.45 km hop on 山万ユーカリが丘線.
assert.ok(edgeOf("RLasso:P0", "RLasso:P1")?.geometry, "the lasso's stem traces");
assert.ok(edgeOf("RLasso:P2", "RLasso:P3")?.geometry, "and so does the loop's forward run");
const lassoClose = edgeOf("RLasso:P3", "RLasso:P1");
assert.ok(lassoClose?.geometry, "the hop returning to the junction traces");
assert.equal(lassoClose!.geometry!.coordinates.length, 2, "as the single hop actually ridden, not the whole loop");
assert.ok(
  Math.abs(lassoClose!.tracedLengthMeters! - lassoClose!.distanceMeters) < 1,
  "so its traced length matches its chord"
);

// A hop the chain genuinely cannot explain — the stop order skips ahead and doubles back, and no
// forward run of track connects the pair. Slicing it anyway and reversing is what traced 25.3 km
// for a 1.0 km hop on 名古屋市営名城線. §1's answer stands: we do not know it, so we do not draw it.
assert.ok(edgeOf("RSkip:Q0", "RSkip:Q2")?.geometry, "the explainable hop still traces");
assert.equal(edgeOf("RSkip:Q2", "RSkip:Q1")?.geometry, undefined, "the backwards hop is refused, not reversed");

// §4: geometry never touches cost. Every edge's distance is still the station-to-station chord.
for (const edge of geoGraph.rideEdges) {
  assert.ok(edge.distanceMeters > 0, "every ride edge still carries a haversine distance");
}

console.log("transitGraphIngest rail geometry tests: OK");

// ── Operator capture (issue #210) ───────────────────────────────────────────────────────
//
// Every case below is grounded in a real measurement against the pinned 260101 extract (issue
// #204, re-verified while building this ticket), not a hypothetical: the alias spellings, the
// two non-JR near-misses, and the untagged-premium-line list are all real OSM data, not invented
// edge cases.

const opNodes: OsmNode[] = [
  { id: "opA0", lat: 35.0, lon: 139.0, tags: { name: "Op A0" } },
  { id: "opA1", lat: 35.01, lon: 139.0, tags: { name: "Op A1" } },
  { id: "opB0", lat: 35.1, lon: 139.1, tags: { name: "Op B0" } },
  { id: "opB1", lat: 35.11, lon: 139.1, tags: { name: "Op B1" } },
];

// `name` defaults to the relation id itself so the untagged-premium-backstop tests below can use
// real allowlisted lineNames ("Kagayaki", "Hakutaka") directly as both id and name.
function opRoute(id: string, stopIds: string[], extraTags: Record<string, string>, name: string = id): OsmRelation {
  return route(id, name, "train", stopIds, extraTags);
}

function operatorOfLine(graph: ReturnType<typeof buildTransitGraph>, relationId: string): string | undefined {
  return [...graph.stopNodes.values()].find((s) => s.lineId === relationId)?.operator;
}

// Six real JR East spellings measured in the extract all canonicalize identically.
for (const [tagId, raw] of [
  ["JrE1", "東日本旅客鉄道"],
  ["JrE2", "JR東日本"],
  ["JrE3", "東日本旅客鉄道株式会社"],
  ["JrE4", "東日本旅客鉄道 (JR East)"],
  ["JrE5", "JR East"],
] as const) {
  const g = buildTransitGraph(opNodes, [], [opRoute(tagId, ["opA0", "opA1"], { operator: raw })]);
  assert.equal(operatorOfLine(g, tagId), "JR East", `"${raw}" canonicalizes to "JR East"`);
}

// One spot check per remaining JR company.
for (const [tagId, raw, company] of [
  ["JrW", "西日本旅客鉄道", "JR West"],
  ["JrC", "東海旅客鉄道", "JR Central"],
  ["JrK", "JR Kyushu", "JR Kyushu"],
  ["JrH", "北海道旅客鉄道", "JR Hokkaido"],
  ["JrS", "四国旅客鉄道", "JR Shikoku"],
] as const) {
  const g = buildTransitGraph(opNodes, [], [opRoute(tagId, ["opA0", "opA1"], { operator: raw })]);
  assert.equal(operatorOfLine(g, tagId), company, `"${raw}" canonicalizes to "${company}"`);
}

// A JR-tagged relation with no recognizable company sub-string (a mistagged line name, not a
// company name — "JR東北線" measured directly in the extract) keeps its raw tag rather than guess.
{
  const g = buildTransitGraph(opNodes, [], [opRoute("JrMistag", ["opA0", "opA1"], { operator: "JR東北線" })]);
  assert.equal(operatorOfLine(g, "JrMistag"), "JR東北線", "an unrecognized JR-group tag is kept raw, not guessed at");
}

// A `;`-joined multi-operator through-service takes the *first* listed operator (ADR-0022's
// boarding-operator rule, applied at ingest) — in both directions: JR-first...
{
  const g = buildTransitGraph(
    opNodes, [],
    [opRoute("ThroughJrFirst", ["opA0", "opA1"], { operator: "東日本旅客鉄道;東京地下鉄" })]
  );
  assert.equal(operatorOfLine(g, "ThroughJrFirst"), "JR East", "JR-first through-service takes the boarding (first) operator");
}
// ...and non-JR-first, even though the line genuinely touches JR Central track further along —
// this is the operator-boundary-within-a-line simplification #140's grilling session left open.
{
  const g = buildTransitGraph(
    opNodes, [],
    [opRoute("ThroughNonJrFirst", ["opA0", "opA1"], { operator: "小田急電鉄;東海旅客鉄道" })]
  );
  assert.equal(operatorOfLine(g, "ThroughNonJrFirst"), "小田急電鉄", "non-JR-first through-service is not classified JR");
}

// A plain non-JR operator tag is stored as its raw first-listed value — no canonicalization
// attempted, since nothing downstream needs one yet.
{
  const g = buildTransitGraph(opNodes, [], [opRoute("Kintetsu", ["opA0", "opA1"], { operator: "近畿日本鉄道" })]);
  assert.equal(operatorOfLine(g, "Kintetsu"), "近畿日本鉄道", "a non-JR operator tag is kept raw");
}

// Two real near-misses a looser regional-name match would wrongly classify as JR: 西日本鉄道
// (Nishitetsu, shares "西日本" with JR West's 西日本旅客鉄道 but is a private Kyushu railway) and
// 東海交通事業 (shares "東海" with JR Central's 東海旅客鉄道 but is a separate private operator).
{
  const g = buildTransitGraph(opNodes, [], [
    opRoute("Nishitetsu", ["opA0", "opA1"], { operator: "西日本鉄道" }),
    opRoute("TokaiKotsu", ["opB0", "opB1"], { operator: "東海交通事業" }),
  ]);
  assert.equal(operatorOfLine(g, "Nishitetsu"), "西日本鉄道", "Nishitetsu is not misclassified as JR West");
  assert.equal(operatorOfLine(g, "TokaiKotsu"), "東海交通事業", "Tokai Kotsu Jigyo is not misclassified as JR Central");
}

// The untagged-premium-line backstop (#204: 16 of 35 premium relations in the extract carry no
// operator tag at all, 14 of them genuine JR Shinkansen) — allowlisted names get "JR"...
{
  const g = buildTransitGraph(opNodes, [], [
    opRoute("Kagayaki", ["opA0", "opA1"], { service: "long_distance" }), // no operator tag
    opRoute("Hakutaka", ["opB0", "opB1"], { service: "long_distance" }),
  ]);
  assert.equal(operatorOfLine(g, "Kagayaki"), "JR", "an untagged, allowlisted premium lineName backstops to JR");
  assert.equal(operatorOfLine(g, "Hakutaka"), "JR", "an untagged, allowlisted premium lineName backstops to JR");
}
// ...but an untagged premium line NOT on the allowlist stays genuinely unknown — the real trap
// #204 flagged: 直通特急 (Osaka Umeda <-> Sanyo-Himeji) is premium and untagged, but is the
// Hanshin/Sanyo Electric Railway limited express, not JR, and must not be swept in with the rest.
{
  const g = buildTransitGraph(opNodes, [], [
    opRoute("直通特急", ["opA0", "opA1"], { service: "long_distance" }), // no operator tag, not allowlisted
  ]);
  assert.equal(operatorOfLine(g, "直通特急"), undefined, "a non-allowlisted untagged premium line stays unknown, not JR");
}
// The backstop only ever applies to premium lineTypes — an untagged ordinary commuter line stays
// unknown even if some other line happened to share its name (never true in the real extract, but
// the boundary itself is the thing under test).
{
  const g = buildTransitGraph(opNodes, [], [opRoute("Kagayaki-Commuter", ["opA0", "opA1"], {})]); // no service/duration -> commuter
  assert.equal(operatorOfLine(g, "Kagayaki-Commuter"), undefined, "the untagged-premium backstop does not apply outside premium lineTypes");
}

// Round-trips through the SQLite store: a defined operator survives save/load, and a genuinely
// unknown one comes back `undefined`, not the string `"null"` or an empty string.
{
  const roundTripGraph = buildTransitGraph(opNodes, [], [
    opRoute("RtJr", ["opA0", "opA1"], { operator: "JR East" }),
    opRoute("RtUnknown", ["opB0", "opB1"], {}),
  ]);
  const dbPath = path.join(tmpdir(), `transit-operator-roundtrip-${Date.now()}.db`);
  save(roundTripGraph, dbPath);
  const { graph: loaded } = load(dbPath);
  fs.rmSync(dbPath, { force: true });
  assert.equal(operatorOfLine(loaded, "RtJr"), "JR East", "a defined operator survives a save/load round-trip");
  assert.equal(operatorOfLine(loaded, "RtUnknown"), undefined, "an unknown operator round-trips as undefined, not a string");
}

console.log("transitGraphIngest operator capture tests: OK");
