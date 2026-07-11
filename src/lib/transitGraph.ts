/**
 * The in-memory Japan transit graph (ADR-0018 gap assessment, issue #81/#84) — the shared
 * structure both the ingestion pipeline (writer, issue #82+) and the OSM-transit provider
 * (loader, later issue) build on. This module owns the graph shape and the in-memory index;
 * `transitGraphStore.ts` owns turning it into/from the on-disk SQLite file.
 *
 * Two node tiers, per the design doc:
 *  - Stop nodes: one per line passing through a station, so a busy interchange is many stop
 *    nodes (one per line/platform), not one.
 *  - Station clusters: groupings of stop nodes that represent one physical interchange —
 *    derived from OSM's `stop_area`/`stop_area_group` (with a proximity+name fallback), by the
 *    ingestion pipeline, not by this module.
 *
 * Two edge kinds, both graph-internal — distinct from the domain `Leg` (a travel segment
 * between Placements) and never exposed as one:
 *  - Ride edges: consecutive stop nodes on one line, carrying the real inter-station distance.
 *  - Transfer edges: stop nodes within one cluster (the interchange walk).
 */

import { haversineMeters } from "./travelCost";

/** A line's physical service class (issue #85's duration model) — the key into the OSM-transit
 * provider's per-type effective-speed table. Sourced from OSM route-relation tags by ingestion
 * (`route=train`/`subway`/`light_rail`/`monorail`, `service=shinkansen`), not derived here. */
export type LineType = "subway" | "commuter" | "limitedExpress" | "shinkansen";

export interface StopNode {
  id: string;
  lineId: string;
  lineName: string;
  lineType: LineType;
  stationName: string;
  lat: number;
  lng: number;
  /** Position along the line's ordered stop sequence — what makes ride edges "consecutive". */
  sequence: number;
}

export interface StationCluster {
  id: string;
  name: string;
  stopNodeIds: string[];
}

export interface RideEdge {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
}

export interface TransferEdge {
  fromStopId: string;
  toStopId: string;
  clusterId: string;
}

export interface TransitGraph {
  stopNodes: Map<string, StopNode>;
  clusters: Map<string, StationCluster>;
  rideEdges: RideEdge[];
  transferEdges: TransferEdge[];
}

export function createGraph(): TransitGraph {
  return {
    stopNodes: new Map(),
    clusters: new Map(),
    rideEdges: [],
    transferEdges: [],
  };
}

/**
 * A coarse lat/lng grid index for station-snapping (a routable Location finds nearby stop
 * nodes within a walking radius, per the design doc). Grid buckets, not a k-d tree: Japan's
 * whole-country stop count is small enough that this stays simple and fast, and the ticket
 * that consumes it (station-snapping) only ever needs "stops within N meters of a point".
 */
export interface SpatialIndex {
  nearby(lat: number, lng: number, radiusMeters: number): StopNode[];
}

const CELL_DEGREES = 0.01; // ≈1.1km at Japan's latitudes — small enough for a tight walk radius

function cellKey(lat: number, lng: number): string {
  const row = Math.floor(lat / CELL_DEGREES);
  const col = Math.floor(lng / CELL_DEGREES);
  return `${row}:${col}`;
}

export function buildSpatialIndex(graph: TransitGraph): SpatialIndex {
  const buckets = new Map<string, StopNode[]>();
  for (const stop of graph.stopNodes.values()) {
    const key = cellKey(stop.lat, stop.lng);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(stop);
    else buckets.set(key, [stop]);
  }

  return {
    nearby(lat, lng, radiusMeters) {
      const cellSpan = Math.ceil(radiusMeters / (CELL_DEGREES * 111_000)) + 1;
      const row = Math.floor(lat / CELL_DEGREES);
      const col = Math.floor(lng / CELL_DEGREES);
      const results: StopNode[] = [];
      for (let dr = -cellSpan; dr <= cellSpan; dr++) {
        for (let dc = -cellSpan; dc <= cellSpan; dc++) {
          const bucket = buckets.get(`${row + dr}:${col + dc}`);
          if (!bucket) continue;
          for (const stop of bucket) {
            if (haversineMeters({ lat, lng }, stop) <= radiusMeters) results.push(stop);
          }
        }
      }
      return results;
    },
  };
}
