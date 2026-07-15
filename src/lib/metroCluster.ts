/**
 * Shared metro-scale clustering (#116). Geo-groups a trip's activity Locations into distinct
 * metro clusters and matches each to a covering lodging within a metro-scale radius — the one
 * detector #115 locks the optimizer's coverage check (#118), the post-import wizard's per-metro
 * prompts (#119), and #110's cross-metro warning onto, so no second heuristic re-derives this.
 *
 * Single-linkage clustering by radius, not k-means (optimizer.ts's day-clustering): there is no
 * known cluster count here, and a metro's stops should merge as one group regardless of how many
 * there are. Mirrors the same radius-growing approach transitGraphIngest.ts uses for station
 * clusters, applied to activities instead of stop nodes.
 */

import { haversineMeters, type Point } from "@/lib/travelCost";
import type { Activity, Lodging } from "@/types";

/** Distance below which two locations count as the same metro rather than distinct destinations.
 * Wide enough to span one metro's spread (central city to its suburbs) but well under the gap
 * between actually-distant destinations (Osaka↔Tokyo, ~400km) — a build-time tunable, seeded from
 * #110's "inter-metro gap, not intra-city spread" scoping. Single source of truth: no caller
 * defines its own threshold. */
export const METRO_CLUSTER_RADIUS_METERS = 75_000;

export interface MetroCluster {
  activities: Activity[];
  centroid: Point;
  /** The lodging covering this cluster — within METRO_CLUSTER_RADIUS_METERS of the centroid — or
   * null when no lodging in the trip reaches it. */
  lodging: Lodging | null;
}

function pointOf(l: { lat: number | null; lng: number | null }): Point | null {
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
 * Groups `activities` into metro clusters and matches each to a covering `lodging`, if any is
 * within METRO_CLUSTER_RADIUS_METERS of the cluster's centroid. Activities without real
 * coordinates (not yet geocoded) are dropped — they carry no geography to cluster on.
 */
export function clusterByMetro(activities: Activity[], lodgings: Lodging[]): MetroCluster[] {
  const remaining = activities
    .map((activity) => ({ activity, point: pointOf(activity) }))
    .filter((r): r is { activity: Activity; point: Point } => r.point !== null);
  const validLodgings = lodgings
    .map((l) => ({ lodging: l, point: pointOf(l) }))
    .filter((r): r is { lodging: Lodging; point: Point } => r.point !== null);

  const groups: { activity: Activity; point: Point }[][] = [];

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
    const lodging =
      validLodgings.find((l) => haversineMeters(l.point, centroid) <= METRO_CLUSTER_RADIUS_METERS)?.lodging ?? null;
    return { activities: group.map((g) => g.activity), centroid, lodging };
  });
}
