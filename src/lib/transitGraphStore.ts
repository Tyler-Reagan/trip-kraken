/**
 * Read-only SQLite serialization of the transit graph (issue #84) — deliberately separate from
 * the app's Drizzle schema/migrations in `src/lib/db/`: this is regenerable reference data (an
 * offline ingestion pipeline's output) with a lifecycle independent of user data, not something
 * the app's schema evolution should ever touch. Opened with raw better-sqlite3, never
 * `getDrizzle()` — there is no ORM layer over this file, only save()/load().
 *
 * SQLite here is a serialization + inspection format, not a query engine: `load()` reads the
 * whole file into the in-memory `TransitGraph` (plus a spatial index) once, caches it on a
 * global singleton mirroring `db/client.ts`'s pattern, and every subsequent lookup runs against
 * memory.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createGraph,
  buildSpatialIndex,
  type TransitGraph,
  type SpatialIndex,
  type StopNode,
  type StationCluster,
  type RideEdge,
  type TransferEdge,
} from "./transitGraph";

export const DEFAULT_GRAPH_PATH = path.join(process.cwd(), "db", "transit-japan.db");

function createSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE stop_node (
      id TEXT PRIMARY KEY,
      lineId TEXT NOT NULL,
      lineName TEXT NOT NULL,
      stationName TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      sequence INTEGER NOT NULL
    );
    CREATE TABLE cluster (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE cluster_member (
      clusterId TEXT NOT NULL,
      stopNodeId TEXT NOT NULL
    );
    CREATE TABLE ride_edge (
      fromStopId TEXT NOT NULL,
      toStopId TEXT NOT NULL,
      distanceMeters REAL NOT NULL
    );
    CREATE TABLE transfer_edge (
      fromStopId TEXT NOT NULL,
      toStopId TEXT NOT NULL,
      clusterId TEXT NOT NULL
    );
  `);
}

/** Writes `graph` to `filePath`, replacing any existing file — the ingestion pipeline's output step. */
export function save(graph: TransitGraph, filePath: string = DEFAULT_GRAPH_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.rmSync(filePath, { force: true });

  const sqlite = new Database(filePath);
  try {
    createSchema(sqlite);
    const insertStop = sqlite.prepare(
      "INSERT INTO stop_node (id, lineId, lineName, stationName, lat, lng, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertCluster = sqlite.prepare("INSERT INTO cluster (id, name) VALUES (?, ?)");
    const insertMember = sqlite.prepare(
      "INSERT INTO cluster_member (clusterId, stopNodeId) VALUES (?, ?)"
    );
    const insertRide = sqlite.prepare(
      "INSERT INTO ride_edge (fromStopId, toStopId, distanceMeters) VALUES (?, ?, ?)"
    );
    const insertTransfer = sqlite.prepare(
      "INSERT INTO transfer_edge (fromStopId, toStopId, clusterId) VALUES (?, ?, ?)"
    );

    const writeAll = sqlite.transaction(() => {
      for (const stop of graph.stopNodes.values()) {
        insertStop.run(stop.id, stop.lineId, stop.lineName, stop.stationName, stop.lat, stop.lng, stop.sequence);
      }
      for (const cluster of graph.clusters.values()) {
        insertCluster.run(cluster.id, cluster.name);
        for (const stopNodeId of cluster.stopNodeIds) insertMember.run(cluster.id, stopNodeId);
      }
      for (const edge of graph.rideEdges) {
        insertRide.run(edge.fromStopId, edge.toStopId, edge.distanceMeters);
      }
      for (const edge of graph.transferEdges) {
        insertTransfer.run(edge.fromStopId, edge.toStopId, edge.clusterId);
      }
    });
    writeAll();
  } finally {
    sqlite.close();
  }
}

/** Reads `filePath` back into an in-memory `TransitGraph` + spatial index. Throws loudly (never
 * returns a silent empty graph) when the file is missing — a missing graph means ingestion was
 * never run, and every caller downstream needs to know that, not compute against nothing. */
export function load(filePath: string = DEFAULT_GRAPH_PATH): { graph: TransitGraph; spatialIndex: SpatialIndex } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`transit graph not ingested: ${filePath} does not exist`);
  }

  const sqlite = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const graph = createGraph();

    for (const row of sqlite.prepare("SELECT * FROM stop_node").all() as StopNode[]) {
      graph.stopNodes.set(row.id, row);
    }
    const clusterRows = sqlite.prepare("SELECT * FROM cluster").all() as { id: string; name: string }[];
    for (const row of clusterRows) {
      graph.clusters.set(row.id, { id: row.id, name: row.name, stopNodeIds: [] });
    }
    const memberRows = sqlite.prepare("SELECT * FROM cluster_member").all() as {
      clusterId: string;
      stopNodeId: string;
    }[];
    for (const row of memberRows) {
      graph.clusters.get(row.clusterId)?.stopNodeIds.push(row.stopNodeId);
    }
    graph.rideEdges.push(...(sqlite.prepare("SELECT fromStopId, toStopId, distanceMeters FROM ride_edge").all() as RideEdge[]));
    graph.transferEdges.push(
      ...(sqlite.prepare("SELECT fromStopId, toStopId, clusterId FROM transfer_edge").all() as TransferEdge[])
    );

    return { graph, spatialIndex: buildSpatialIndex(graph) };
  } finally {
    sqlite.close();
  }
}

const g = globalThis as unknown as { _transitGraph?: { graph: TransitGraph; spatialIndex: SpatialIndex } };

/** The cached, lazily-loaded singleton (mirrors `db/client.ts`'s `getDrizzle()`) — loads once
 * per process/hot-reload, every later call reuses the same in-memory graph + index. */
export function getTransitGraph(filePath: string = DEFAULT_GRAPH_PATH): { graph: TransitGraph; spatialIndex: SpatialIndex } {
  if (!g._transitGraph) g._transitGraph = load(filePath);
  return g._transitGraph;
}
