/**
 * Itinerary optimizer — a pure, day-indexed, two-phase solver (ADR-0015). It takes activities plus
 * lodging night-ranges and returns a plan as day-indexed `DayPlan`s; the caller (optimize.ts) maps
 * day numbers to dates and persists them as `Placement`s. It knows nothing of the DB, calendar
 * dates, or locking — re-optimize is wholesale, so there is no pinned state to honor.
 *
 * Phase 1 — Cluster locations into days (k-means on lat/lng)
 *   Geographically close locations are grouped into the same day to minimize travel between days.
 *   When the trip has lodgings, each day's centroid is tethered toward the night's lodging, so a
 *   location's city emerges from the same clustering cost rather than a separate assignment step.
 *
 * Phase 2 — Order stops within each day (nearest-neighbor TSP + 2-opt)
 *   Within a cluster, find a short visiting order between the day's start anchor (where you woke)
 *   and end anchor (where you sleep) — the same lodging on a round-trip day, a different one on a
 *   travel day (ADR-0005). Round-trip days use nearest-neighbor + 2-opt; days with a distinct end
 *   anchor (travel day, or a trip edge) route by cheapest insertion toward that end.
 *
 *   Time-window awareness: if locations carry openTime/closeTime fields, both phases add a
 *   km-equivalent soft penalty for arriving outside those windows. The penalty discourages
 *   out-of-hours visits but never hard-blocks them.
 *
 * The ADR-0001 objective (time-window, day-budget penalties) lives in `objective.ts` (ADR-0003's
 * "named, shared module"); this file owns the algorithm — clustering and sequencing — and calls
 * that module to score candidates rather than encoding penalties itself.
 *
 * Travel cost for sequencing (ADR-0004) comes from a `TravelCostProvider` (`travelCost.ts`), fetched
 * as one upfront `costMatrix` per optimize run rather than queried pair-by-pair inside the
 * construction loops — the batching ADR-0004's matrix form exists for. That's the only async part:
 * clustering's centroid distance stays on its own local, synchronous math (a centroid is a synthetic
 * point, not a real place a travel-cost provider has any business being asked about), and once the
 * matrix is fetched, sequencing itself reads from it synchronously — only `optimizeItinerary` awaits.
 */

import {
  windowPenaltyKm,
  routeWindowPenalty,
  dayBudgetPenaltyKm,
  DEFAULT_VISIT_MINS,
} from "@/lib/objective";
import {
  haversineProvider,
  buildDistanceLookup,
  haversineKm,
  hasValidCoords,
  type DistanceLookup,
  type TravelMode,
} from "@/lib/travelCost";

// No per-location travel-mode data exists yet; every sequencing query uses one mode until that
// changes (a category-A quality improvement, docs/optimizer-rebuild.md — not this slice).
export const DEFAULT_MODE: TravelMode = "walking";

export interface LocationInput {
  id: string;
  lat: number;
  lng: number;
  visitDuration?: number;   // minutes; used for day duration balancing
  openTime?: string;        // "HH:MM" 24-hour; soft time-window constraint
  closeTime?: string;       // "HH:MM" 24-hour; soft time-window constraint
}

/** A lodging occupied over a contiguous night-range (ADR-0015 — derived from its booking dates). */
export interface StayPlan {
  lodgingId: string;
  startNight: number;
  endNight: number;
}

/**
 * Trip-edge transport anchors (ADR-0005, #54): the Day-1 start and last-Day end Locations. Under
 * ADR-0015 these derive from the earliest/latest transit; that derivation is parked until transit
 * gains its constraint fields, so callers currently pass none. The routing below is kept so edge
 * anchoring re-activates for free once a source feeds it.
 */
export interface EdgeAnchors {
  arrivalId?: string | null;
  departureId?: string | null;
}

export interface DayPlan {
  dayNumber: number;
  locationIds: string[];
  /** The anchor sequencing woke from (a lodging or the arrival edge), if any — the same anchor
   * `sequenceDay` routed from. Exposed so a feasibility pass (solver.ts) can seed its arrival-time
   * simulation from the same starting point sequencing actually used, instead of re-deriving
   * lodging/edge anchor logic a second time. */
  startAnchor: LocationInput | null;
}

