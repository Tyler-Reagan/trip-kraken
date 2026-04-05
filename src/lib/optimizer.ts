/**
 * Itinerary optimizer — two-phase approach:
 *
 * Phase 1 — Cluster locations into days (k-means on lat/lng)
 *   Geographically close locations are grouped into the same day to minimize
 *   travel between days.
 *
 * Phase 2 — Order stops within each day (nearest-neighbor TSP)
 *   Within a cluster, find a short visiting order using a greedy
 *   nearest-neighbor heuristic. Good enough for typical trip sizes (≤ 20
 *   stops/day) and requires no external API.
 */

export interface LocationInput {
  id: string;
  lat: number;
  lng: number;
}

export interface DayPlan {
  dayNumber: number;
  locationIds: string[];
}

export function optimizeItinerary(
  locations: LocationInput[],
  numDays: number
): DayPlan[] {
  if (locations.length === 0) return [];

  // Filter out locations without valid coordinates
  const valid = locations.filter((l) => l.lat !== 0 || l.lng !== 0);
  const invalid = locations.filter((l) => l.lat === 0 && l.lng === 0);

  const days = numDays > 0 ? numDays : 1;

  // If fewer locations than days, each location gets its own day
  if (valid.length <= days) {
    const plans: DayPlan[] = valid.map((loc, i) => ({
      dayNumber: i + 1,
      locationIds: [loc.id],
    }));
    // Pad remaining days as empty
    for (let d = valid.length + 1; d <= days; d++) {
      plans.push({ dayNumber: d, locationIds: [] });
    }
    // Append invalid locations to last day
    if (invalid.length > 0 && plans.length > 0) {
      plans[plans.length - 1].locationIds.push(...invalid.map((l) => l.id));
    }
    return plans;
  }

  // Phase 1: k-means clustering
  const clusters = kMeans(valid, days);

  // Phase 2: nearest-neighbor TSP within each cluster
  const plans: DayPlan[] = clusters.map((cluster, i) => ({
    dayNumber: i + 1,
    locationIds: nearestNeighborOrder(cluster).map((l) => l.id),
  }));

  // Distribute locations with missing coordinates across days round-robin
  invalid.forEach((loc, i) => {
    plans[i % plans.length].locationIds.push(loc.id);
  });

  return plans;
}

// ---------------------------------------------------------------------------
// K-means clustering
// ---------------------------------------------------------------------------

function kMeans(locations: LocationInput[], k: number): LocationInput[][] {
  // Initialise centroids using k-means++ seeding
  const centroids = kMeansPlusPlusInit(locations, k);
  let assignments = new Array<number>(locations.length).fill(0);

  for (let iter = 0; iter < 100; iter++) {
    // Assign each location to the nearest centroid
    const newAssignments = locations.map((loc) =>
      nearestCentroidIndex(loc, centroids)
    );

    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Recompute centroids as the mean of their assigned locations
    for (let c = 0; c < k; c++) {
      const members = locations.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;
      centroids[c] = {
        id: `centroid-${c}`,
        lat: members.reduce((s, l) => s + l.lat, 0) / members.length,
        lng: members.reduce((s, l) => s + l.lng, 0) / members.length,
      };
    }
  }

  // Collect clusters
  const clusters: LocationInput[][] = Array.from({ length: k }, () => []);
  locations.forEach((loc, i) => clusters[assignments[i]].push(loc));

  // Merge empty clusters into the largest one to ensure k non-empty days
  // when there are fewer locations than k
  return clusters;
}

function kMeansPlusPlusInit(
  locations: LocationInput[],
  k: number
): LocationInput[] {
  const centroids: LocationInput[] = [];
  // Pick a random first centroid
  centroids.push(locations[Math.floor(Math.random() * locations.length)]);

  while (centroids.length < k) {
    // For each location compute its distance to the nearest centroid
    const distances = locations.map((loc) => {
      const d = Math.min(...centroids.map((c) => haversine(loc, c)));
      return d * d;
    });
    const total = distances.reduce((s, d) => s + d, 0);
    // Pick next centroid with probability proportional to distance²
    let threshold = Math.random() * total;
    for (let i = 0; i < locations.length; i++) {
      threshold -= distances[i];
      if (threshold <= 0) {
        centroids.push(locations[i]);
        break;
      }
    }
    if (centroids.length < k) centroids.push(locations[locations.length - 1]);
  }

  return centroids;
}

function nearestCentroidIndex(
  loc: LocationInput,
  centroids: LocationInput[]
): number {
  let best = 0;
  let bestDist = Infinity;
  centroids.forEach((c, i) => {
    const d = haversine(loc, c);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Nearest-neighbor TSP
// ---------------------------------------------------------------------------

function nearestNeighborOrder(locations: LocationInput[]): LocationInput[] {
  if (locations.length <= 1) return locations;

  const unvisited = [...locations];
  const ordered: LocationInput[] = [];

  // Start from the northernmost location (top of the map feels natural)
  unvisited.sort((a, b) => b.lat - a.lat);
  const first = unvisited.shift();
  if (!first) throw new Error("nearestNeighborOrder: unexpected empty array after length guard");
  ordered.push(first);

  while (unvisited.length > 0) {
    const last = ordered[ordered.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;
    unvisited.forEach((loc, i) => {
      const d = haversine(last, loc);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    });
    ordered.push(unvisited.splice(nearestIdx, 1)[0]);
  }

  return ordered;
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
