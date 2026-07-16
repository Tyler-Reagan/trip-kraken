/**
 * Domain types (ADR-0015). One place primitive, `Location`, is a discriminated union over `kind`
 * ({activity, transit, lodging}); intrinsic temporal facts are *fields* on the typed Location
 * (optimizer inputs), and the plan is the optimizer's *output* — stored `Placement`s. Roles,
 * anchors, and trip edges are derived adjectives, never stored; the helpers below compute them
 * from one projection rule over the constraint fields, the rule the repository and optimizer share.
 */

import type { TravelMode } from "@/lib/travelCost";

/** A calendar date "YYYY-MM-DD". A plain string, never a `Date` — date-only facts must not drift
 *  across timezones, and ISO date strings sort and compare chronologically as-is. */
export type IsoDate = string;

/** Fields every Location carries, independent of kind. */
type LocationBase = {
  id: string;
  tripId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  excluded: boolean;
  note: string | null; // free text; also where a placement's notes live now (#20)
  rating: number | null;
  reviewCount: number | null;
  categories: string[] | null; // Places types[], enrichment metadata — never the authority for kind
  visitDuration: number | null; // estimated visit time in minutes
  openTime: string | null; // "HH:MM" 24-hour — Monday representative, used by optimizer
  closeTime: string | null;
  hoursJson: Record<string, { open: string; close: string | null }> | null; // keys "0"–"6" (Sun–Sat)
  phone: string | null;
  enrichmentStatus: "done" | "pending" | "failed";
};

/** A plain place to visit — the default kind; carries no temporal constraint, and is the only
 *  kind that is *placed* into the plan. */
export type Activity = LocationBase & { kind: "activity" };

/** A transport node (flight, train, …). Its constraint fields — scheduled times — are *parked*
 *  (ADR-0015 open bill); for now it is distinguished only by kind. */
export type Transit = LocationBase & { kind: "transit" };

/** A place you sleep, carrying the booking dates folded in from the removed Stay table. Half-open:
 *  you sleep the nights in [checkInDate, checkOutDate). */
export type Lodging = LocationBase & {
  kind: "lodging";
  checkInDate: IsoDate;
  checkOutDate: IsoDate;
};

/** The single place primitive — a discriminated union narrowed on `kind` (ADR-0015 §1). The DB
 *  stores all kinds in one table with nullable subtype columns; the repository narrows each row
 *  into the right member (a lodging always has its dates). */
export type Location = Activity | Transit | Lodging;

export const isActivity = (l: Location): l is Activity => l.kind === "activity";
export const isTransit = (l: Location): l is Transit => l.kind === "transit";
export const isLodging = (l: Location): l is Lodging => l.kind === "lodging";

/** The plan's stored unit (ADR-0015 §2), renamed Stop → Placement: an activity placed on a date,
 *  ordered within that date. Only activities are placed — lodging/transit day-presence is derived. */
export type Placement = {
  id: string;
  tripId: string;
  locationId: string;
  date: IsoDate;
  order: number;
};

/**
 * A role a Location plays in a trip — a *derived adjective*, never stored (ADR-0015 §4). `lodging`
 * is intrinsic to `kind`; `arrival`/`departure` are the trip's edges, derived from the
 * earliest/latest transit (awaiting the parked transit constraint fields). An empty role list is a
 * plain candidate.
 */
export type LocationRole = "lodging" | "arrival" | "departure";

export type TripWithDetails = {
  id: string;
  name: string;
  sourceUrl: string | null; // nullable for blank-slate trips (ADR-0010)
  startDate: IsoDate; // the single required temporal axis (ADR-0015 §3)
  endDate: IsoDate;
  dayLabels: Record<IsoDate, string> | null; // a day's optional label; days are not an entity
  allowedModes: TravelMode[] | null; // ADR-0019 §mode; unset resolves to the default set (transit included)
  transitCaveatDismissed: boolean; // whether the estimated-transit-timing caveat (#130) has been dismissed
  createdAt: Date;
  updatedAt: Date;
  locations: Location[];
  placements: Placement[];
};

// ─── Derivation helpers (one shared projection rule) ──────────────────────────