export async function optimizeItinerary(
  locations: LocationInput[],
  numDays: number,
  stays: StayPlan[] = [],
  dayBudgetMinutes?: number,
  dayStartMins = 9 * 60,   // assumed start-of-day for time-window simulation (default 09:00)
  edges: EdgeAnchors = {}
): Promise<DayPlan[]> {
  if (locations.length === 0) return [];

  const days = numDays > 0 ? numDays : 1;
  const byId = new Map(locations.map((l) => [l.id, l]));

  // Trip-edge anchors (ADR-0005, #54): resolved only when present with valid coordinates.
  const resolveAnchor = (id: string | null | undefined): LocationInput | null => {
    if (!id) return null;
    const l = byId.get(id);
    return l && hasValidCoords(l) ? l : null;
  };
  const arrival = resolveAnchor(edges.arrivalId);
  const departure = resolveAnchor(edges.departureId);

  // Anchors are never clustered or emitted as stops: lodgings (from their night-ranges) plus the
  // trip edges. Clustering pull stays on lodgings; arrival/departure only override the *sequencing*
  // endpoints at the first/last Day.
  const anchorIds = new Set(stays.map((s) => s.lodgingId));
  if (edges.arrivalId) anchorIds.add(edges.arrivalId);
  if (edges.departureId) anchorIds.add(edges.departureId);

  // The lodging you sleep at on night d — the day's clustering tether (k-means) and its
  // sequencing anchor. Resolved only when present with valid coordinates, same guard as
  // resolveAnchor above: an ungeocoded lodging must never become a dist.km/mins lookup key (it
  // was never included in validForDist below), and tethering a cluster toward (0,0) would be
  // nonsensical anyway. Falls back to no anchor — clustering seeds greedily, sequencing uses the
  // northernmost-start heuristic (both already handle a null anchor).
  const lodgingOnNight = (night: number): LocationInput | null => {
    const s = stays.find((s) => night >= s.startNight && night <= s.endNight);
    if (!s) return null;
    const l = byId.get(s.lodgingId);
    return l && hasValidCoords(l) ? l : null;
  };
  const dayAnchor: (LocationInput | null)[] = [];
  for (let d = 1; d <= days; d++) dayAnchor.push(lodgingOnNight(d));

  // Per-day routing endpoints (ADR-0005, #55): a Day's route runs from where you WOKE (the prior
  // night's lodging) to where you SLEEP (this night's lodging). They differ on a travel day (you
  // changed hotels) → an A→…→B open path; on a round-trip day they're equal, so only the start
  // anchors the walk (no forced return, unchanged from before). Day 1's start overrides to the
  // arrival edge, the last Day's end to the departure edge (#54).
  const seqStart: (LocationInput | null)[] = [];
  const seqEnd: (LocationInput | null)[] = [];
  for (let d = 1; d <= days; d++) {
    const start = d === 1 && arrival ? arrival : lodgingOnNight(d - 1);
    const end = d === days && departure ? departure : lodgingOnNight(d);
    seqStart.push(start);
    seqEnd.push(end && end.id !== start?.id ? end : null);
  }

  // Non-anchor Locations are the clustering pool (lodgings/edges are anchors, never stops).
  const pool = locations.filter((l) => !anchorIds.has(l.id));
  const valid = pool.filter(hasValidCoords);
  const invalid = pool.filter((l) => !hasValidCoords(l));

  // One upfront batch fetch (ADR-0004/O2) covering every point sequencing could ever need this run
  // (stops + all lodging/edge anchors) — every haversine/travel query below reads it synchronously.
  const validForDist = locations.filter(hasValidCoords);
  const dist = await buildDistanceLookup(haversineProvider, validForDist, DEFAULT_MODE);

  // Fewer locations than days: one per day, anchored at that day's lodging.
  if (valid.length <= days) {
    const plans: DayPlan[] = [];
    for (let d = 0; d < days; d++) {
      const ordered = sequenceDay(valid[d] ? [valid[d]] : [], seqStart[d] ?? undefined, dayStartMins, dist, seqEnd[d] ?? undefined);
      plans.push({ dayNumber: d + 1, locationIds: ordered.map((l) => l.id), startAnchor: seqStart[d] ?? null });
    }
    if (invalid.length > 0) plans[plans.length - 1].locationIds.push(...invalid.map((l) => l.id));
    return plans;
  }

  // Phase 1: k-means clustering of stops, centroids tethered toward each lodging.
  const clusters = kMeans(valid, days, dayAnchor, dayBudgetMinutes);

  // Phase 2: per day, sequence its stops between the day's woke/sleep anchors.
  const plans: DayPlan[] = clusters.map((cluster, d) => {
    const ordered = sequenceDay(cluster, seqStart[d] ?? undefined, dayStartMins, dist, seqEnd[d] ?? undefined);
    return { dayNumber: d + 1, locationIds: ordered.map((l) => l.id), startAnchor: seqStart[d] ?? null };
  });

  // Distribute coordinate-less locations across days round-robin.
  invalid.forEach((loc, i) => {
    plans[i % plans.length].locationIds.push(loc.id);
  });

  return plans;
}

/**
 * Order one day's stops. A round-trip day (no distinct end anchor) uses the nearest-neighbor +
 * 2-opt route anchored at its lodging. A day with a distinct end anchor (a travel day, or a trip
 * edge) builds by cheapest insertion toward that end: each stop is slotted into the gap that adds
 * the least travel, with `anchor` as the virtual pre-start and `endAnchor` as the virtual tail, so
 * the route is pulled to run anchor → … → endAnchor without either being emitted as a stop.
 */
