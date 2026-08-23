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
 * Two edge kinds, both graph-internal — distinct from the domain `Path` (a travel segment
 * between Placements, ADR-0021) and never exposed as one:
 *  - Ride edges: consecutive stop nodes on one line, carrying the real inter-station distance.
 *  - Transfer edges: stop nodes within one cluster (the interchange walk).
 */

import { haversineMeters } from "./geo";

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
  /** The line's operator, one canonical value per line/relation (issue #210) — the same
   * granularity `lineType` already uses. A through-service that changes Operator partway along
   * one line (ADR-0021) is not resolved here; every stop on the line takes the relation's own
   * operator, and where the boundary actually falls stays unmodeled (fog item on #140).
   * Absent means genuinely unknown — OSM carries no `operator=*` tag on this relation and it
   * isn't one of the untagged premium services #210 backstops by name — not "not JR". */
  operator?: string;
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
  /** The real track between the two stations, traced from the line's `way` members at ingest
   * (ADR-0030 §1–§3, `railGeometry.ts`). Runs from `fromStopId` to `toStopId`; the reversed
   * direction is resolved at read time and never stored twice (§8).
   *
   * Absent means we do not know the shape — the segment was built across a discontinuity the
   * assembler saw happen, or a station could not be located on the chain within the snap radius.
   * It is deliberately not the same thing as an empty line: the map draws an absent shape dashed
   * and thereby says so. */
  geometry?: GeoJSON.LineString;
  /** Length along `geometry`, present exactly when it is. Nothing costs travel with it —
   * `distanceMeters` stays the station-to-station haversine (ADR-0030 §4). */
  tracedLengthMeters?: number;
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

/** How far a Location may be from a stop node and still be considered "at" that station. Lives
 * here rather than in `osmTransitProvider.ts` because ingest needs it too: ADR-0030 §3 cuts an
 * off-track station at the nearest point on its line, bounded by this same radius. Reusing it is
 * the decision, not a convenience — it is already this codebase's answer to "is this station
 * reachable from here", and a second, separately-tuned notion of nearness would be a second thing
 * to get wrong. */
export const STATION_SNAP_RADIUS_METERS = 800;

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
