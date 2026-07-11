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

// Table/column naming mirrors the app's Drizzle schema convention (schema.ts): PascalCase
// singular table names, camelCase columns — even though this file is a distinct, non-Drizzle
// serialization.
function createSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE StopNode (
      id TEXT PRIMARY KEY,
      lineId TEXT NOT NULL,
      lineName TEXT NOT NULL,
      stationName TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      sequence INTEGER NOT NULL
    );
    CREATE TABLE Cluster (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE ClusterMember (
      clusterId TEXT NOT NULL,
      stopNodeId TEXT NOT NULL
    );
    CREATE TABLE RideEdge (
      fromStopId TEXT NOT NULL,
      toStopId TEXT NOT NULL,
      distanceMeters REAL NOT NULL
    );
    CREATE TABLE TransferEdge (
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
      "INSERT INTO StopNode (id, lineId, lineName, stationName, lat, lng, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertCluster = sqlite.prepare("INSERT INTO Cluster (id, name) VALUES (?, ?)");
    const insertMember = sqlite.prepare(
      "INSERT INTO ClusterMember (clusterId, stopNodeId) VALUES (?, ?)"
    );
    const insertRide = sqlite.prepare(
      "INSERT INTO RideEdge (fromStopId, toStopId, distanceMeters) VALUES (?, ?, ?)"
    );
    const insertTransfer = sqlite.prepare(
      "INSERT INTO TransferEdge (fromStopId, toStopId, clusterId) VALUES (?, ?, ?)"
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

    for (const row of sqlite.prepare("SELECT * FROM StopNode").all() as StopNode[]) {
      graph.stopNodes.set(row.id, row);
    }
    const clusterRows = sqlite.prepare("SELECT * FROM Cluster").all() as { id: string; name: string }[];
    for (const row of clusterRows) {
      graph.clusters.set(row.id, { id: row.id, name: row.name, stopNodeIds: [] });
    }
    const memberRows = sqlite.prepare("SELECT * FROM ClusterMember").all() as {
      clusterId: string;
      stopNodeId: string;
    }[];
    for (const row of memberRows) {
      graph.clusters.get(row.clusterId)?.stopNodeIds.push(row.stopNodeId);
    }
    graph.rideEdges.push(...(sqlite.prepare("SELECT fromStopId, toStopId, distanceMeters FROM RideEdge").all() as RideEdge[]));
    graph.transferEdges.push(
      ...(sqlite.prepare("SELECT fromStopId, toStopId, clusterId FROM TransferEdge").all() as TransferEdge[])
    );

    return { graph, spatialIndex: buildSpatialIndex(graph) };
  } finally {
    sqlite.close();
  }
}

const g = globalThis as unknown as { _transitGraph?: { graph: TransitGraph; spatialIndex: SpatialIndex } };

/** The cached, lazily-loaded singleton (mirrors `db/client.ts`'s `getDrizzle()`) — loads once
 * per process/hot-reload, every later call reuses the same in-memory graph + index. Takes no
 * path argument, exactly like `getDrizzle()`: a memoized singleton and a caller-supplied path
 * are in tension, since a later call with a different path would otherwise silently return the
 * graph loaded for the first one. `load()` above is the parameterized entry point for callers
 * (tests, ingestion) that need a specific file. */
export function getTransitGraph(): { graph: TransitGraph; spatialIndex: SpatialIndex } {
  if (!g._transitGraph) g._transitGraph = load(DEFAULT_GRAPH_PATH);
  return g._transitGraph;
}
