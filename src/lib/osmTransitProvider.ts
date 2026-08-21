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
 * `describeJourney` decomposes a Journey into one Path per shift (ADR-0032, `decompose` below):
 * an access walk, one rail Path per contiguous same-line run, a walking Path per transfer, and an
 * egress walk. `costMatrix` is untouched by this — it never asks for steps and never sees a Path.
 *
 * **A caller that wants the whole A→B cost must sum the chain** (`journeyCost`, `types/path.ts`),
 * never read `paths[0]`. That shorthand was only ever correct while this returned one Path per
 * Journey; the first element is now the *access walk*, so reading it reports a few hundred metres
 * of pavement as the cost of a cross-city train ride.
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
import {
  makeTravelCost,
  type Path,
  type PathEndpoint,
  type RailPath,
  type TravelCost,
  type WalkingPath,
} from "@/types/path";
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
 * thing they cannot. `Step` is opened once rather than twice.
 *
 * The two stop nodes are carried for the same reason `RideStep` carries its pair: decomposition
 * (ADR-0032 §3) makes this step its own Path, and a Path needs endpoints. The search knows both at
 * the moment it creates the step, so recording them costs nothing and saves the alternative —
 * inferring a transfer's ends from the ride steps on either side of it, which has no answer at all
 * for a transfer that opens or closes a Journey. */
type TransferStep = { kind: "transfer"; clusterId: string; fromStopId: string; toStopId: string };

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
          steps.set(toStopId, [
            ...currentSteps,
            { kind: "transfer", clusterId: transferEdge.clusterId, fromStopId: current.id, toStopId },
          ]);
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

/** A stop node as a Path endpoint (ADR-0032 §3). Coordinates are the station's own — for an
 * endpoint decomposition *created* there is no Location behind it whose coordinates were
 * "requested", so the station is the requested point. No `locationId`: an interchange endpoint is
 * ephemeral, derived from the Path and never persisted (ADR-0022). */
function endpointOfStop(graph: TransitGraph, stopId: string, stationName?: string): PathEndpoint {
  const stop = graph.stopNodes.get(stopId)!;
  return { lat: stop.lat, lng: stop.lng, stationName: stationName ?? stop.stationName };
}

/** A walk between two endpoints, priced the only way this provider can price one: haversine at
 * `WALK_SPEED_KMH`, so `straightLine` (ADR-0032 §2/§4) — we did not route it and we say so, which
 * is what draws it dashed. `null` for a walk of no length at all, which is not information
 * (§6) — a Location entered at its station's own coordinates. */
function walkPathOf(from: PathEndpoint, to: PathEndpoint): WalkingPath | null {
  const meters = haversineMeters(from, to);
  if (meters === 0) return null;
  return {
    kind: "walking",
    from,
    to,
    travelCost: makeTravelCost(meters, minutesForMeters(meters, WALK_SPEED_KMH) * 60, "straightLine", "osm-japan"),
  };
}

/**
 * One contiguous run of same-line ride steps, as a rail Path.
 *
 * Cost is recomputed from the run's own steps (ADR-0032 §5) — the same per-hop arithmetic
 * `shortestPath` did when it chose this route, regrouped rather than re-derived, which is what
 * makes the decomposed chain sum back to the Journey's own total exactly. The speed is keyed off
 * the *from* stop's line type, matching the relaxation step precisely; a different reading would
 * silently break the sum.
 *
 * Geometry is this run's spans alone, in travel order (ADR-0030 §8, §9). Direction resolves at read
 * time: `buildAdjacency` inserts every ride edge both ways so the search can cross it backwards,
 * but only one shape is stored, so a step riding against the stored direction gets a reversed
 * *copy* made for this one Journey. A refused ride edge contributes no span and no substitute — the
 * gap it leaves is the point, and the map draws it dashed (§1).
 */
