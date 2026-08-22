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

import type { DerivedDay, Location, ScheduledStop } from "@/types";
import type { PathEndpoint, RoadProfile } from "@/types/path";

export interface PathPair {
  from: PathEndpoint;
  to: PathEndpoint;
}

/** What role an entry plays in a Day's chain (ADR-0036) — not a routing fact, just enough for a
 *  render surface to pick the right row component. */
export type ChainRole = "start" | "checkin" | "stop" | "end";

export interface ChainEntry {
  role: ChainRole;
  location: Location;
  /** Only set when `role === "stop"` — what `StopRow`/`PanelStopRow` need beyond the bare Location
   *  (drag identity, position for the day-color index, along-the-way scoping). */
  stop?: ScheduledStop;
  index?: number;
}

/**
 * Every entry in a Day's chain, in render order — start Anchor, check-in waypoint, stops, end
 * Anchor (ADR-0013 Phase 2: the check-in waypoint sits before the day's stops, since bags are
 * dropped at the new lodging on arrival). Ungeocoded entries are kept, unlike `chainOfDay` below —
 * a list surface still renders a disabled row for a stop with no coordinates; only the coordinate-
 * keyed routing side needs to drop them.
 *
 * This is the one place "what's in a Day's chain, in what order" is decided (ADR-0036) — DayCard's
 * `<ol>` and MapView's `StopPanel` both drive their entire render off it, so the two surfaces can't
 * structurally disagree about which Locations exist or which gaps between them are real. Before
 * this existed, each surface hand-enumerated its own anchor/stop conditionals, and one enumeration
 * silently missed the case where a Day has only anchors and no stops at all — an anchor-to-anchor
 * gap (e.g. arrival → check-in) got no connector rendered anywhere, though a real Path exists
 * between them.
 */
export function dayChainEntries(day: DerivedDay): ChainEntry[] {
  const entries: ChainEntry[] = [];
  if (day.startAnchor) entries.push({ role: "start", location: day.startAnchor });
  if (day.checkInWaypoint) entries.push({ role: "checkin", location: day.checkInWaypoint });
  day.stops.forEach((stop, index) => entries.push({ role: "stop", location: stop.location, stop, index }));
  if (day.endAnchor) entries.push({ role: "end", location: day.endAnchor });
  return entries;
}

/** Consecutive pairs among `dayChainEntries` — every gap a list surface should offer a connector
 *  for. Rendering still no-ops per pair when either end lacks coordinates (each row component's own
 *  guard, unchanged); this function's only job is deciding *which* adjacent Locations are a real
 *  gap at all, so that decision is made once rather than by hand in every consumer. */
export function dayChainPairs(day: DerivedDay): { from: Location; to: Location }[] {
  const entries = dayChainEntries(day);
  const pairs: { from: Location; to: Location }[] = [];
  for (let i = 0; i + 1 < entries.length; i++) {
    pairs.push({ from: entries[i].location, to: entries[i + 1].location });
  }
  return pairs;
}

/**
 * The Day's chain, coordinates only, geocoded entries alone — what a routing request can actually
 * key on. Built on `dayChainEntries` above rather than re-deriving the same ordering rule a second
 * time; ungeocoded entries drop out here (and only here) so two geocoded stops either side of an
 * ungeocoded one become adjacent for routing purposes, matching what the map already drew before
 * this module existed.
 */
function chainOfDay(day: DerivedDay): PathEndpoint[] {
  const chain: PathEndpoint[] = [];
  for (const { location: loc } of dayChainEntries(day)) {
    if (loc.lat !== null && loc.lng !== null) {
      chain.push({ lat: loc.lat, lng: loc.lng, locationId: loc.id });
    }
  }
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

/** Identity for one decomposed shift within a gap's chain (ADR-0036) — a pair's `pairKey` plus its
 *  position in the `Path[]` that pair resolved to. Exists so `MapView`'s hover-highlight (tagging
 *  drawn features) and `StopPanel`'s hover wiring (setting the highlighted id) agree on the same
 *  string without each re-deriving the format. */
export function pathShiftId(key: string, index: number): string {
  return `${key}:${index}`;
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