function sequenceDay(
  stops: LocationInput[],
  anchor: LocationInput | undefined,
  dayStartMins: number,
  dist: DistanceLookup,
  endAnchor?: LocationInput
): LocationInput[] {
  if (!endAnchor) {
    return twoOpt(nearestNeighborOrder(stops, dayStartMins, dist, anchor), dayStartMins, dist);
  }
  const route: LocationInput[] = [];
  for (const u of stops) {
    let bestPos = route.length;
    let bestCost = Infinity;
    for (let pos = 0; pos <= route.length; pos++) {
      const prev = pos === 0 ? anchor : route[pos - 1];
      const next = pos < route.length ? route[pos] : endAnchor;
      const added =
        (prev ? dist.km(prev.id, u.id) : 0) +
        (next ? dist.km(u.id, next.id) : 0) -
        (prev && next ? dist.km(prev.id, next.id) : 0);
      if (added < bestCost) {
        bestCost = added;
        bestPos = pos;
      }
    }
    route.splice(bestPos, 0, u);
  }
  return route;
}

// ---------------------------------------------------------------------------
// K-means clustering
// ---------------------------------------------------------------------------

// How strongly a day's centroid is tethered to its Stay's lodging during recompute, in
// units of virtual members. Keeps a Stay's days in the right city while still letting
// real members spread them across neighbourhoods.
const STAY_ANCHOR_WEIGHT = 2;

type Centroid = { id: string; lat: number; lng: number };

function kMeans(
  locations: LocationInput[],
  k: number,
  anchors: (LocationInput | null)[],
  dayBudgetMinutes?: number
): LocationInput[][] {
  const centroids = seedCentroids(locations, k, anchors);
  let assignments = new Array<number>(locations.length).fill(0);

  for (let iter = 0; iter < 100; iter++) {
    // Day durations from the previous assignment, so the cost can penalise over-budget days.
    const dayDurations = dayBudgetMinutes
      ? Array.from({ length: k }, (_, c) =>
          locations.filter((_, i) => assignments[i] === c).reduce((sum, l) => sum + (l.visitDuration ?? 0), 0)
        )
      : undefined;

    const newAssignments = locations.map((loc) =>
      nearestCentroidIndex(loc, centroids, dayDurations, dayBudgetMinutes)
    );

    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Recompute centroids as the mean of members, tethered toward each day's anchor.
    for (let c = 0; c < k; c++) {
      const members = locations.filter((_, i) => assignments[i] === c);
      const anchor = anchors[c];
      if (members.length === 0) {
        if (anchor) centroids[c] = { id: `c${c}`, lat: anchor.lat, lng: anchor.lng };
        continue;
      }
      const sumLat = members.reduce((s, l) => s + l.lat, 0);
      const sumLng = members.reduce((s, l) => s + l.lng, 0);
      const w = anchor ? STAY_ANCHOR_WEIGHT : 0;
      const al = anchor ? anchor.lat : 0;
      const an = anchor ? anchor.lng : 0;
      centroids[c] = {
        id: `c${c}`,
        lat: (sumLat + w * al) / (members.length + w),
        lng: (sumLng + w * an) / (members.length + w),
      };
    }
  }

  const clusters: LocationInput[][] = Array.from({ length: k }, () => []);
  locations.forEach((loc, i) => clusters[assignments[i]].push(loc));
  return clusters;
}

/**
 * Seed one centroid per day. Days with a Stay anchor seed at the lodging (with a tiny
 * deterministic jitter so multiple days of one Stay don't start identical); days with no
 * Stay seed greedily at the location farthest from existing centroids (k-means++ in
 * spirit, deterministic).
 */
function seedCentroids(locations: LocationInput[], k: number, anchors: (LocationInput | null)[]): Centroid[] {
  const centroids: Centroid[] = [];
  for (let c = 0; c < k; c++) {
    const a = anchors[c];
    if (a) {
      const jitter = (c + 1) * 1e-3; // ~100 m, breaks ties between same-Stay days
      centroids.push({ id: `c${c}`, lat: a.lat + jitter, lng: a.lng + jitter });
      continue;
    }
    if (centroids.length === 0) {
      centroids.push({ id: `c${c}`, lat: locations[0].lat, lng: locations[0].lng });
      continue;
    }
    let best = locations[0];
    let bestDist = -1;
    for (const loc of locations) {
      const d = Math.min(...centroids.map((cc) => haversineKm(loc, cc)));
      if (d > bestDist) { bestDist = d; best = loc; }
    }
    centroids.push({ id: `c${c}`, lat: best.lat, lng: best.lng });
  }
  return centroids;
}

