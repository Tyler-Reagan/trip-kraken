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
 */

export interface LocationInput {
  id: string;
  lat: number;
  lng: number;
  visitDuration?: number;   // minutes; used for day duration balancing
  openTime?: string;        // "HH:MM" 24-hour; soft time-window constraint
  closeTime?: string;       // "HH:MM" 24-hour; soft time-window constraint
  categories?: string[];    // Google Places categories; used for cross-day balance
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
}

export function optimizeItinerary(
  locations: LocationInput[],
  numDays: number,
  stays: StayPlan[] = [],
  dayBudgetMinutes?: number,
  dayStartMins = 9 * 60,   // assumed start-of-day for time-window simulation (default 09:00)
  edges: EdgeAnchors = {}
): DayPlan[] {
  if (locations.length === 0) return [];

  const days = numDays > 0 ? numDays : 1;
  const byId = new Map(locations.map((l) => [l.id, l]));

  // Trip-edge anchors (ADR-0005, #54): resolved only when present with valid coordinates.
  const resolveAnchor = (id: string | null | undefined): LocationInput | null => {
    if (!id) return null;
    const l = byId.get(id);
    return l && (l.lat !== 0 || l.lng !== 0) ? l : null;
  };
  const arrival = resolveAnchor(edges.arrivalId);
  const departure = resolveAnchor(edges.departureId);

  // Anchors are never clustered or emitted as stops: lodgings (from their night-ranges) plus the
  // trip edges. Clustering pull stays on lodgings; arrival/departure only override the *sequencing*
  // endpoints at the first/last Day.
  const anchorIds = new Set(stays.map((s) => s.lodgingId));
  if (edges.arrivalId) anchorIds.add(edges.arrivalId);
  if (edges.departureId) anchorIds.add(edges.departureId);

  // The lodging you sleep at on night d — the day's clustering tether (k-means), unchanged.
  const lodgingOnNight = (night: number): LocationInput | null => {
    const s = stays.find((s) => night >= s.startNight && night <= s.endNight);
    return s ? byId.get(s.lodgingId) ?? null : null;
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
  const valid = pool.filter((l) => l.lat !== 0 || l.lng !== 0);
  const invalid = pool.filter((l) => l.lat === 0 && l.lng === 0);

  // Fewer locations than days: one per day, anchored at that day's lodging.
  if (valid.length <= days) {
    const plans: DayPlan[] = [];
    for (let d = 0; d < days; d++) {
      const ordered = sequenceDay(valid[d] ? [valid[d]] : [], seqStart[d] ?? undefined, dayStartMins, seqEnd[d] ?? undefined);
      plans.push({ dayNumber: d + 1, locationIds: ordered.map((l) => l.id) });
    }
    if (invalid.length > 0) plans[plans.length - 1].locationIds.push(...invalid.map((l) => l.id));
    return plans;
  }

  // Phase 1: k-means clustering of stops, centroids tethered toward each lodging.
  const clusters = kMeans(valid, days, dayAnchor, dayBudgetMinutes);

  // Phase 2: per day, sequence its stops between the day's woke/sleep anchors.
  const plans: DayPlan[] = clusters.map((cluster, d) => {
    const ordered = sequenceDay(cluster, seqStart[d] ?? undefined, dayStartMins, seqEnd[d] ?? undefined);
    return { dayNumber: d + 1, locationIds: ordered.map((l) => l.id) };
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
  endAnchor?: LocationInput
): LocationInput[] {
  if (!endAnchor) {
    return twoOpt(nearestNeighborOrder(stops, dayStartMins, anchor), dayStartMins);
  }
  const route: LocationInput[] = [];
  for (const u of stops) {
    let bestPos = route.length;
    let bestCost = Infinity;
    for (let pos = 0; pos <= route.length; pos++) {
      const prev = pos === 0 ? anchor : route[pos - 1];
      const next = pos < route.length ? route[pos] : endAnchor;
      const added =
        (prev ? haversine(prev, u) : 0) +
        (next ? haversine(u, next) : 0) -
        (prev && next ? haversine(prev, next) : 0);
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

  // Pre-compute ideal category distribution across days (cross-day balance).
  const allCategories = locations.flatMap((l) => l.categories ?? []);
  const uniqueCategories = [...new Set(allCategories)];
  const idealCategoryCounts: Record<string, number> = {};
  for (const cat of uniqueCategories) {
    const total = locations.filter((l) => l.categories?.includes(cat)).length;
    idealCategoryCounts[cat] = total / k;
  }

  for (let iter = 0; iter < 100; iter++) {
    // Day durations from the previous assignment, so the cost can penalise over-budget days.
    const dayDurations = dayBudgetMinutes
      ? Array.from({ length: k }, (_, c) =>
          locations.filter((_, i) => assignments[i] === c).reduce((sum, l) => sum + (l.visitDuration ?? 0), 0)
        )
      : undefined;

    const dayCategoryCounts: Record<string, number>[] = Array.from({ length: k }, () => ({}));
    if (uniqueCategories.length > 0) {
      locations.forEach((loc, i) => {
        for (const cat of loc.categories ?? []) {
          dayCategoryCounts[assignments[i]][cat] = (dayCategoryCounts[assignments[i]][cat] ?? 0) + 1;
        }
      });
    }

    const newAssignments = locations.map((loc) =>
      nearestCentroidIndex(loc, centroids, dayDurations, dayBudgetMinutes, dayCategoryCounts, idealCategoryCounts)
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
      const d = Math.min(...centroids.map((cc) => haversine(loc, cc)));
      if (d > bestDist) { bestDist = d; best = loc; }
    }
    centroids.push({ id: `c${c}`, lat: best.lat, lng: best.lng });
  }
  return centroids;
}

// Category balance penalty scale: ~1 km per unit excess over ideal count.
// Keeps geographic proximity dominant while gently spreading categories across days.
const CATEGORY_BALANCE_KM = 1.0;

function nearestCentroidIndex(
  loc: LocationInput,
  centroids: Centroid[],
  dayDurations?: number[],
  dayBudgetMinutes?: number,
  dayCategoryCounts?: Record<string, number>[],
  idealCategoryCounts?: Record<string, number>
): number {
  let best = 0;
  let bestCost = Infinity;
  centroids.forEach((c, i) => {
    let cost = haversine(loc, c);

    // Soft duration penalty: add 2 km per hour that this assignment would put
    // the day over budget. Keeps geographic proximity dominant while nudging
    // stops away from already-full days.
    if (dayDurations && dayBudgetMinutes) {
      const excess = Math.max(
        0,
        dayDurations[i] + (loc.visitDuration ?? 0) - dayBudgetMinutes
      );
      cost += (excess / 60) * 2;
    }

    // Soft category balance penalty: penalize concentrating the same category
    // on one day. For each category of this location, add penalty proportional
    // to how much the day would exceed the ideal per-day count.
    if (dayCategoryCounts && idealCategoryCounts) {
      for (const cat of loc.categories ?? []) {
        const current = dayCategoryCounts[i][cat] ?? 0;
        const ideal = idealCategoryCounts[cat] ?? 0;
        const excess = Math.max(0, current + 1 - ideal);
        cost += excess * CATEGORY_BALANCE_KM;
      }
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
  dayStartMins = 9 * 60,
  lodging?: LocationInput
): LocationInput[] {
  if (locations.length <= 1) return locations;

  const unvisited = [...locations];
  const ordered: LocationInput[] = [];
  let timeMins = dayStartMins;

  if (lodging) {
    // Start greedy walk from lodging's position (lodging itself is not in the stop list)
    ordered.push({ ...lodging, id: "__lodging_start__" });
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
      const travelTime = haversine(last, loc) / AVG_SPEED_KM_PER_MIN;
      const cost = haversine(last, loc) + windowPenaltyKm(timeMins + travelTime, loc);
      if (cost < nearestCost) {
        nearestCost = cost;
        nearestIdx = i;
      }
    });
    const next = unvisited.splice(nearestIdx, 1)[0];
    ordered.push(next);
    timeMins += haversine(last, next) / AVG_SPEED_KM_PER_MIN + (next.visitDuration ?? DEFAULT_VISIT_MINS);
  }

  // Remove the sentinel lodging entry used only as a starting position
  return ordered.filter((l) => l.id !== "__lodging_start__");
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
function twoOpt(locations: LocationInput[], dayStartMins = 9 * 60): LocationInput[] {
  if (locations.length <= 2) return locations;

  let route = [...locations];
  const n = route.length;
  const hasTimeWindows = route.some((l) => l.openTime || l.closeTime);
  let currentWindowPenalty = hasTimeWindows ? routeWindowPenalty(route, dayStartMins) : 0;
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        const oldCost =
          haversine(route[i], route[i + 1]) +
          (j < n - 1 ? haversine(route[j], route[j + 1]) : 0);
        const newCost =
          haversine(route[i], route[j]) +
          (j < n - 1 ? haversine(route[i + 1], route[j + 1]) : 0);

        if (newCost < oldCost - 1e-10) {
          const candidate = [
            ...route.slice(0, i + 1),
            ...route.slice(i + 1, j + 1).reverse(),
            ...route.slice(j + 1),
          ];

          // Reject swaps that worsen time-window compliance
          if (hasTimeWindows) {
            const newWindowPenalty = routeWindowPenalty(candidate, dayStartMins);
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

// ---------------------------------------------------------------------------
// Time-window helpers
// ---------------------------------------------------------------------------

// Assumed visit time when visitDuration is not set (used only for arrival simulation)
const DEFAULT_VISIT_MINS = 60;

// Average city travel speed for estimating arrival times (20 km/h)
const AVG_SPEED_KM_PER_MIN = 20 / 60;

// Penalty scale factors (km-equivalent per minute of violation).
// LATE is 10× EARLY: arriving after close is far worse than arriving before open.
const WINDOW_EARLY_KM_PER_MIN = 0.5;
const WINDOW_LATE_KM_PER_MIN  = 5;

/** Parses a "HH:MM" string to minutes from midnight. */
function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Returns a km-equivalent soft penalty for visiting `loc` when the simulated
 * clock reads `arrivalMins` minutes from midnight.
 *
 * Three cases penalised:
 *   1. Arriving before open  → waiting cost (mild)
 *   2. Arriving after close  → missed window (severe)
 *   3. Visit runs past close → partial overrun (severe)
 */
function windowPenaltyKm(arrivalMins: number, loc: LocationInput): number {
  const vd    = loc.visitDuration ?? DEFAULT_VISIT_MINS;
  const open  = loc.openTime  ? timeToMins(loc.openTime)  : null;
  const close = loc.closeTime ? timeToMins(loc.closeTime) : null;
  let penalty = 0;
  if (open  !== null && arrivalMins < open)
    penalty += (open - arrivalMins) * WINDOW_EARLY_KM_PER_MIN;
  if (close !== null && arrivalMins > close)
    penalty += (arrivalMins - close) * WINDOW_LATE_KM_PER_MIN;
  if (close !== null && arrivalMins + vd > close)
    penalty += (arrivalMins + vd - close) * WINDOW_LATE_KM_PER_MIN;
  return penalty;
}

/**
 * Simulates travel through a route and sums all time-window penalties.
 * Used by twoOpt to guard against swaps that worsen temporal ordering.
 */
function routeWindowPenalty(route: LocationInput[], dayStartMins: number): number {
  let t = dayStartMins;
  let p = 0;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) t += haversine(route[i - 1], route[i]) / AVG_SPEED_KM_PER_MIN;
    p += windowPenaltyKm(t, route[i]);
    t += route[i].visitDuration ?? DEFAULT_VISIT_MINS;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Haversine distance (returns kilometres)
// ---------------------------------------------------------------------------

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const x =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
