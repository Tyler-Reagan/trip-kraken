/**
 * Domain types (ADR-0015). One place primitive, `Location`, is a discriminated union over `kind`
 * ({activity, transit, lodging}); intrinsic temporal facts are *fields* on the typed Location
 * (optimizer inputs), and the plan is the optimizer's *output* — stored `Placement`s. Roles,
 * anchors, and trip edges are derived adjectives, never stored; the helpers below compute them
 * from one projection rule over the constraint fields, the rule the repository and optimizer share.
 */

import { anchorsOnDate } from "@/lib/anchors";
import type { RoadProfile } from "@/types/path";

/** A calendar date "YYYY-MM-DD". A plain string, never a `Date` — date-only facts must not drift
 *  across timezones, and ISO date strings sort and compare chronologically as-is. */
export type IsoDate = string;

/** A calendar date, or a calendar date plus a time — "2026-09-14" or "2026-09-14T14:00". Local,
 *  no timezone, extending the `IsoDate` convention one field wider (ADR-0028 §3); the same fiction
 *  ADR-0023's Consequences already recorded, honest because no epoch value reaches a user. The
 *  precision is meaningful: a bare date designates a trip edge with no known time, a date-and-time
 *  designates it *and* constrains that Day's window. */
export type IsoDateTime = string;

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
  /** Why the last enrichment attempt failed; null unless `enrichmentStatus` is "failed". */
  enrichmentError: string | null;
};

/** A plain place to visit — the default kind; carries no temporal constraint, and is the only
 *  kind that is *placed* into the plan. */
export type Activity = LocationBase & { kind: "activity" };

/** A transport node (flight, train, …) — a Location you pass through. `arriveAt`/`departAt` are
 *  the kind-elevating gesture (ADR-0028), the same way a Lodging's dates are: either present makes
 *  this kind, both absent relegates to an Activity. At most one Location per Trip carries each,
 *  enforced at write time (a partial unique index backs the invariant) — so a Location carrying
 *  `arriveAt` simply *is* the trip's arrival, with no earliest/latest rule to apply.
 *
 *  `authored` (ADR-0035, CONTEXT.md's Authored/surfaced) tells the two ways this kind reaches the
 *  read model apart: `true` for a real database row (every one `toLocation` narrows), `false` for
 *  a station `surfacedTransitOf` projects from a Journey's Path chain — never a database row, and
 *  never merged into `trip.locations`, so nothing narrowing on `isTransit()` needs to check it. */
export type Transit = LocationBase & {
  kind: "transit";
  authored: boolean;
  arriveAt: IsoDateTime | null;
  departAt: IsoDateTime | null;
};

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
 * is intrinsic to `kind`; `arrival`/`departure` are likewise reflected straight off a Transit
 * Location's own constraint fields (ADR-0028) — no Trip-level lookup needed, because the
 * uniqueness invariant means a Location carrying `arriveAt` simply *is* the arrival. An empty role
 * list is a plain candidate.
 */
export type LocationRole = "lodging" | "arrival" | "departure";

export type TripWithDetails = {
  id: string;
  name: string;
  sourceUrl: string | null; // nullable for blank-slate trips (ADR-0010)
  startDate: IsoDate; // the single required temporal axis (ADR-0015 §3)
  endDate: IsoDate;
  dayLabels: Record<IsoDate, string> | null; // a day's optional label; days are not an entity
  roadProfile: RoadProfile; // which OSRM profile answers this Trip's road cells (ADR-0024, amended 2026-08-11)
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

/** Roles derived for a single Location (ADR-0015 §4, ADR-0028): `lodging` from kind; `arrival`/
 *  `departure` straight off a Transit Location's own `arriveAt`/`departAt`. An empty list is a
 *  plain candidate. */
export const rolesOf = (location: Location): LocationRole[] => {
  if (isLodging(location)) return ["lodging"];
  if (!isTransit(location)) return [];
  const roles: LocationRole[] = [];
  if (location.arriveAt != null) roles.push("arrival");
  if (location.departAt != null) roles.push("departure");
  return roles;
};

// ─── The Timeline projection (ADR-0015: day-presence is derived, never stored) ──

/** A placed activity, joined to its Location for rendering. */
export type ScheduledStop = { placement: Placement; location: Activity };

/** One day of the plan, projected from the trip's date range, placements, and lodging/transit
 *  constraint fields. */
export type DerivedDay = {
  date: IsoDate;
  dayNumber: number;
  label: string | null;
  stops: ScheduledStop[];
  /** Where you woke — the prior night's lodging, or the trip's arrival on day 1 (ADR-0028). Null
   *  when neither applies. */
  startAnchor: Lodging | Transit | null;
  /** Where the day ends — the trip's departure on the last day, or the lodging you sleep at when
   *  it differs from where you woke (a travel day). Null otherwise. */
  endAnchor: Lodging | Transit | null;
  /** A lodging you sleep at but didn't wake at: visited mid-day to drop bags (ADR-0013). Always a
   *  Lodging — a bag-drop is never a trip edge. */
  checkInWaypoint: Lodging | null;
};

/**
 * Project the stored plan into day-clustered form (ADR-0015, widened by ADR-0028). Days come from
 * the required date range; each day's stops are its placements (ordered); anchors are projected
 * from lodging dates and the trip's arrival/departure Transit via the shared `anchorsOnDate` rule
 * (`@/lib/anchors`) — the same rule `buildSolverInputDays` calls for the solver's request input.
 * Nothing here is stored; this is the single rule the Timeline and Map both read.
 */
export function deriveTripPlanDays(trip: TripWithDetails): DerivedDay[] {
  const lodgings = trip.locations.filter(isLodging);
  const byId = new Map(trip.locations.map((l) => [l.id, l]));
  const arrival = trip.locations.find((l): l is Transit => isTransit(l) && l.arriveAt != null) ?? null;
  const departure = trip.locations.find((l): l is Transit => isTransit(l) && l.departAt != null) ?? null;
  const numDays = numDaysOf(trip.startDate, trip.endDate);
  const resolveAnchor = (id: string | null): Lodging | Transit | null =>
    id != null ? ((byId.get(id) as Lodging | Transit | undefined) ?? null) : null;

  return tripDates(trip.startDate, trip.endDate).map((date, i) => {
    const dayNumber = i + 1;
    const stops = trip.placements
      .filter((p) => p.date === date)
      .sort((a, b) => a.order - b.order)
      .map((placement) => ({ placement, location: byId.get(placement.locationId) }))
      .filter((s): s is ScheduledStop => !!s.location && isActivity(s.location));
    const woke = lodgingOnNight(lodgings, addDaysIso(date, -1));
    const sleep = lodgingOnNight(lodgings, date);
    const { startId, endId } = anchorsOnDate({
      dayNumber,
      numDays,
      wokeLodgingId: woke?.id ?? null,
      sleepLodgingId: sleep?.id ?? null,
      arrivalId: arrival?.id ?? null,
      departureId: departure?.id ?? null,
    });
    const travelled = !!sleep && sleep.id !== woke?.id;
    return {
      date,
      dayNumber,
      label: trip.dayLabels?.[date] ?? null,
      stops,
      startAnchor: resolveAnchor(startId),
      endAnchor: resolveAnchor(endId),
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