function nearestCentroidIndex(
  loc: LocationInput,
  centroids: Centroid[],
  dayDurations?: number[],
  dayBudgetMinutes?: number
): number {
  let best = 0;
  let bestCost = Infinity;
  centroids.forEach((c, i) => {
    let cost = haversineKm(loc, c);

    // Feasibility penalty (ADR-0001 #1) — geographic proximity stays dominant; this nudges stops
    // away from already-full days.
    if (dayDurations && dayBudgetMinutes) {
      cost += dayBudgetPenaltyKm(dayDurations[i] + (loc.visitDuration ?? 0), dayBudgetMinutes);
    }

    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Nearest-neighbor TSP
// ---------------------------------------------------------------------------

function nearestNeighborOrder(
  locations: LocationInput[],
  dayStartMins: number,
  dist: DistanceLookup,
  lodging?: LocationInput
): LocationInput[] {
  if (locations.length <= 1) return locations;

  const unvisited = [...locations];
  const ordered: LocationInput[] = [];
  let timeMins = dayStartMins;

  // Start entry used only as a walk position, never a real stop — kept as the same object
  // reference (not a renamed id) so it stays a valid `dist` lookup key, then filtered out by
  // identity below.
  let startEntry: LocationInput | null = null;
  if (lodging) {
    startEntry = lodging;
    ordered.push(startEntry);
    timeMins += lodging.visitDuration ?? DEFAULT_VISIT_MINS;
  } else {
    // Fall back to northernmost heuristic
    unvisited.sort((a, b) => b.lat - a.lat);
    const first = unvisited.shift();
    if (!first) throw new Error("nearestNeighborOrder: unexpected empty array after length guard");
    ordered.push(first);
    timeMins += first.visitDuration ?? DEFAULT_VISIT_MINS;
  }

  while (unvisited.length > 0) {
    const last = ordered[ordered.length - 1];
    let nearestIdx = 0;
    let nearestCost = Infinity;
    unvisited.forEach((loc, i) => {
      const cost = dist.km(last.id, loc.id) + windowPenaltyKm(timeMins + dist.mins(last.id, loc.id), loc);
      if (cost < nearestCost) {
        nearestCost = cost;
        nearestIdx = i;
      }
    });
    const next = unvisited.splice(nearestIdx, 1)[0];
    ordered.push(next);
    timeMins += dist.mins(last.id, next.id) + (next.visitDuration ?? DEFAULT_VISIT_MINS);
  }

  return startEntry ? ordered.filter((l) => l !== startEntry) : ordered;
}

// ---------------------------------------------------------------------------
// 2-opt local search
// ---------------------------------------------------------------------------

/**
 * Refines a route by iteratively reversing segments that reduce total
 * path length. Considers all edge pairs (i→i+1) and (j→j+1); if swapping
 * them by reversing the segment [i+1..j] shortens the route, applies the
 * swap and repeats until no improvement is found.
 *
 * Open-path variant: the last node has no outgoing edge, so the cost formula
 * drops the (j, j+1) term when j is the final index.
 *
 * Time-window guard: when any location in the route has openTime/closeTime,
 * a candidate swap is rejected if it worsens the route's total window penalty
 * (even if it improves distance). This prevents 2-opt from undoing the
 * time-aware ordering established by nearestNeighborOrder.
 */
function twoOpt(locations: LocationInput[], dayStartMins: number, dist: DistanceLookup): LocationInput[] {
  if (locations.length <= 2) return locations;

  let route = [...locations];
  const n = route.length;
  const hasTimeWindows = route.some((l) => l.openTime || l.closeTime);
  const travelMins = (a: LocationInput, b: LocationInput) => dist.mins(a.id, b.id);
  let currentWindowPenalty = hasTimeWindows ? routeWindowPenalty(route, dayStartMins, travelMins) : 0;
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        const oldCost =
          dist.km(route[i].id, route[i + 1].id) +
          (j < n - 1 ? dist.km(route[j].id, route[j + 1].id) : 0);
        const newCost =
          dist.km(route[i].id, route[j].id) +
          (j < n - 1 ? dist.km(route[i + 1].id, route[j + 1].id) : 0);

        if (newCost < oldCost - 1e-10) {
          const candidate = [
            ...route.slice(0, i + 1),
            ...route.slice(i + 1, j + 1).reverse(),
            ...route.slice(j + 1),
          ];

          // Reject swaps that worsen time-window compliance
          if (hasTimeWindows) {
            const newWindowPenalty = routeWindowPenalty(candidate, dayStartMins, travelMins);
            if (newWindowPenalty > currentWindowPenalty + 1e-10) continue;
            currentWindowPenalty = newWindowPenalty;
          }

          route = candidate;
          improved = true;
        }
      }
    }
  }

  return route;
}
