/**
 * #110's detector: does a trip's included Activities span 2+ metro-scale clusters the lodging
 * timeline doesn't already explain? Reuses `clusterByMetro` (#116) — the same detector the
 * optimizer's own pre-flight coverage check (ADR-0023 §7) and the map's metro tabs use — rather
 * than a second, independently-tuned heuristic.
 *
 * "Pre-optimize" means before any Day exists to read stops from, so this clusters over every
 * included Location directly. `tripMetros.ts`'s `metrosOf` clusters over the *placed* stops
 * instead — the right tool for map/day navigation, empty and useless before a first optimize,
 * which is exactly when this warning needs to fire.
 */

import { clusterByMetro } from "@/lib/metroCluster";
import { metroLabel } from "@/lib/tripMetros";
import { isActivity, isLodging, type TripWithDetails } from "@/types";

export interface UncoveredMetro {
  label: string;
  activityCount: number;
}

/**
 * Null when there's nothing to say: fewer than 2 clusters (ordinary single-metro spread, however
 * wide), or every cluster already has a covering lodging — a deliberate multi-city trip with a
 * hotel booked in each city is not a problem, and warning about it would be noise (#110's
 * suppression criterion).
 */
export function detectUncoveredSplit(trip: TripWithDetails): UncoveredMetro[] | null {
  const activities = trip.locations.filter((l) => isActivity(l) && !l.excluded);
  const lodgings = trip.locations.filter(isLodging);
  const clusters = clusterByMetro(activities, lodgings);
  if (clusters.length < 2) return null;

  const uncovered = clusters.filter((c) => c.lodgings.length === 0);
  if (uncovered.length === 0) return null;

  return uncovered.map((c) => ({ label: metroLabel(c), activityCount: c.activities.length }));
}
