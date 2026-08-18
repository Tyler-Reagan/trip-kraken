/**
 * The Day-to-pairs rule (ADR-0029 §5, #182): which Location-to-Location pairs the map draws a line
 * between, and how one is keyed.
 *
 * This was inline in `MapView.tsx`'s route-building `useMemo`, where it was only ever a list of raw
 * coordinates to connect. It is extracted because the map now looks each pair up — so the chain's
 * exact composition (which Anchors are on it, in what order) became a rule worth testing rather than
 * a detail of building one `LineString`.
 *
 * A "pair" is deliberately not a Path: it is the *request*, two endpoints we want the travel between.
 * What comes back is one or more Paths, since a provider splits a pair at every shift (ADR-0022).
 */

import type { DerivedDay } from "@/types";
import type { PathEndpoint, RoadProfile } from "@/types/path";

export interface PathPair {
  from: PathEndpoint;
  to: PathEndpoint;
}

/** Anything on a Day's chain: a stop's Location, or a projected Anchor. */
type Positioned = { id: string; lat: number | null; lng: number | null };

/**
 * The Day's chain in draw order — start Anchor, check-in waypoint, stops, end Anchor. Ungeocoded
 * entries drop out rather than breaking the chain: two stops either side of a Location with no
 * coordinates become adjacent, which is what the map already drew before this module existed.
 */
function chainOfDay(day: DerivedDay): PathEndpoint[] {
  const chain: PathEndpoint[] = [];
  const push = (loc: Positioned | null) => {
    if (loc && loc.lat !== null && loc.lng !== null) {
      chain.push({ lat: loc.lat, lng: loc.lng, locationId: loc.id });
    }
  };

  push(day.startAnchor);
  // The check-in waypoint sits before the day's stops: bags are dropped at the new lodging on
  // arrival (ADR-0013 Phase 2), at the same place as the overnight Anchor.
  push(day.checkInWaypoint);
  for (const stop of day.stops) push(stop.location);
  push(day.endAnchor);

  return chain;
}

/** Consecutive pairs along one Day's chain. A Day with fewer than two positioned entries has none. */
export function pairsOfDay(day: DerivedDay): PathPair[] {
  const chain = chainOfDay(day);
  const pairs: PathPair[] = [];
  for (let i = 0; i + 1 < chain.length; i++) pairs.push({ from: chain[i], to: chain[i + 1] });
  return pairs;
}

/** Six decimal places is ~0.1 m — far finer than `ROAD_SNAP_MAX_METERS`, so no two genuinely
 * distinct requests collide, and identical coordinates always produce an identical string
 * regardless of how the float was arrived at. */
const coordOf = (p: PathEndpoint) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

/**
 * The cache key for one pair's answer (ADR-0029 §5). Keyed on coordinates rather than `locationId`
 * so that re-geocoding a Location invalidates its entries by construction, and on the Road profile
 * because it selects which OSRM graph answered — changing it makes every held answer wrong.
 */
export function pairKey(profile: RoadProfile, pair: PathPair): string {
  return `${profile}:${coordOf(pair.from)}>${coordOf(pair.to)}`;
}

/** Every distinct pair across the Trip's Days, in first-seen order. Days share pairs routinely — a
 * lodging Anchor bookends consecutive Days — and each distinct pair is worth exactly one lookup. */
export function uniquePairsOfDays(days: DerivedDay[], profile: RoadProfile): PathPair[] {
  const seen = new Map<string, PathPair>();
  for (const day of days) {
    for (const pair of pairsOfDay(day)) {
      const key = pairKey(profile, pair);
      if (!seen.has(key)) seen.set(key, pair);
    }
  }
  return [...seen.values()];
}
