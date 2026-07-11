/**
 * The OSM-Japan `TravelCostProvider` (ADR-0019, issue #85) — real transit costs from the
 * station/line graph (`transitGraph.ts`/`transitGraphStore.ts`): a Dijkstra-style shortest path
 * with a per-transfer cost, backing both `costMatrix` (optimizer bulk) and `describeLeg` (per-Leg
 * display). Implements `TravelCostProvider` unchanged — no caller (`solve`, `buildDistanceLookup`,
 * `optimize`) has to change to accommodate it (ADR-0019's registry, issue #86, is what will
 * eventually select this provider for a Japan+transit Trip; this module has no opinion on `mode`
 * itself, since it only ever has one kind of journey to offer).
 *
 * No runtime network I/O: `createOsmTransitProvider(graph, spatialIndex)` binds to an
 * already-loaded graph (the future registry, issue #86, supplies `transitGraphStore.ts`'s
 * `getTransitGraph()` singleton; tests supply a small hand-built fixture instead) and every query
 * is a local search over it.
 *
 * Station-snapping + fallback (ADR-0019): a point connects to every stop node within
 * `STATION_SNAP_RADIUS_METERS` via a walk edge (distance ÷ walk speed) — not just the nearest, so
 * the search can still pick whichever entry line is actually shortest. A point with no stop node
 * in range (or a target with no path from the source's snapped stops) falls back to
 * haversine-as-walking, a plain `TravelCost` with no `transferCount`/`lineNames` — the existing
 * `LegDetail` convention already used by `haversineProvider`/`googleRoutesProvider` for "nothing
 * transit to report", so the fallback is visibly an estimate rather than masquerading as a routed
 * transit Leg.
 */

import { haversineMeters, type Point, type TravelCost, type TravelCostProvider, type LegDetail } from "@/lib/travelCost";
import type { TransitGraph, StopNode, LineType, SpatialIndex } from "@/lib/transitGraph";

/** Effective speed per line type (ADR-0019's coarse duration model) — one number per type
 * absorbing acceleration/braking/dwell, not modeled separately. Placeholders pending calibration
 * against the manual eval (J5); tune this table, not the algorithm, when real Legs disagree. */
export const LINE_TYPE_SPEEDS_KMH: Record<LineType, number> = {
  subway: 32,
  commuter: 45,
  limitedExpress: 70,
  shinkansen: 220,
};

/** Flat per-transfer minutes (platform walk + wait, deliberately not split — ADR-0019). */
export const TRANSFER_MINUTES = 5;

/** Walking speed for station-access legs and the no-station-in-range fallback. */
export const WALK_SPEED_KMH = 4.5;

/** How far a Location may be from a stop node and still be considered "at" that station. */
export const STATION_SNAP_RADIUS_METERS = 800;

function minutesForMeters(distanceMeters: number, speedKmh: number): number {
  return distanceMeters / 1000 / speedKmh * 60;
}

function haversineWalkingCost(from: Point, to: Point): TravelCost {
  const distanceMeters = haversineMeters(from, to);
  return { distanceMeters, durationSeconds: minutesForMeters(distanceMeters, WALK_SPEED_KMH) * 60 };
}

type RideStep = { kind: "ride"; lineName: string };
type TransferStep = { kind: "transfer" };
type Step = RideStep | TransferStep;

interface SearchResult {
  timeMin: number;
  distanceMeters: number;
  steps: Step[];
}

/** Bidirectional adjacency over the graph's ride/transfer edges — real trains and interchange
 * walks both run either way, unlike `sequence`, which only orders one line's own stops. Cached per
 * graph instance since the graph itself never changes at runtime (a fresh ingest replaces the
 * whole singleton, per `transitGraphStore.ts`). */
interface Adjacency {
  ride: Map<string, { toStopId: string; distanceMeters: number; lineName: string }[]>;
  transfer: Map<string, string[]>;
}

const adjacencyCache = new WeakMap<TransitGraph, Adjacency>();

