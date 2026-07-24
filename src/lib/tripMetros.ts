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
 * the trip — otherwise a metro's bounds could fit to a point that isn't on screen.
 */

import { clusterByMetro } from "@/lib/metroCluster";
import { deriveDays, isLodging, type TripWithDetails } from "@/types";

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
 *  lands. Only falls back to the activity's own name when the address has no segments to anchor
 *  on at all (a single, comma-free line). */
export function metroLabel(metro: { activities: { name: string; address: string | null }[] }): string {
  const first = metro.activities[0];
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

  const days = deriveDays(trip);
  const daysByLocationId = new Map<string, number[]>();
  for (const day of days) {
    for (const stop of day.stops) {
      const seen = daysByLocationId.get(stop.location.id);
      if (seen) { if (!seen.includes(day.dayNumber)) seen.push(day.dayNumber); }
      else daysByLocationId.set(stop.location.id, [day.dayNumber]);
    }
  }

  const stops = days.flatMap((d) => d.stops.map((s) => s.location));
  const clusters = clusterByMetro(stops, trip.locations.filter(isLodging));

  const metros = clusters
    .map((cluster) => ({
      id: metroKey(cluster),
      label: metroLabel(cluster),
      dayNumbers: [...new Set(cluster.activities.flatMap((a) => daysByLocationId.get(a.id) ?? []))].sort((a, b) => a - b),
      locationIds: new Set(cluster.activities.map((a) => a.id)),
      stopCount: cluster.activities.length,
      bounds: boundsOf(cluster.activities)!, // a cluster only forms from geocoded activities
    }))
    .sort((a, b) => (a.dayNumbers[0] ?? Infinity) - (b.dayNumbers[0] ?? Infinity));

  cache.set(trip, metros);
  return metros;
}

export function metroOfDay(metros: TripMetro[], dayNumber: number): TripMetro | null {
  return metros.find((m) => m.dayNumbers.includes(dayNumber)) ?? null;
}
