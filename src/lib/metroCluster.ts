/**
 * Shared metro-scale clustering (#116). Geo-groups a trip's activity Locations into distinct
 * metro clusters and matches each to every covering lodging within a metro-scale radius — the one
 * detector #115 locks the optimizer's coverage check (#118), the post-import wizard's per-metro
 * prompts (#119), and #110's cross-metro warning onto, so no second heuristic re-derives this.
 *
 * Single-linkage clustering by radius, not k-means (optimizer.ts's day-clustering): there is no
 * known cluster count here, and a metro's stops should merge as one group regardless of how many
 * there are. Mirrors the same radius-growing approach transitGraphIngest.ts uses for station
 * clusters, applied to activities instead of stop nodes.
 *
 * Generic over the point shape (not pinned to the domain `Activity`/`Lodging` types) so both the
 * DB-backed callers (full `Location`s, nullable lat/lng) and the optimizer's own `LocationInput`
 * (no `kind`, non-null lat/lng) can cluster through the same code rather than each converting to
 * the other's shape first.
 */

import { haversineMeters, type Point } from "@/lib/travelCost";

/** Distance below which two locations count as the same metro rather than distinct destinations.
 * Wide enough to span one metro's spread (central city to its suburbs) but well under the gap
 * between actually-distant destinations (Osaka↔Tokyo, ~400km) — a build-time tunable, seeded from
 * #110's "inter-metro gap, not intra-city spread" scoping. Single source of truth: no caller
 * defines its own threshold. */
export const METRO_CLUSTER_RADIUS_METERS = 75_000;

interface Geocodable {
  lat: number | null;
  lng: number | null;
}

export interface MetroCluster<A extends Geocodable, L extends Geocodable> {
  activities: A[];
  centroid: Point;
  /** Every lodging within METRO_CLUSTER_RADIUS_METERS of the centroid — a metro can have more than
   * one covering lodging (e.g. a mid-stay hotel change), so this is never collapsed to "the"
   * lodging. Empty when no lodging in the trip reaches it. */
  lodgings: L[];
}

function pointOf<T extends Geocodable>(l: T): Point | null {
  if (l.lat == null || l.lng == null) return null;
  const p = { lat: l.lat, lng: l.lng };
  return p.lat !== 0 || p.lng !== 0 ? p : null;
}

function centroidOf(points: Point[]): Point {
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}

/**
 * Groups `activities` into metro clusters and matches each to every covering `lodging` within
 * METRO_CLUSTER_RADIUS_METERS of the cluster's centroid. Activities without real coordinates (not
 * yet geocoded) are dropped — they carry no geography to cluster on.
 */
export function clusterByMetro<A extends Geocodable, L extends Geocodable>(
  activities: A[],
  lodgings: L[]
): MetroCluster<A, L>[] {
  const remaining = activities
    .map((activity) => ({ activity, point: pointOf(activity) }))
    .filter((r): r is { activity: A; point: Point } => r.point !== null);
  const validLodgings = lodgings
    .map((l) => ({ lodging: l, point: pointOf(l) }))
    .filter((r): r is { lodging: L; point: Point } => r.point !== null);

  const groups: { activity: A; point: Point }[][] = [];

  while (remaining.length > 0) {
    const bucket = [remaining.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (bucket.some((b) => haversineMeters(b.point, remaining[i].point) <= METRO_CLUSTER_RADIUS_METERS)) {
          bucket.push(...remaining.splice(i, 1));
          grew = true;
        }
      }
    }
    groups.push(bucket);
  }

  return groups.map((group) => {
    const centroid = centroidOf(group.map((g) => g.point));
    const covering = validLodgings
      .filter((l) => haversineMeters(l.point, centroid) <= METRO_CLUSTER_RADIUS_METERS)
      .map((l) => l.lodging);
    return { activities: group.map((g) => g.activity), centroid, lodgings: covering };
  });
}