function buildAdjacency(graph: TransitGraph): Adjacency {
  const cached = adjacencyCache.get(graph);
  if (cached) return cached;

  const ride: Adjacency["ride"] = new Map();
  const addRide = (fromId: string, toId: string, distanceMeters: number, lineName: string) => {
    const list = ride.get(fromId) ?? [];
    list.push({ toStopId: toId, distanceMeters, lineName });
    ride.set(fromId, list);
  };
  for (const edge of graph.rideEdges) {
    const lineName = graph.stopNodes.get(edge.fromStopId)?.lineName ?? graph.stopNodes.get(edge.toStopId)?.lineName ?? "";
    addRide(edge.fromStopId, edge.toStopId, edge.distanceMeters, lineName);
    addRide(edge.toStopId, edge.fromStopId, edge.distanceMeters, lineName);
  }

  const transfer: Adjacency["transfer"] = new Map();
  const addTransfer = (fromId: string, toId: string) => {
    const list = transfer.get(fromId) ?? [];
    list.push(toId);
    transfer.set(fromId, list);
  };
  for (const edge of graph.transferEdges) {
    addTransfer(edge.fromStopId, edge.toStopId);
    addTransfer(edge.toStopId, edge.fromStopId);
  }

  const adjacency: Adjacency = { ride, transfer };
  adjacencyCache.set(graph, adjacency);
  return adjacency;
}

/** All stop nodes within `STATION_SNAP_RADIUS_METERS` of `point`, nearest first — the multi-entry
 * snap set a search seeds from, and the pure function the "nearest station" test asserts on directly. */
export function snapStations(spatialIndex: SpatialIndex, point: Point): StopNode[] {
  return spatialIndex
    .nearby(point.lat, point.lng, STATION_SNAP_RADIUS_METERS)
    .map((stop) => ({ stop, meters: haversineMeters(point, stop) }))
    .sort((a, b) => a.meters - b.meters)
    .map((s) => s.stop);
}

/** Multi-source Dijkstra over the graph, seeded from every stop node snapped to the origin — each
 * seeded at its own walk-adjusted access cost (ADR-0019's station-snapping), so whichever entry
 * stop actually yields the shortest total time wins on equal footing, in time-minutes (ride
 * distance ÷ line-type speed; transfer edges cost the flat constant). Distance and the traversed
 * step list accumulate alongside the same shortest-time tree, since the path minimizing time is
 * what determines which real edges were actually ridden. */
function shortestPath(
  graph: TransitGraph,
  adjacency: Adjacency,
  seeds: { stop: StopNode; walkMeters: number; walkMinutes: number }[],
  toStopIds: Set<string>
): Map<string, SearchResult> {
  const timeMin = new Map<string, number>();
  const distanceMeters = new Map<string, number>();
  const steps = new Map<string, Step[]>();
  const visited = new Set<string>();

  // Min-priority queue via a simple array — the fixture/optimizer-scale graphs this runs against
  // (a few dozen snapped stops, nationwide rail node counts) don't warrant a binary heap.
  const queue: { id: string; time: number }[] = [];
  const push = (id: string, time: number) => queue.push({ id, time });
  const pop = (): { id: string; time: number } | undefined => {
    let bestIdx = -1;
    for (let i = 0; i < queue.length; i++) {
      if (bestIdx === -1 || queue[i].time < queue[bestIdx].time) bestIdx = i;
    }
    if (bestIdx === -1) return undefined;
    return queue.splice(bestIdx, 1)[0];
  };

  for (const seed of seeds) {
    const existing = timeMin.get(seed.stop.id);
    if (existing !== undefined && existing <= seed.walkMinutes) continue;
    timeMin.set(seed.stop.id, seed.walkMinutes);
    distanceMeters.set(seed.stop.id, seed.walkMeters);
    steps.set(seed.stop.id, []);
    push(seed.stop.id, seed.walkMinutes);
  }

  const remainingTargets = new Set(toStopIds);
  while (remainingTargets.size > 0) {
    const current = pop();
    if (!current) break;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    remainingTargets.delete(current.id);

    const currentTime = timeMin.get(current.id) ?? Infinity;
    const currentDistance = distanceMeters.get(current.id) ?? 0;
    const currentSteps = steps.get(current.id) ?? [];

    for (const rideEdge of adjacency.ride.get(current.id) ?? []) {
      if (visited.has(rideEdge.toStopId)) continue;
      const lineType = graph.stopNodes.get(current.id)?.lineType ?? "commuter";
      const speed = LINE_TYPE_SPEEDS_KMH[lineType];
      const candidateTime = currentTime + minutesForMeters(rideEdge.distanceMeters, speed);
      if (candidateTime < (timeMin.get(rideEdge.toStopId) ?? Infinity)) {
        timeMin.set(rideEdge.toStopId, candidateTime);
        distanceMeters.set(rideEdge.toStopId, currentDistance + rideEdge.distanceMeters);
        steps.set(rideEdge.toStopId, [...currentSteps, { kind: "ride", lineName: rideEdge.lineName }]);
        push(rideEdge.toStopId, candidateTime);
      }
    }

    for (const toStopId of adjacency.transfer.get(current.id) ?? []) {
      if (visited.has(toStopId)) continue;
      const candidateTime = currentTime + TRANSFER_MINUTES;
      if (candidateTime < (timeMin.get(toStopId) ?? Infinity)) {
        timeMin.set(toStopId, candidateTime);
        distanceMeters.set(toStopId, currentDistance);
        steps.set(toStopId, [...currentSteps, { kind: "transfer" }]);
        push(toStopId, candidateTime);
      }
    }
  }

  const results = new Map<string, SearchResult>();
  for (const id of toStopIds) {
    if (!timeMin.has(id)) continue;
    results.set(id, { timeMin: timeMin.get(id)!, distanceMeters: distanceMeters.get(id)!, steps: steps.get(id) ?? [] });
  }
  return results;
}

