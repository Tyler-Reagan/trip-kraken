/**
 * Ingestion CLI (ADR-0019, issue #87/J2) — the Node half of the offline pipeline
 * (Geofabrik extract → `osmium` rail filter → this script → `db/transit-japan.db`). Reads an
 * already-filtered OSM XML file (produced by `ingest-transit-graph.sh`'s `osmium` step, or any
 * hand-built fixture during development), runs it through the pure transform, and writes the
 * read-only graph file via `transitGraphStore.ts`'s `save()` — the same writer #84 built and #85's
 * provider reads back.
 *
 * Usage: tsx scripts/ingest-transit-graph.ts <filtered.osm> [outputDbPath]
 *
 * Dev-time only — never imported by app code, never run at request time.
 */

import fs from "node:fs";
import { parseOsmXml } from "@/lib/parsers/osmXml";
import { buildTransitGraph } from "@/lib/transitGraphIngest";
import { save, DEFAULT_GRAPH_PATH } from "@/lib/transitGraphStore";

function main() {
  const [inputPath, outputPath = DEFAULT_GRAPH_PATH] = process.argv.slice(2);
  if (!inputPath) {
    console.error(
      "Usage: tsx scripts/ingest-transit-graph.ts <filtered.osm> [outputDbPath]",
    );
    process.exit(1);
  }

  const xml = fs.readFileSync(inputPath, "utf-8");
  const { nodes, ways, relations } = parseOsmXml(xml);
  const graph = buildTransitGraph(nodes, ways, relations);
  // Which Extract built this file (ADR-0030 §6). The shell wrapper exports both from
  // `osm-snapshot.env`, the single place either pipeline's pin lives; a direct `tsx` run against a
  // hand-built fixture has no Extract behind it and records "unknown".
  save(graph, outputPath, {
    snapshotDate: process.env.OSM_SNAPSHOT ?? "unknown",
    region: process.env.OSM_RAIL_REGION ?? "unknown",
  });

  const traced = graph.rideEdges.filter((e) => e.geometry).length;
  console.log(
    `Ingested ${graph.stopNodes.size} stop nodes, ${graph.clusters.size} clusters, ` +
      `${graph.rideEdges.length} ride edges, ${graph.transferEdges.length} transfer edges → ${outputPath}`,
  );
  console.log(
    `Traced geometry for ${traced}/${graph.rideEdges.length} ride edges ` +
      `(${((traced / Math.max(1, graph.rideEdges.length)) * 100).toFixed(1)}%); ` +
      `${graph.rideEdges.length - traced} draw dashed (ADR-0030 §1/§3).`,
  );
}

main();
