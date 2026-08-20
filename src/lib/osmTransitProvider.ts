/**
 * The OSM-Japan `PathProvider` (ADR-0019, issue #85) — real transit costs from the
 * station/line graph (`transitGraph.ts`/`transitGraphStore.ts`): a Dijkstra-style shortest path
 * with a per-transfer cost, backing both `costMatrix` (optimizer bulk) and `describeJourney`
 * (per-Journey display, ADR-0021/ADR-0022). Implements `PathProvider` unchanged — no caller
 * (`solve`, `buildDistanceLookup`, `optimize`) has to change to accommodate it (ADR-0019's
 * registry, issue #86, is what will eventually select this provider for a Japan+transit Trip;
 * this module has no opinion on `mode` itself, since it only ever has one kind of journey to
 * offer).
 *
 * No runtime network I/O: `createOsmTransitProvider(graph, spatialIndex)` binds to an
 * already-loaded graph (the future registry, issue #86, supplies `transitGraphStore.ts`'s
 * `getTransitGraph()` singleton; tests supply a small hand-built fixture instead) and every query
 * is a local search over it.
 *
 * Station-snapping + decline (ADR-0019, decline behavior revised by ADR-0024 §4, radii split by
 * ADR-0019's 2026-08-17 amendment): a point connects to every stop node within
 * `STATION_SNAP_RADIUS_METERS` via a walk edge (distance ÷ walk speed) — not just the nearest, so
 * the search can still pick whichever entry line is actually shortest. A point with nothing in that
 * range reaches once more at `ISOLATED_ACCESS_RADIUS_METERS` (see `snapStations`) before it
 * **declines** (`null`) rather than fabricating a straight-line walk — the registry's terminal
 * `haversine` entry is what fills a declined cell now, so this provider no longer needs its own
 * straight-line fallback (lifting it out is the ADR-0024 §4 change: "the matrix builder deletes the
 * hardcoded version"). A pair that both snap but turn out disconnected in the graph is a different
 * failure (nationwide rail should be one connected component) and throws rather than declining —
 * ADR-0017/0018's fail-loud precedent, not a station-snapping decline case.
 *
 * A decline is never inert, which is what makes the radius load-bearing rather than a tuning knob:
 * the cell falls to the next capable registry entry, and `osrm`'s foot profile will answer an
 * inter-city pair with a real, routed, hundreds-of-kilometre walk that is stamped `routingService`
 * and so reads as a good cell. That trap is still open (ADR-0019's amendment records it); widening
 * the radius removed one Trip's trigger for it, not the trap itself.
 *
 * `describeJourney` returns a single-element `Path[]` (ADR-0022 P1): a real journey may cross
 * several lines/Operators, which should decompose into several single-kind Paths, but
 * decomposition itself isn't implemented yet. Until then a routed multi-line journey still
 * reports `kind: "rail"` with every ridden line's name joined into one string — an honest but
 * lossy placeholder (the per-shift transfer detail this loses is exactly what decomposition
 * restores), not a claim that the journey was actually one continuous ride. ADR-0030 §12 keeps
 * that deferral affordable: a Path carries several spans, so a multi-line journey draws its real
 * track correctly while remaining one Path.
 *
 * **The search records the station identity it crosses (ADR-0030 §7), and that is deliberate.** A
 * ride edge *is* a pair of stop node ids, so the key a geometry lookup needs and the station
 * identity a traveler wants are one fact — there is no version of this change that records one
 * without the other. `TransferStep` carries its station cluster id for the same reason, one field
 * beyond what geometry needs. **This pays ADR-0028 §6's parked bill**, which named this exact
 * discard as what blocks Surfaced Transit; it is stated here so a later reader does not mistake it
 * for luck. Surfaced Transit is not built here and needs its own decision.
 *
 * Geometry reaches a Path as the real spans it has (§8, §9). The shape of each ride edge is stored
 * once, in its own stored direction; `buildAdjacency` inserts every edge both ways, so a step that
 * rides one backwards gets a reversed copy made for that one Journey. A ride edge refused at
 * ingest contributes no span and no substitute, which is what leaves the honest gap the map draws
 * dashed.
 *
 * `costMatrix` asks for no steps at all (§11). `routeJourney` backs both entry points and used to
 * build a step list either way, which the matrix then discarded across N² calls; §7 made each step
 * heavier, so the waste would have grown. The flag changes the work, never the cost.
 */