/** Add `n` days to an ISO date, returning ISO (UTC math avoids DST drift). */
export const addDaysIso = (date: IsoDate, n: number): IsoDate =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** The trip's day count — derived from the required date range (inclusive of both ends). */
export const numDaysOf = (startDate: IsoDate, endDate: IsoDate): number =>
  Math.round((Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000) + 1;

/** Every calendar date of the trip, in order — the basis for day-clustering the plan. */
export const tripDates = (startDate: IsoDate, endDate: IsoDate): IsoDate[] =>
  Array.from({ length: numDaysOf(startDate, endDate) }, (_, i) => addDaysIso(startDate, i));

/** 1-based day number a date falls on (Day 1 = startDate); the derived day-number label. */
export const dayNumberOf = (startDate: IsoDate, date: IsoDate): number =>
  Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000) + 1;

/** Does this lodging cover the night of `date`? Half-open [checkInDate, checkOutDate). */
export const lodgingCoversNight = (l: Lodging, date: IsoDate): boolean =>
  l.checkInDate <= date && date < l.checkOutDate;

/** The lodging you sleep under on `date`, if any — the derived day-presence projection that
 *  replaces stored stay rows (ADR-0015 §2). Bookings don't overlap, so at most one matches. */
export const lodgingOnNight = (lodgings: Lodging[], date: IsoDate): Lodging | null =>
  lodgings.find((l) => lodgingCoversNight(l, date)) ?? null;

/** Roles derived for a single Location (ADR-0015 §4): `lodging` from kind; an empty list is a
 *  candidate. Arrival/departure are trip-wide edges — derived elsewhere once transit gains its
 *  constraint fields (parked), so they are not produced here yet. */
export const rolesOf = (location: Location): LocationRole[] =>
  isLodging(location) ? ["lodging"] : [];

// ─── The Timeline projection (ADR-0015: day-presence is derived, never stored) ──

/** A placed activity, joined to its Location for rendering. */
export type ScheduledStop = { placement: Placement; location: Activity };

/** One day of the plan, projected from the trip's date range, placements, and lodging dates. */
export type DerivedDay = {
  date: IsoDate;
  dayNumber: number;
  label: string | null;
  stops: ScheduledStop[];
  /** Where you woke — the prior night's lodging (null on the first day / an arrival). */
  startAnchor: Lodging | null;
  /** Where you sleep, when it differs from where you woke (a travel day) — else null. */
  endAnchor: Lodging | null;
  /** A lodging you sleep at but didn't wake at: visited mid-day to drop bags (ADR-0013). */
  checkInWaypoint: Lodging | null;
};

/**
 * Project the stored plan into day-clustered form (ADR-0015). Days come from the required date
 * range; each day's stops are its placements (ordered); lodging anchors are projected from the
 * booking dates via `lodgingOnNight` — woke = prior night, sleep = this night. Nothing here is
 * stored; this is the single rule the Timeline and Map both read.
 */
export function deriveDays(trip: TripWithDetails): DerivedDay[] {
  const lodgings = trip.locations.filter(isLodging);
  const byId = new Map(trip.locations.map((l) => [l.id, l]));
  return tripDates(trip.startDate, trip.endDate).map((date, i) => {
    const stops = trip.placements
      .filter((p) => p.date === date)
      .sort((a, b) => a.order - b.order)
      .map((placement) => ({ placement, location: byId.get(placement.locationId) }))
      .filter((s): s is ScheduledStop => !!s.location && isActivity(s.location));
    const woke = lodgingOnNight(lodgings, addDaysIso(date, -1));
    const sleep = lodgingOnNight(lodgings, date);
    const travelled = !!sleep && sleep.id !== woke?.id;
    return {
      date,
      dayNumber: i + 1,
      label: trip.dayLabels?.[date] ?? null,
      stops,
      startAnchor: woke,
      endAnchor: travelled ? sleep : null,
      checkInWaypoint: travelled ? sleep : null,
    };
  });
}

export type NearbyPlace = {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  categories: string[];
  priceLevel: number | null; // 0–4
  distanceMeters: number | null;
};
