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
import { encodeLineString, decodeLineString } from "./geometryCodec";
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
      lineType TEXT NOT NULL,
      stationName TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      sequence INTEGER NOT NULL,
      operator TEXT
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
      distanceMeters REAL NOT NULL,
      geometry BLOB,
      tracedLengthMeters REAL
    );
    CREATE TABLE TransferEdge (
      fromStopId TEXT NOT NULL,
      toStopId TEXT NOT NULL,
      clusterId TEXT NOT NULL
    );
    CREATE TABLE Meta (
      snapshotDate TEXT NOT NULL,
      region TEXT NOT NULL,
      ingestedAt TEXT NOT NULL
    );
  `);
}

/** Which Extract built a graph file (ADR-0030 §6). The file is regenerated wholesale with the
 * Extract, so this identity is already implicit in the artefact — it is recorded anyway, while the
 * schema is open, because it makes the file self-describing for anyone debugging a wrong-looking
 * line, and adding it later would mean a second schema change for something already known to be
 * wanted. Nothing reads it at runtime; it is answered with plain SQL. */
export interface GraphMeta {
  snapshotDate: string;
  region: string;
}

/** Writes `graph` to `filePath`, replacing any existing file — the ingestion pipeline's output step. */
export function save(graph: TransitGraph, filePath: string = DEFAULT_GRAPH_PATH, meta?: GraphMeta): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.rmSync(filePath, { force: true });

  const sqlite = new Database(filePath);
  try {
    createSchema(sqlite);
    const insertStop = sqlite.prepare(
      "INSERT INTO StopNode (id, lineId, lineName, lineType, stationName, lat, lng, sequence, operator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertCluster = sqlite.prepare("INSERT INTO Cluster (id, name) VALUES (?, ?)");
    const insertMember = sqlite.prepare(
      "INSERT INTO ClusterMember (clusterId, stopNodeId) VALUES (?, ?)"
    );
    const insertRide = sqlite.prepare(
      "INSERT INTO RideEdge (fromStopId, toStopId, distanceMeters, geometry, tracedLengthMeters) VALUES (?, ?, ?, ?, ?)"
    );
    const insertTransfer = sqlite.prepare(
      "INSERT INTO TransferEdge (fromStopId, toStopId, clusterId) VALUES (?, ?, ?)"
    );
    const insertMeta = sqlite.prepare(
      "INSERT INTO Meta (snapshotDate, region, ingestedAt) VALUES (?, ?, ?)"
    );

    const writeAll = sqlite.transaction(() => {
      for (const stop of graph.stopNodes.values()) {
        insertStop.run(stop.id, stop.lineId, stop.lineName, stop.lineType, stop.stationName, stop.lat, stop.lng, stop.sequence, stop.operator ?? null);
      }
      for (const cluster of graph.clusters.values()) {
        insertCluster.run(cluster.id, cluster.name);
        for (const stopNodeId of cluster.stopNodeIds) insertMember.run(cluster.id, stopNodeId);
      }
      for (const edge of graph.rideEdges) {
        insertRide.run(
          edge.fromStopId,
          edge.toStopId,
          edge.distanceMeters,
          edge.geometry ? encodeLineString(edge.geometry) : null,
          edge.tracedLengthMeters ?? null
        );
      }
      for (const edge of graph.transferEdges) {
        insertTransfer.run(edge.fromStopId, edge.toStopId, edge.clusterId);
      }
      // "unknown" rather than a thrown error: a hand-built fixture written by a test has no
      // Extract behind it, and refusing to save one would be a worse answer than saying so.
      insertMeta.run(meta?.snapshotDate ?? "unknown", meta?.region ?? "unknown", new Date().toISOString());
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

    for (const row of sqlite.prepare("SELECT * FROM StopNode").all() as (Omit<StopNode, "operator"> & {
      operator: string | null;
    })[]) {
      // Omit the key entirely when unknown, rather than assign `undefined` — an object with an
      // own `operator: undefined` property is not deepStrictEqual to one without the key at all,
      // which every StopNode built by hand (fixtures, `createGraph()` callers) never carries.
      const { operator, ...rest } = row;
      graph.stopNodes.set(row.id, operator ? { ...rest, operator } : rest);
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
    const rideRows = sqlite.prepare(
      "SELECT fromStopId, toStopId, distanceMeters, geometry, tracedLengthMeters FROM RideEdge"
    ).all() as (Omit<RideEdge, "geometry"> & { geometry: Buffer | null })[];
    for (const row of rideRows) {
      const edge: RideEdge = {
        fromStopId: row.fromStopId,
        toStopId: row.toStopId,
        distanceMeters: row.distanceMeters,
      };
      if (row.geometry) {
        edge.geometry = decodeLineString(row.geometry);
        edge.tracedLengthMeters = row.tracedLengthMeters;
      }
      graph.rideEdges.push(edge);
    }
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