import { haversineMeters, type Point } from "@/lib/geo";
import { makeTravelCost, type Path, type PathEndpoint, type TravelCost } from "@/types/path";
import type { PathProvider, MatrixCell } from "@/lib/pathProvider";
import { STATION_SNAP_RADIUS_METERS, type TransitGraph, type StopNode, type LineType, type SpatialIndex } from "@/lib/transitGraph";

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

/** The one-more-try radius for a Location with *nothing* inside `STATION_SNAP_RADIUS_METERS`
 * (ADR-0019, amended 2026-08-17). At `WALK_SPEED_KMH` this is a 27-minute access walk — generous
 * on purpose, and the point past which a walk stops being credible, so beyond it the provider goes
 * back to declining. Never widen the primary radius to this instead: the two are asking different
 * questions, and a blanket widening measurably multiplies the seed count of every urban search. */
export const ISOLATED_ACCESS_RADIUS_METERS = 2000;

function minutesForMeters(distanceMeters: number, speedKmh: number): number {
  return distanceMeters / 1000 / speedKmh * 60;
}

/** The two stop nodes this step rides between (ADR-0030 §7). Not incidental and not optional: a
 * ride edge *is* a pair of stop node ids, so the key a geometry lookup needs and the station
 * identity a traveler wants are the same fact. There is no version of this that records one
 * without the other. */
type RideStep = { kind: "ride"; lineName: string; fromStopId: string; toStopId: string };

/** The station cluster changed at — one field beyond what geometry needs, because "change at
 * Kyoto" is the fact a traveler can act on, and ADR-0028 §6 named the transfer station as the
 * thing they cannot. `Step` is opened once rather than twice. */
type TransferStep = { kind: "transfer"; clusterId: string };

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
  ride: Map<string, RideLink[]>;
  transfer: Map<string, { toStopId: string; clusterId: string }[]>;
}

/** One crossing of one ride edge, in one direction. `geometry` is the shape as stored — always
 * `fromStopId` → `toStopId` of the *edge*, never of this link — and `forward` says whether the two
 * agree. That is ADR-0030 §8: the shape is stored once, and the direction is resolved when read.
 * Both links share the one `geometry` object, so crossing an edge backwards costs no memory. */
interface RideLink {
  toStopId: string;
  distanceMeters: number;
  lineName: string;
  geometry?: GeoJSON.LineString;
  forward: boolean;
}

const adjacencyCache = new WeakMap<TransitGraph, Adjacency>();

function buildAdjacency(graph: TransitGraph): Adjacency {
  const cached = adjacencyCache.get(graph);
  if (cached) return cached;

  const ride: Adjacency["ride"] = new Map();
  const addRide = (fromId: string, link: RideLink) => {
    const list = ride.get(fromId) ?? [];
    list.push(link);
    ride.set(fromId, list);
  };
  for (const edge of graph.rideEdges) {
    const lineName = graph.stopNodes.get(edge.fromStopId)?.lineName ?? graph.stopNodes.get(edge.toStopId)?.lineName ?? "";
    const shared = { distanceMeters: edge.distanceMeters, lineName, geometry: edge.geometry };
    addRide(edge.fromStopId, { ...shared, toStopId: edge.toStopId, forward: true });
    addRide(edge.toStopId, { ...shared, toStopId: edge.fromStopId, forward: false });
  }

  const transfer: Adjacency["transfer"] = new Map();
  const addTransfer = (fromId: string, toStopId: string, clusterId: string) => {
    const list = transfer.get(fromId) ?? [];
    list.push({ toStopId, clusterId });
    transfer.set(fromId, list);
  };
  for (const edge of graph.transferEdges) {
    addTransfer(edge.fromStopId, edge.toStopId, edge.clusterId);
    addTransfer(edge.toStopId, edge.fromStopId, edge.clusterId);
  }

  const adjacency: Adjacency = { ride, transfer };
  adjacencyCache.set(graph, adjacency);
  return adjacency;
}

