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

import type { DerivedDay, LegModePin, Location, ScheduledStop } from "@/types";
import type { PathEndpoint, PathKind, RoadProfile } from "@/types/path";

export interface PathPair {
  from: PathEndpoint;
  to: PathEndpoint;
}

/** The pin (if any) covering an unordered Location pair (issue #217/#219) — the read-side mirror
 *  of `canonicalPinPair` in `db/index.ts`: a pin's `locationAId`/`locationBId` are canonicalized
 *  (sorted) at the write path, so a caller naming the pair in either direction finds the same pin. */
export function legModePinFor(pins: LegModePin[], locationIdA: string, locationIdB: string): LegModePin | undefined {
  return pins.find(
    (p) =>
      (p.locationAId === locationIdA && p.locationBId === locationIdB) ||
      (p.locationAId === locationIdB && p.locationBId === locationIdA)
  );
}

/**
 * A pin's effect on a base `kinds` list (#223, correcting #217/#218's original shape). Not a
 * substitution *within* the list — `osm-japan`'s `"rail"` capability never actually declines a
 * cell within its geographic reach; it always answers, worst case with its own walking estimate
 * over the transit graph (`basisOfCost: "railNetwork"`, `kind: "walking"` — indistinguishable by
 * `Path.kind` from a real road answer). Keeping `"rail"`/`"bus"` alongside a pinned mode therefore
 * left the pin silently outranked in both the already-shipped optimizer path
 * (`solver.ts`'s `applyLegModePins`) and this ticket's display path — confirmed live against a
 * pinned pair in an actual trip, where `["rail","walking"]` and `["rail","driving"]` returned the
 * identical `osm-japan` answer.
 *
 * A pin is a rider's explicit override, not a soft preference transit can still win against: this
 * drops every other kind and asks for the pinned mode alone, so `osm-japan`/Google never get a
 * chance to answer instead. `kinds` (the caller's un-pinned base list) is only used verbatim.
 *
 * Takes just `{ mode }` rather than a full `LegModePin` — `solver.ts`'s own pin shape carries no
 * `id`/`tripId`, and mode is all this ever reads.
 */
export function withLegModePin(kinds: PathKind[], pin: { mode: RoadProfile } | undefined): PathKind[] {
  return pin ? [pin.mode] : kinds;
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
 * The cache key for one pair's answer (ADR-0029 §5, extended #223). Keyed on coordinates rather
 * than `locationId` so that re-geocoding a Location invalidates its entries by construction, on
 * the Road profile because it selects which OSRM graph answered, and on this pair's mode pin (if
 * any) for the same reason — a pin changes which kind is eligible for this cell just as much as
 * `roadProfile` does, so a held answer from before the pin was set (or after it was cleared) must
 * not silently keep answering for it. `locationId` on either end is what makes a pin lookup
 * possible at all; a pair without one (an interchange endpoint a decomposition created) simply
 * can't carry a pin, same as today.
 */
export function pairKey(profile: RoadProfile, pair: PathPair, pins: LegModePin[]): string {
  const pin =
    pair.from.locationId && pair.to.locationId
      ? legModePinFor(pins, pair.from.locationId, pair.to.locationId)
      : undefined;
  const pinSuffix = pin ? `:${pin.mode}` : "";
  return `${profile}:${coordOf(pair.from)}>${coordOf(pair.to)}${pinSuffix}`;
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
export function uniquePairsOfDays(days: DerivedDay[], profile: RoadProfile, pins: LegModePin[]): PathPair[] {
  const seen = new Map<string, PathPair>();
  for (const day of days) {
    for (const pair of pairsOfDay(day)) {
      const key = pairKey(profile, pair, pins);
      if (!seen.has(key)) seen.set(key, pair);
    }
  }
  return [...seen.values()];
}