function stepsToLegDetail(steps: Step[]): { transferCount: number; lineNames: string[] } {
  const lineNames = steps.filter((s): s is RideStep => s.kind === "ride").map((s) => s.lineName);
  const dedupedLines = lineNames.filter((name, i) => name !== lineNames[i - 1]);
  const transferCount = steps.filter((s) => s.kind === "transfer").length;
  return { transferCount, lineNames: dedupedLines };
}

/** One point's snapped stop nodes plus the walk-access cost to each, or `null` when nothing is
 * within `STATION_SNAP_RADIUS_METERS` — the no-station fallback trigger. */
function snapWithWalkCost(
  spatialIndex: SpatialIndex,
  point: Point
): { stop: StopNode; walkMeters: number; walkMinutes: number }[] | null {
  const stops = snapStations(spatialIndex, point);
  if (stops.length === 0) return null;
  return stops.map((stop) => {
    const walkMeters = haversineMeters(point, stop);
    return { stop, walkMeters, walkMinutes: minutesForMeters(walkMeters, WALK_SPEED_KMH) };
  });
}

async function routeLeg(graph: TransitGraph, spatialIndex: SpatialIndex, from: Point, to: Point): Promise<LegDetail> {
  if (haversineMeters(from, to) === 0) return { distanceMeters: 0, durationSeconds: 0 };

  const fromSnaps = snapWithWalkCost(spatialIndex, from);
  const toSnaps = snapWithWalkCost(spatialIndex, to);
  if (!fromSnaps || !toSnaps) return haversineWalkingCost(from, to);

  const adjacency = buildAdjacency(graph);
  const toStopIds = new Set(toSnaps.map((s) => s.stop.id));

  // Each seed's own walk-adjusted time/distance is already folded in by shortestPath, so the
  // result per to-stop is the true end-to-end total once its own egress walk is added.
  const raw = shortestPath(graph, adjacency, fromSnaps, toStopIds);

  let best: { toStopId: string; totalMinutes: number; totalDistance: number } | null = null;
  for (const toSnap of toSnaps) {
    const result = raw.get(toSnap.stop.id);
    if (!result) continue;
    const totalMinutes = result.timeMin + toSnap.walkMinutes;
    const totalDistance = result.distanceMeters + toSnap.walkMeters;
    if (!best || totalMinutes < best.totalMinutes) best = { toStopId: toSnap.stop.id, totalMinutes, totalDistance };
  }

  if (!best) {
    throw new Error("osmTransitProvider: no path found between snapped stations for this Leg");
  }

  const result = raw.get(best.toStopId)!;
  const { transferCount, lineNames } = stepsToLegDetail(result.steps);
  return {
    distanceMeters: best.totalDistance,
    durationSeconds: best.totalMinutes * 60,
    transferCount,
    lineNames,
  };
}

/** Builds a `TravelCostProvider` bound to a given graph + spatial index — the seam that lets tests
 * inject a small hand-built fixture instead of the real ingested `db/transit-japan.db`. */
export function createOsmTransitProvider(graph: TransitGraph, spatialIndex: SpatialIndex): TravelCostProvider {
  return {
    async costMatrix(points) {
      const matrix: TravelCost[][] = [];
      for (const from of points) {
        const row: TravelCost[] = [];
        for (const to of points) {
          row.push(await routeLeg(graph, spatialIndex, from, to));
        }
        matrix.push(row);
      }
      return matrix;
    },
    async describeLeg(from, to) {
      return routeLeg(graph, spatialIndex, from, to);
    },
  };
}
