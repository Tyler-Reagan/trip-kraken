/**
 * The metro tier of the map's navigation hierarchy (#128): trip → metro → day → stop.
 *
 * One shared source (#128 decision 3) — the map's metro tabs and the itinerary's day-card badges
 * both read `metrosOf(trip)`, memoized per trip object, so neither re-derives its own clustering.
 * The grouping itself is #116's `clusterByMetro`, the same detector the optimizer's coverage mask
 * and the lodging wizard use; this module only adds what *navigation* needs on top: a display
 * label, the days each metro touches, and the bounds to fit the camera to.
 *
 * Clustered over the activities the map actually draws (the days' stops), never every Location in
 * the trip — otherwise a metro's bounds could fit to a point that isn't on screen. Lodgings are
 * the one exception, and only for a metro they founded themselves (ADR-0020, amended 2026-08-17):
 * there is no activity to fit to, and the alternative is the destination not appearing at all.
 */

import { clusterByMetro } from "@/lib/metroCluster";
import { deriveTripPlanDays, isLodging, type TripWithDetails } from "@/types";

/** A lng/lat box in MapLibre's `fitBounds` order: [[west, south], [east, north]]. */
export type Bounds = [[number, number], [number, number]];

/** The box containing every geocoded point given, or null when none are. */
export function boundsOf(points: { lat: number | null; lng: number | null }[]): Bounds | null {
  const valid = points.filter((p): p is { lat: number; lng: number } => p.lat != null && p.lng != null);
  if (valid.length === 0) return null;
  const lngs = valid.map((p) => p.lng);
  const lats = valid.map((p) => p.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export type TripMetro = {
  id: string;
  label: string;
  /** Day numbers with at least one stop in this metro, ascending. */
  dayNumbers: number[];
  /** Which stops belong here — lets a caller order metros by where they first appear in a day. */
  locationIds: Set<string>;
  stopCount: number;
  /** Every stop in this metro across the *whole* trip — a metro click is trip-scoped (#128 decision 2). */
  bounds: Bounds;
};

// Google's formattedAddress for Japan comes back in two different orderings depending on the
// place ("<block/chōme>, <ward>, <city>, <postal>, Japan" vs. "Japan, 〒<postal> <city>, <ward>,
// <block>") — comma-position heuristics (e.g. "second-to-last segment") land on whichever is
// there, which is a street-block or ward name a user wouldn't recognize on a map about as often as
// it lands on the city. The postal code is the one token both orderings agree on, so anchor to it
// instead: the region name always sits immediately beside it, on whichever side isn't the marker.
const JP_POSTAL_THEN_REGION = /〒\s*\d{3}[-−]\d{4}\s+([^,]+)/;
const REGION_THEN_JP_POSTAL = /([A-Za-z][A-Za-z\s]*?)\s*,?\s*\d{3}[-−]\d{4}/;
const REGION_THEN_US_ZIP = /([A-Za-z][A-Za-z\s]*?)\s*,?\s*\d{5}(?:-\d{4})?\b/;

/** A recognizable label for a metro: the prefecture/state-level region read off its first
 *  activity's formatted address, not a ward or neighborhood name. Google's formattedAddress
 *  usually omits the postal code entirely (our own places.ts fixtures never carry one), so the
 *  postal-anchored patterns are the exception rather than the rule — the common case falls
 *  through to the last comma-separated segment, which is where the city/prefecture normally
 *  lands. Only falls back to the location's own name when the address has no segments to anchor
 *  on at all (a single, comma-free line).
 *
 *  Reads a lodging when the metro has no activities — a lodging-founded metro (ADR-0020, amended
 *  2026-08-17) is exactly the case where the *only* thing that can name the destination is the
 *  place you sleep, and "this area" on the map is what the amendment exists to stop. */
export function metroLabel(metro: {
  activities: { name: string; address: string | null }[];
  lodgings?: { name: string; address: string | null }[];
}): string {
  const first = metro.activities[0] ?? metro.lodgings?.[0];
  const address = first?.address;
  const fallback = first?.name ?? "this area";
  if (!address) return fallback;
  const postalAnchored =
    address.match(JP_POSTAL_THEN_REGION)?.[1] ??
    address.match(REGION_THEN_JP_POSTAL)?.[1] ??
    address.match(REGION_THEN_US_ZIP)?.[1];
  if (postalAnchored) return postalAnchored.trim();
  const segments = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return fallback;
  const last = segments[segments.length - 1].replace(/〒?\s*\d{3}[-−]\d{4}$|\d{5}(-\d{4})?$/, "").trim();
  return last || fallback;
}

/**
 * The sub-metro locality — ward, city, or district — that `metroLabel` deliberately leaves out.
 *
 * Exists for the Manifest, where the metro is already stated by the group heading, so the useful
 * remainder of an address is the one unit below it: "Nishi Ward" under Osaka, "Taito City" under
 * Tokyo, "Sapporo" under Hokkaido. That is the grain at which a traveller decides which stops
 * belong on the same day, which is the whole job of the staging surface.
 *
 * Reads from the end inwards, the same direction `metroLabel` does: drop the country, drop postal
 * codes, drop whatever the metro label already said, and take the last thing standing. Anything
 * that survives to be the *only* segment is a street address, not a locality, so it returns null
 * rather than printing a house number as if it were a district.
 */
export function localityOf(address: string | null, metro: string): string | null {
  if (!address) return null;
  const segments = address
    .split(",")
    .slice(0, -1) // the country
    .map((s) => s.replace(/〒?\s*\d{3}[-−]\d{4}|\b\d{5}(-\d{4})?\b/g, "").trim())
    .filter(Boolean)
    .filter((s) => s !== metro);
  return segments.length > 1 ? segments[segments.length - 1] : null;
}

// Centroid-rounded identity for a metro cluster, stable across re-renders as long as the cluster
// doesn't move — which enrichment (address/name backfill) never does. Coarse enough (~1km) to
// survive a cluster losing/gaining one member (e.g. a place promoted to lodging), well under the
// 75km radius that separates distinct metros, so no collision risk between them.
export function metroKey(metro: { centroid: { lat: number; lng: number } }): string {
  return `${metro.centroid.lat.toFixed(2)},${metro.centroid.lng.toFixed(2)}`;
}

// Keyed on the trip object itself: the store replaces `trip` wholesale on every mutation, so
// identity is exactly the "has anything changed?" signal, and every consumer — map bands, day-card
// badges — shares one computation per trip revision instead of clustering independently.
const cache = new WeakMap<TripWithDetails, TripMetro[]>();

/** The trip's metros, ordered by first appearance in the itinerary. */
export function metrosOf(trip: TripWithDetails): TripMetro[] {
  const cached = cache.get(trip);
  if (cached) return cached;

  const days = deriveTripPlanDays(trip);

  // Which Days each Location touches — Placements *and* Anchors (ADR-0020, amended 2026-08-17). A
  // Day holding only an arrival and a Lodging is somewhere; keyed on stops alone it was nowhere,
  // and dropped out of the metro tier entirely rather than showing under the city it belongs to.
  const daysByLocationId = new Map<string, number[]>();
  const touches = (locationId: string, dayNumber: number) => {
    const seen = daysByLocationId.get(locationId);
    if (seen) { if (!seen.includes(dayNumber)) seen.push(dayNumber); }
    else daysByLocationId.set(locationId, [dayNumber]);
  };
  for (const day of days) {
    for (const stop of day.stops) touches(stop.location.id, day.dayNumber);
    for (const anchor of [day.startAnchor, day.endAnchor]) {
      if (anchor) touches(anchor.id, day.dayNumber);
    }
  }

  const stops = days.flatMap((d) => d.stops.map((s) => s.location));
  const clusters = clusterByMetro(stops, trip.locations.filter(isLodging));

  const metros = clusters
    .map((cluster) => ({
      id: metroKey(cluster),
      label: metroLabel(cluster),
      // A travel Day belongs to both metros it touches; `metroOfDay` resolves it to whichever
      // comes first in trip order, which is the one the traveller woke in.
      dayNumbers: [
        ...new Set([
          ...cluster.activities.flatMap((a) => daysByLocationId.get(a.id) ?? []),
          ...cluster.lodgings.flatMap((l) => daysByLocationId.get(l.id) ?? []),
        ]),
      ].sort((a, b) => a - b),
      // Stops, deliberately: these two say "what is drawn here", and a lodging is not a stop.
      locationIds: new Set(cluster.activities.map((a) => a.id)),
      stopCount: cluster.activities.length,
      // Non-null holds for both founding passes: an activity-founded metro has activities, and a
      // lodging-founded one has lodgings — each already filtered to real coordinates upstream.
      bounds: boundsOf(cluster.activities.length > 0 ? cluster.activities : cluster.lodgings)!,
    }))
    .sort((a, b) => (a.dayNumbers[0] ?? Infinity) - (b.dayNumbers[0] ?? Infinity));

  cache.set(trip, metros);
  return metros;
}

export function metroOfDay(metros: TripMetro[], dayNumber: number): TripMetro | null {
  return metros.find((m) => m.dayNumbers.includes(dayNumber)) ?? null;
}
