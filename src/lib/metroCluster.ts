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

import { haversineMeters, type Point } from "@/lib/geo";

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
  /** May be **empty**: a lodging covering no activity-founded metro founds its own (ADR-0020,
   * amended 2026-08-17), and a metro you sleep in with nothing planned yet has no activities at
   * all. Consumers must not assume `activities[0]` exists. */
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

type Placed<T> = { item: T; point: Point };

function placed<T extends Geocodable>(items: T[]): Placed<T>[] {
  return items
    .map((item) => ({ item, point: pointOf(item) }))
    .filter((r): r is Placed<T> => r.point !== null);
}

/** Single-linkage grouping at METRO_CLUSTER_RADIUS_METERS — one member within the radius pulls the
 * whole group in, so a metro's spread merges regardless of how many members it has. Shared by both
 * founding passes below so they can't drift into two thresholds. */
function groupByProximity<T>(items: Placed<T>[]): Placed<T>[][] {
  const remaining = [...items];
  const groups: Placed<T>[][] = [];

  while (remaining.length > 0) {
    const bucket = [remaining.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (
          bucket.some(
            (b) =>
              haversineMeters(b.point, remaining[i].point) <=
              METRO_CLUSTER_RADIUS_METERS,
          )
        ) {
          bucket.push(...remaining.splice(i, 1));
          grew = true;
        }
      }
    }
    groups.push(bucket);
  }

  return groups;
}

/**
 * Groups a trip's Locations into metros (ADR-0020, amended 2026-08-17). Locations without real
 * coordinates (not yet geocoded) are dropped — they carry no geography to group on.
 *
 * Two founding passes, in this order, and the order is the point:
 *
 * 1. **Activities found metros**, each matched to every lodging within the radius of its centroid —
 *    a metro can have several (a mid-stay hotel change), so this is never collapsed to "the" lodging.
 * 2. **A lodging covering none of them founds its own**, merging with other such lodgings. A place
 *    you sleep is a destination whether or not anything is planned there yet, and without this a
 *    lodging-only region has no metro at all — which reaches `request.ts`'s "no anchor resolved"
 *    fallback and hands that Day *every* metro's skills.
 *
 * Running the second pass over what the first one left, rather than seeding one pass with both
 * kinds, is what keeps it safe: a lodging sitting between two activity groups would **bridge** them
 * into a single metro under single-linkage, silently changing coverage for trips unrelated to the
 * case this exists for. Pass 2 cannot bridge, because the groups it might have bridged are closed.
 */
export function clusterByMetro<A extends Geocodable, L extends Geocodable>(
  activities: A[],
  lodgings: L[],
): MetroCluster<A, L>[] {
  const validLodgings = placed(lodgings);

  const activityFounded = groupByProximity(placed(activities)).map((group) => {
    const centroid = centroidOf(group.map((g) => g.point));
    return {
      activities: group.map((g) => g.item),
      centroid,
      lodgings: validLodgings
        .filter(
          (l) =>
            haversineMeters(l.point, centroid) <= METRO_CLUSTER_RADIUS_METERS,
        )
        .map((l) => l.item),
    };
  });

  // Reference identity, not id: these are the very objects pass 1 just put in its `lodgings`.
  const covered = new Set(activityFounded.flatMap((m) => m.lodgings));
  const lodgingFounded = groupByProximity(
    validLodgings.filter((l) => !covered.has(l.item)),
  ).map((group) => ({
    activities: [] as A[],
    centroid: centroidOf(group.map((g) => g.point)),
    lodgings: group.map((g) => g.item),
  }));

  // Activity-founded first, so an existing trip's ordinals don't shift when a lodging-founded
  // metro appears — `preflight.ts` uses the index as the skill ordinal.
  return [...activityFounded, ...lodgingFounded];
}
