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
import { buildTransitGraph, type OsmNode, type OsmRelation } from "./transitGraphIngest";
import { parseOsmXml } from "./parsers/osmXml";
import { save } from "./transitGraphStore";

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

const graph = buildTransitGraph(nodes, relations);

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
assert.equal(graph.stopNodes.get("R3:tokyoA")!.lineType, "commuter", "plain route=train -> commuter");
assert.equal(graph.stopNodes.get("R7:shibuyaMetro")!.lineType, "commuter", "route=monorail -> commuter");
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
  <relation id="smokeR1">
    <tag k="route" v="train"/>
    <tag k="name" v="Smoke Line"/>
    <member type="node" ref="smoke1" role="stop"/>
    <member type="node" ref="smoke2" role="stop"/>
  </relation>
</osm>`;

const { nodes: smokeNodes, relations: smokeRelations } = parseOsmXml(osmXml);
const smokeGraph = buildTransitGraph(smokeNodes, smokeRelations);
assert.equal(smokeGraph.stopNodes.size, 2, "the XML-parsed fixture yields the expected stop nodes");

const smokeDir = fs.mkdtempSync(path.join(tmpdir(), "tk-ingest-smoke-"));
const smokeDbPath = path.join(smokeDir, "transit-japan.db");
save(smokeGraph, smokeDbPath);

const sqlite = new Database(smokeDbPath, { readonly: true });
const rows = sqlite.prepare("SELECT stationName FROM StopNode ORDER BY sequence").all() as { stationName: string }[];
sqlite.close();
assert.deepEqual(rows.map((r) => r.stationName), ["Tokyo", "Kanda"], "db/transit-japan.db is inspectable with plain SQL after ingestion");

fs.rmSync(smokeDir, { recursive: true, force: true });

console.log("transitGraphIngest pipeline smoke test: OK");