/** The stop nodes `point` may enter the network at, nearest first — the multi-entry snap set a
 * search seeds from, and the pure function the "nearest station" test asserts on directly.
 *
 * Two radii, tried in order (ADR-0019, amended 2026-08-17), because they answer two different
 * questions. Inside `STATION_SNAP_RADIUS_METERS` the several stop nodes in range are a real *choice
 * of entrance*, which is why every one of them is returned rather than the nearest. A point with
 * nothing in that range has no choice to model — there is one station and the only question is
 * whether it is reachable on foot — so it reaches once more at `ISOLATED_ACCESS_RADIUS_METERS`.
 *
 * The second reach is therefore dead for any point the first one answers, which is the property
 * that makes it affordable: urban snapping is bit-identical to before, and only a point that would
 * otherwise have declined pays for the wider search. */
export function snapStations(spatialIndex: SpatialIndex, point: Point): StopNode[] {
  const within = (radiusMeters: number): StopNode[] =>
    spatialIndex
      .nearby(point.lat, point.lng, radiusMeters)
      .map((stop) => ({ stop, meters: haversineMeters(point, stop) }))
      .sort((a, b) => a.meters - b.meters)
      .map((s) => s.stop);

  const inSnapRadius = within(STATION_SNAP_RADIUS_METERS);
  return inSnapRadius.length > 0 ? inSnapRadius : within(ISOLATED_ACCESS_RADIUS_METERS);
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
  toStopIds: Set<string>,
  withSteps: boolean
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
    if (withSteps) steps.set(seed.stop.id, []);
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
    const currentSteps = withSteps ? (steps.get(current.id) ?? []) : [];

    for (const rideEdge of adjacency.ride.get(current.id) ?? []) {
      if (visited.has(rideEdge.toStopId)) continue;
      const lineType = graph.stopNodes.get(current.id)?.lineType ?? "commuter";
      const speed = LINE_TYPE_SPEEDS_KMH[lineType];
      const candidateTime = currentTime + minutesForMeters(rideEdge.distanceMeters, speed);
      if (candidateTime < (timeMin.get(rideEdge.toStopId) ?? Infinity)) {
        timeMin.set(rideEdge.toStopId, candidateTime);
        distanceMeters.set(rideEdge.toStopId, currentDistance + rideEdge.distanceMeters);
        if (withSteps) {
          steps.set(rideEdge.toStopId, [
            ...currentSteps,
            { kind: "ride", lineName: rideEdge.lineName, fromStopId: current.id, toStopId: rideEdge.toStopId },
          ]);
        }
        push(rideEdge.toStopId, candidateTime);
      }
    }

    for (const transferEdge of adjacency.transfer.get(current.id) ?? []) {
      const toStopId = transferEdge.toStopId;
      if (visited.has(toStopId)) continue;
      const candidateTime = currentTime + TRANSFER_MINUTES;
      if (candidateTime < (timeMin.get(toStopId) ?? Infinity)) {
        timeMin.set(toStopId, candidateTime);
        distanceMeters.set(toStopId, currentDistance);
        if (withSteps) {
          steps.set(toStopId, [...currentSteps, { kind: "transfer", clusterId: transferEdge.clusterId }]);
        }
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

/** Every ridden line's name, collapsed and joined into one string — the pre-decomposition
 * placeholder described in the module doc. Collapses only consecutive repeats (a line ridden
 * twice non-consecutively is a real second ride, not a naming artifact); `undefined` when no ride
 * step occurred at all (the route resolved from station-access walking alone). */
function joinedLineNameOf(steps: Step[]): string | undefined {
  const rideNames = steps.filter((s): s is RideStep => s.kind === "ride").map((s) => s.lineName);
  const deduped = rideNames.filter((name, i) => name !== rideNames[i - 1]);
  return deduped.length > 0 ? deduped.join(" / ") : undefined;
}

/**
 * The real shapes a routed Journey has, in travel order (ADR-0030 §8, §9) — one span per ride step
 * whose ride edge was traced, and nothing at all for one that was not.
 *
 * Direction is resolved here, at read time. `buildAdjacency` inserts every ride edge both ways so
 * the search can cross it backwards, but only one shape is stored; a step that rides the edge
 * against its stored direction gets a reversed *copy*, made once for the one Journey being
 * described rather than held for every edge in the graph. §7's ids are what make the comparison
 * free — they are already recorded for the lookup.
 *
 * A refused ride edge contributes no span and no substitute. The gap it leaves is the point:
 * the map draws it dashed, which is the honest report (§1).
 */
function spansOf(steps: Step[], adjacency: Adjacency): GeoJSON.LineString[] {
  const spans: GeoJSON.LineString[] = [];
  for (const step of steps) {
    if (step.kind !== "ride") continue;
    const link = adjacency.ride.get(step.fromStopId)?.find((l) => l.toStopId === step.toStopId);
    if (!link?.geometry) continue;
    spans.push(
      link.forward
        ? link.geometry
        : { type: "LineString", coordinates: [...link.geometry.coordinates].reverse() }
    );
  }
  return spans;
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

/** The graph search's result before it's shaped into a `TravelCost`/`Path` — `lineName` present
 * only when the route actually rode a line (`joinedLineNameOf`'s `undefined` case: the route
 * resolved from station-access walking alone, so it's not honestly `kind: "rail"` either). */
interface JourneyResult {
  travelCost: TravelCost;
  lineName?: string;
  /** Present only for a caller that asked for steps — `costMatrix` never needs a shape. */
  geometry?: GeoJSON.LineString[];
}

/** `null` is a decline (ADR-0024 §4) — the identity cell and the no-station-in-range case both
 * decline now rather than fabricating a straight line; the registry's terminal `haversine` entry
 * fills whatever this provider declines. A pair that both snap but is disconnected in the graph
 * still throws — see the module doc. */
async function routeJourney(
  graph: TransitGraph,
  spatialIndex: SpatialIndex,
  from: Point,
  to: Point,
  withSteps: boolean
): Promise<JourneyResult | null> {
  // The terminal entry produces the same zero-cost answer for an identical pair, so declining
  // here is one fewer special case rather than a behavior change at the matrix level.
  if (haversineMeters(from, to) === 0) return null;

  const fromSnaps = snapWithWalkCost(spatialIndex, from);
  const toSnaps = snapWithWalkCost(spatialIndex, to);
  if (!fromSnaps || !toSnaps) return null;

  const adjacency = buildAdjacency(graph);
  const toStopIds = new Set(toSnaps.map((s) => s.stop.id));

  // Each seed's own walk-adjusted time/distance is already folded in by shortestPath, so the
  // result per to-stop is the true end-to-end total once its own egress walk is added.
  const raw = shortestPath(graph, adjacency, fromSnaps, toStopIds, withSteps);

  let best: { toStopId: string; totalMinutes: number; totalDistance: number } | null = null;
  for (const toSnap of toSnaps) {
    const result = raw.get(toSnap.stop.id);
    if (!result) continue;
    const totalMinutes = result.timeMin + toSnap.walkMinutes;
    const totalDistance = result.distanceMeters + toSnap.walkMeters;
    if (!best || totalMinutes < best.totalMinutes) best = { toStopId: toSnap.stop.id, totalMinutes, totalDistance };
  }

  if (!best) {
    throw new Error("osmTransitProvider: no route found between snapped stations for this Journey");
  }

  const result = raw.get(best.toStopId)!;
  const travelCost = makeTravelCost(best.totalDistance, best.totalMinutes * 60, "railNetwork", "osm-japan");
  if (!withSteps) return { travelCost };

  const geometry = spansOf(result.steps, adjacency);
  return {
    travelCost,
    lineName: joinedLineNameOf(result.steps),
    geometry: geometry.length > 0 ? geometry : undefined,
  };
}

/** Builds a `PathProvider` bound to a given graph + spatial index — the seam that lets tests
 * inject a small hand-built fixture instead of the real ingested `db/transit-japan.db`. */
export function createOsmTransitProvider(graph: TransitGraph, spatialIndex: SpatialIndex): PathProvider {
  return {
    async costMatrix(points) {
      const matrix: MatrixCell[][] = [];
      for (const from of points) {
        const row: MatrixCell[] = [];
        for (const to of points) {
          // §11: the matrix keeps the cost and throws the step list away, across N² calls, and
          // §7 made each step heavier. It no longer pays for what it discards.
          const journey = await routeJourney(graph, spatialIndex, from, to, false);
          row.push(journey?.travelCost ?? null);
        }
        matrix.push(row);
      }
      return matrix;
    },
    async describeJourney(from: PathEndpoint, to: PathEndpoint): Promise<Path[] | null> {
      const journey = await routeJourney(graph, spatialIndex, from, to, true);
      if (!journey) return null;
      const { travelCost, lineName, geometry } = journey;
      if (lineName === undefined) return [{ from, to, travelCost }];
      return [{ kind: "rail", from, to, travelCost, lineName, geometry }];
    },
  };
}