function railPathOf(graph: TransitGraph, adjacency: Adjacency, run: RideStep[]): RailPath {
  let meters = 0;
  let minutes = 0;
  const spans: GeoJSON.LineString[] = [];

  for (const step of run) {
    const link = adjacency.ride.get(step.fromStopId)?.find((l) => l.toStopId === step.toStopId);
    if (!link) continue;
    meters += link.distanceMeters;
    const lineType = graph.stopNodes.get(step.fromStopId)?.lineType ?? "commuter";
    minutes += minutesForMeters(link.distanceMeters, LINE_TYPE_SPEEDS_KMH[lineType]);
    if (link.geometry) {
      spans.push(
        link.forward
          ? link.geometry
          : { type: "LineString", coordinates: [...link.geometry.coordinates].reverse() }
      );
    }
  }

  return {
    kind: "rail",
    from: endpointOfStop(graph, run[0].fromStopId),
    to: endpointOfStop(graph, run[run.length - 1].toStopId),
    travelCost: makeTravelCost(meters, minutes * 60, "railNetwork", "osm-japan"),
    lineName: run[0].lineName,
    geometry: spans.length > 0 ? spans : undefined,
  };
}

/** A transfer as its own walking Path (ADR-0032 §3). Its distance is `0` and not the haversine
 * between the two platforms: the graph holds no real interchange-walk distance, only
 * `TRANSFER_MINUTES` standing in for one, and inventing a distance here would change every rail
 * Journey's total (§4/§5). Both endpoints take the *cluster's* name — "change at Tokyo" is the
 * fact, not the two per-line station names either side of it. */
function transferPathOf(graph: TransitGraph, step: TransferStep): WalkingPath {
  const stationName = graph.clusters.get(step.clusterId)?.name;
  return {
    kind: "walking",
    from: endpointOfStop(graph, step.fromStopId, stationName),
    to: endpointOfStop(graph, step.toStopId, stationName),
    travelCost: makeTravelCost(0, TRANSFER_MINUTES * 60, "straightLine", "osm-japan"),
  };
}

/**
 * A Journey's step list as the chain of Paths it actually is (ADR-0032): an access walk, one Path
 * per contiguous same-line run of rides, a Path per transfer, and an egress walk.
 *
 * **Every line boundary splits, unconditionally (§1).** Stop node ids are scoped per OSM route
 * relation, so crossing lines always crosses a transfer edge — the graph carries no signal
 * distinguishing a real interchange from a seated through-run that OSM happens to model as two
 * relations, which is the carve-out ADR-0022 wrote and this data cannot honour. That blind spot is
 * recorded rather than guessed at, and it is not new: `TRANSFER_MINUTES` already charged every one
 * of these boundaries before decomposition made them visible.
 *
 * A Journey with no ride at all is one walking Path (§7), not an `UnknownPath` — a haversine walk
 * estimate is a computed route, and the absent `kind` is reserved for no route computed at all.
 */
function decompose(
  graph: TransitGraph,
  adjacency: Adjacency,
  from: PathEndpoint,
  to: PathEndpoint,
  steps: Step[],
  endStopId: string,
  totalCost: TravelCost
): Path[] {
  if (steps.length === 0) return [{ kind: "walking", from, to, travelCost: totalCost }];

  const paths: Path[] = [];
  const access = walkPathOf(from, endpointOfStop(graph, steps[0].fromStopId));
  if (access) paths.push(access);

  let run: RideStep[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    paths.push(railPathOf(graph, adjacency, run));
    run = [];
  };

  for (const step of steps) {
    if (step.kind === "transfer") {
      flushRun();
      paths.push(transferPathOf(graph, step));
      continue;
    }
    if (run.length > 0 && run[run.length - 1].lineName !== step.lineName) flushRun();
    run.push(step);
  }
  flushRun();

  const egress = walkPathOf(endpointOfStop(graph, endStopId), to);
  if (egress) paths.push(egress);

  return paths;
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

/** The graph search's result before it's decomposed into a `Path[]`. `steps` is empty for a caller
 * that did not ask for them (`costMatrix`, ADR-0030 §11) — it reads `travelCost` and nothing
 * else — and can also be legitimately empty for a Journey that never rode anything (ADR-0032 §7).
 * `endStopId` is where the Journey alighted, which the egress walk needs and the search already
 * had to pick. */
interface JourneyResult {
  travelCost: TravelCost;
  steps: Step[];
  endStopId: string;
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
  return { travelCost, steps: result.steps, endStopId: best.toStopId };
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
      return decompose(
        graph,
        buildAdjacency(graph),
        from,
        to,
        journey.steps,
        journey.endStopId,
        journey.travelCost
      );
    },
  };
}
