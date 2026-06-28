import { randomUUID } from "crypto";
import { eq, and, gt, gte, asc, desc, sql, count, max, inArray, getTableColumns } from "drizzle-orm";
import { getDrizzle } from "./client";
import { trip, location, stay, itineraryDay, itineraryStop } from "./schema";
import type { TripWithDetails, Location, ItineraryDay, LocationRole } from "@/types";
import type { LocationEnrichment } from "@/lib/places";
import type { ParsedBooking } from "@/lib/bookingImport";

/**
 * Repository layer (ADR-0008). The schema lives in ./schema.ts and is applied by the
 * migration runner in ./client.ts. All persistence goes through typed Drizzle queries
 * here — there is no raw SQL outside this module. Drizzle auto-parses json/boolean-mode
 * columns, so there is no manual JSON.parse / `!== 0` deserialization. A Location's `roles`
 * are not columns; they are derived from what references it — a Stay makes it a lodging
 * (ADR-0014).
 */

export const newId = () => randomUUID();

// ─── Mappers ──────────────────────────────────────────────────────────────────

function parseTrip(r: typeof trip.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    sourceUrl: r.sourceUrl,
    numDays: r.numDays ?? null,
    startDate: r.startDate ? new Date(r.startDate) : null,
    arrivalLocationId: r.arrivalLocationId ?? null,
    departureLocationId: r.departureLocationId ?? null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

/** Drizzle returns json/boolean columns already parsed; only `roles` is derived (ADR-0014). */
function toLocation(r: typeof location.$inferSelect, rolesByLocation: Map<string, LocationRole[]>): Location {
  return { ...r, roles: rolesByLocation.get(r.id) ?? [] };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export function listTrips() {
  const rows = getDrizzle()
    .select({ ...getTableColumns(trip), locationCount: count(location.id) })
    .from(trip)
    .leftJoin(location, eq(location.tripId, trip.id))
    .groupBy(trip.id)
    .orderBy(desc(trip.createdAt))
    .all();

  return rows.map((r) => ({ ...parseTrip(r), _count: { locations: r.locationCount } }));
}

export function getTripWithDetails(id: string): TripWithDetails | null {
  const db = getDrizzle();

  const tripRow = db.select().from(trip).where(eq(trip.id, id)).get();
  if (!tripRow) return null;

  const stayRows = db.select().from(stay).where(eq(stay.tripId, id)).orderBy(asc(stay.checkInDate)).all();
  const lodgingIds = new Set(stayRows.map((s) => s.lodgingLocationId));

  // Derived roles (ADR-0014): a Stay reference ⇒ lodging; a Trip edge reference ⇒ arrival/departure.
  const rolesByLocation = new Map<string, LocationRole[]>();
  const addRole = (locId: string, role: LocationRole) =>
    rolesByLocation.set(locId, [...(rolesByLocation.get(locId) ?? []), role]);
  for (const lid of lodgingIds) addRole(lid, "lodging");
  if (tripRow.arrivalLocationId) addRole(tripRow.arrivalLocationId, "arrival");
  if (tripRow.departureLocationId) addRole(tripRow.departureLocationId, "departure");
  // Anchor Locations (any role) fill a Day's anchor slot and are never scheduled as a Stop.
  const anchorIds = new Set(rolesByLocation.keys());

  const locationRows = db
    .select()
    .from(location)
    .where(eq(location.tripId, id))
    .orderBy(asc(location.name))
    .all();

  const dayRows = db
    .select()
    .from(itineraryDay)
    .where(eq(itineraryDay.tripId, id))
    .orderBy(asc(itineraryDay.dayNumber))
    .all();

  const stopRows = db
    .select({ stop: itineraryStop, loc: location })
    .from(itineraryStop)
    .innerJoin(location, eq(location.id, itineraryStop.locationId))
    .innerJoin(itineraryDay, eq(itineraryDay.id, itineraryStop.dayId))
    .where(eq(itineraryDay.tripId, id))
    .orderBy(asc(itineraryStop.ord))
    .all();

  const locById = new Map(locationRows.map((l) => [l.id, toLocation(l, rolesByLocation)]));

  // Day anchors derive from ONE rule over the date bookings (ADR-0014). `lodgingOn(date)` is the
  // Stay you sleep under that date — half-open [checkInDate, checkOutDate), ISO date strings
  // compared lexicographically (they sort chronologically). A Day's date is startDate +
  // (dayNumber-1); with no startDate there is no calendar, so no anchors.
  const startDate = tripRow.startDate ? tripRow.startDate.slice(0, 10) : null;
  const dateOfDay = (dayNumber: number): string | null =>
    startDate ? addDaysIso(startDate, dayNumber - 1) : null;
  const lodgingOn = (date: string | null): Location | null => {
    if (!date) return null;
    const s = stayRows.find((s) => s.checkInDate <= date && date < s.checkOutDate);
    return s ? locById.get(s.lodgingLocationId) ?? null : null;
  };

  // Trip-edge transport anchors (ADR-0005): the first Day starts at arrival, the last ends at
  // departure, overriding the lodging bookend at those edges.
  const arrivalLoc = tripRow.arrivalLocationId ? locById.get(tripRow.arrivalLocationId) ?? null : null;
  const departureLoc = tripRow.departureLocationId ? locById.get(tripRow.departureLocationId) ?? null : null;
  const lastDayNumber = tripRow.numDays ?? Math.max(0, ...dayRows.map((d) => d.dayNumber));

  const days: ItineraryDay[] = dayRows.map((day) => {
    // Start = where you woke = the lodging of the day before (the prior date); Day 1 overrides to
    // the arrival anchor. End = where you sleep = the lodging of this date; the last Day overrides
    // to the departure anchor. On a check-in day the prior date falls outside every Stay → null
    // start, so the booked lodging is the overnight/end, never the origin. start ≠ end ⇒ a travel
    // day (or an arrival/departure edge); equal ⇒ a round trip.
    const wokeLodging = lodgingOn(dateOfDay(day.dayNumber - 1));
    const sleepLodging = lodgingOn(dateOfDay(day.dayNumber));
    const start = day.dayNumber === 1 && arrivalLoc ? arrivalLoc : wokeLodging;
    const end = day.dayNumber === lastDayNumber && departureLoc ? departureLoc : sleepLodging;
    // Check-in day ⇒ you sleep somewhere new (≠ where you woke). That new lodging is visited
    // mid-route to drop bags (ADR-0013 Phase 2), then again as the overnight end anchor.
    const checkInWaypoint = sleepLodging && sleepLodging.id !== wokeLodging?.id ? sleepLodging : null;
    return {
      id: day.id,
      tripId: day.tripId,
      dayNumber: day.dayNumber,
      date: day.date ? new Date(day.date) : null,
      label: day.label,
      startAnchor: start,
      endAnchor: end && end.id !== start?.id ? end : null,
      checkInWaypoint,
      stops: stopRows
        .filter((s) => s.stop.dayId === day.id && !anchorIds.has(s.stop.locationId))
        .map((s) => ({
          id: s.stop.id,
          dayId: s.stop.dayId,
          locationId: s.stop.locationId,
          order: s.stop.ord,
          notes: s.stop.notes,
          locked: s.stop.locked,
          location: toLocation(s.loc, rolesByLocation),
        })),
    };
  });

  return {
    ...parseTrip(tripRow),
    locations: locationRows.map((l) => locById.get(l.id)!),
    stays: stayRows,
    days,
  };
}

function requireTrip(tripId: string): TripWithDetails {
  const t = getTripWithDetails(tripId);
  if (!t) throw new Error(`Trip ${tripId} not found after write — possible DB inconsistency`);
  return t;
}

export function tripExists(tripId: string): boolean {
  return getDrizzle().select({ id: trip.id }).from(trip).where(eq(trip.id, tripId)).get() !== undefined;
}

/** A single Location with derived roles (ADR-0014): lodging from a Stay, arrival/departure from
 *  the Trip's edge anchors. */
export function getLocation(locationId: string): Location | null {
  const db = getDrizzle();
  const row = db.select().from(location).where(eq(location.id, locationId)).get();
  if (!row) return null;
  const roles: LocationRole[] = [];
  const lodging = db
    .select({ x: sql<number>`1` })
    .from(stay)
    .where(eq(stay.lodgingLocationId, locationId))
    .get();
  if (lodging !== undefined) roles.push("lodging");
  const edge = db
    .select({ a: trip.arrivalLocationId, d: trip.departureLocationId })
    .from(trip)
    .where(eq(trip.id, row.tripId))
    .get();
  if (edge?.a === locationId) roles.push("arrival");
  if (edge?.d === locationId) roles.push("departure");
  return { ...row, roles };
}

export function getLocationCoords(
  tripId: string,
  locationId: string
): { lat: number | null; lng: number | null } | null {
  const r = getDrizzle()
    .select({ lat: location.lat, lng: location.lng })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .get();
  return r ?? null;
}

export function locationExistsByPlaceId(tripId: string, placeId: string): boolean {
  return (
    getDrizzle()
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.tripId, tripId), eq(location.placeId, placeId)))
      .get() !== undefined
  );
}

/** Distinct categories across the stops scheduled on a day (for nearby diversity scoring). */
export function getDayCategories(dayId: string): string[] {
  const rows = getDrizzle()
    .select({ categories: location.categories })
    .from(itineraryStop)
    .innerJoin(location, eq(location.id, itineraryStop.locationId))
    .where(eq(itineraryStop.dayId, dayId))
    .all();
  const set = new Set<string>();
  for (const r of rows) for (const c of r.categories ?? []) set.add(c);
  return [...set];
}

/** Schedulable (non-excluded) location for the optimizer. Includes lodgings, which the
 *  optimizer identifies via the Stay timeline (not a per-location flag). */
export type OptimizationLocation = {
  id: string;
  lat: number | null;
  lng: number | null;
  visitDuration: number | null;
  openTime: string | null;
  closeTime: string | null;
  categories: string[] | null;
};

export type OptimizationInputs = {
  locations: OptimizationLocation[];
  stays: Array<{ lodgingLocationId: string; startNight: number; endNight: number }>;
  arrivalLocationId: string | null;   // trip-edge anchors (ADR-0005, #54)
  departureLocationId: string | null;
};

export function getOptimizationInputs(tripId: string): OptimizationInputs | null {
  const db = getDrizzle();
  const tripRow = db
    .select({
      startDate: trip.startDate,
      numDays: trip.numDays,
      arrivalLocationId: trip.arrivalLocationId,
      departureLocationId: trip.departureLocationId,
    })
    .from(trip)
    .where(eq(trip.id, tripId))
    .get();
  if (!tripRow) return null;

  // The optimizer interface is unchanged: derive integer night-ranges from the date bookings.
  const stayRows = db
    .select({ lodgingLocationId: stay.lodgingLocationId, checkInDate: stay.checkInDate, checkOutDate: stay.checkOutDate })
    .from(stay)
    .where(eq(stay.tripId, tripId))
    .orderBy(asc(stay.checkInDate))
    .all();
  const stays = staysAsNightRanges(stayRows, tripRow.startDate, tripRow.numDays);

  const locations = db
    .select({
      id: location.id,
      lat: location.lat,
      lng: location.lng,
      visitDuration: location.visitDuration,
      openTime: location.openTime,
      closeTime: location.closeTime,
      categories: location.categories,
    })
    .from(location)
    .where(and(eq(location.tripId, tripId), eq(location.excluded, false)))
    .all();

  return {
    locations,
    stays,
    arrivalLocationId: tripRow.arrivalLocationId ?? null,
    departureLocationId: tripRow.departureLocationId ?? null,
  };
}

/**
 * Locked Stops the solver must honor as fixed input (ADR-0006): each pins its Location to a
 * Day (`dayNumber`) and a relative order (`lockOrder` = the stored `ord`). Joined through the
 * Day so we get the day number directly. Orphaned locks (day past `numDays`) are filtered by
 * the caller; the reconciling writer warns and drops them.
 */
export function getLockedStops(tripId: string): Array<{ locationId: string; dayNumber: number; lockOrder: number }> {
  return getDrizzle()
    .select({ locationId: itineraryStop.locationId, dayNumber: itineraryDay.dayNumber, lockOrder: itineraryStop.ord })
    .from(itineraryStop)
    .innerJoin(itineraryDay, eq(itineraryDay.id, itineraryStop.dayId))
    .where(and(eq(itineraryDay.tripId, tripId), eq(itineraryStop.locked, true)))
    .all();
}

// ─── Trip mutations ─────────────────────────────────────────────────────────

export function createTripWithLocations(data: {
  name: string;
  sourceUrl: string;
  locations: Array<{
    name: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    placeId?: string | null;
  }>;
}): TripWithDetails {
  const tripId = newId();

  getDrizzle().transaction((tx) => {
    tx.insert(trip).values({ id: tripId, name: data.name, sourceUrl: data.sourceUrl }).run();
    for (const loc of data.locations) {
      tx.insert(location)
        .values({
          id: newId(),
          tripId,
          name: loc.name,
          address: loc.address ?? null,
          lat: loc.lat ?? null,
          lng: loc.lng ?? null,
          placeId: loc.placeId ?? null,
          enrichmentStatus: "pending",
        })
        .run();
    }
  });

  return requireTrip(tripId);
}

export function updateTrip(
  id: string,
  fields: { name?: string; numDays?: number; startDate?: string | null }
): TripWithDetails {
  getDrizzle()
    .update(trip)
    .set({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.numDays !== undefined ? { numDays: fields.numDays } : {}),
      ...(fields.startDate !== undefined
        ? { startDate: fields.startDate ? new Date(fields.startDate).toISOString() : null }
        : {}),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(trip.id, id))
    .run();
  return requireTrip(id);
}

export function deleteTrip(id: string): void {
  getDrizzle().delete(trip).where(eq(trip.id, id)).run();
}

/** Thrown when the solver's output violates a lock (a locked Stop moved day or was reordered). */
export class LockViolationError extends Error {}

export type DayPlan = { dayNumber: number; locationIds: string[] };
export type ReconcileResult = { trip: TripWithDetails; warnings: string[] };

/**
 * Reconcile the itinerary to the solver's desired plan WITHOUT destroying manual intent
 * (ADR-0006/0008). Instead of delete-all-and-recreate, this diffs the desired plan against
 * the stored itinerary keyed on `locationId` — Stop identity is stable per scheduled
 * Location — so `notes` and lock state survive re-optimization:
 *
 *  - Day rows are reconciled by `dayNumber`, so day labels survive; days beyond `numDays`
 *    are dropped. A locked Stop orphaned by a dropped day is unscheduled with a warning
 *    (its lock goes inert; notes are not preserved — the deferred ADR-0006 path).
 *  - Newly-scheduled Locations get a fresh Stop; Locations no longer scheduled (excluded or
 *    removed) have their Stop deleted.
 *  - Every surviving Stop is updated to its new `(day, order)` IN PLACE — never
 *    delete+reinsert — which is what preserves its `notes` and `locked` flag.
 *
 * Before committing, it asserts the solver honored every lock (each locked Stop kept its Day
 * and its order relative to other locked Stops on that Day); a violation throws and rolls the
 * transaction back, so a solver bug fails loud rather than silently moving a pinned Stop.
 */
export function reconcileItinerary(
  tripId: string,
  numDays: number,
  startDate: string | null,
  dayPlans: DayPlan[]
): ReconcileResult {
  const warnings: string[] = [];

  getDrizzle().transaction((tx) => {
    tx.update(trip)
      .set({
        numDays,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(trip.id, tripId))
      .run();

    // ── Reconcile day rows by dayNumber (so day labels survive) ──
    const existingDays = tx
      .select({ id: itineraryDay.id, dayNumber: itineraryDay.dayNumber })
      .from(itineraryDay)
      .where(eq(itineraryDay.tripId, tripId))
      .all();

    const survivingDayNumbers = new Set(dayPlans.map((p) => p.dayNumber));
    const droppedDayIds = existingDays.filter((d) => !survivingDayNumbers.has(d.dayNumber)).map((d) => d.id);
    if (droppedDayIds.length > 0) {
      // Warn about locked Stops on days about to vanish; the cascade then removes them.
      const orphaned = tx
        .select({ c: count() })
        .from(itineraryStop)
        .where(and(inArray(itineraryStop.dayId, droppedDayIds), eq(itineraryStop.locked, true)))
        .get();
      const n = orphaned?.c ?? 0;
      if (n > 0) warnings.push(`${n} locked stop${n === 1 ? "" : "s"} lost ${n === 1 ? "its" : "their"} day and ${n === 1 ? "was" : "were"} unscheduled.`);
      tx.delete(itineraryDay).where(inArray(itineraryDay.id, droppedDayIds)).run();
    }

    const dayIdByNumber = new Map(
      existingDays.filter((d) => survivingDayNumbers.has(d.dayNumber)).map((d) => [d.dayNumber, d.id])
    );
    for (const plan of dayPlans) {
      const date =
        startDate && plan.dayNumber > 0
          ? new Date(new Date(startDate).getTime() + (plan.dayNumber - 1) * 86400000).toISOString()
          : null;
      const existingId = dayIdByNumber.get(plan.dayNumber);
      if (existingId) {
        tx.update(itineraryDay).set({ date }).where(eq(itineraryDay.id, existingId)).run();
      } else {
        const id = newId();
        tx.insert(itineraryDay).values({ id, tripId, dayNumber: plan.dayNumber, date }).run();
        dayIdByNumber.set(plan.dayNumber, id);
      }
    }

    // ── Diff stops keyed on locationId (one persistent Stop per scheduled Location) ──
    const existingStops = tx
      .select({
        id: itineraryStop.id,
        dayId: itineraryStop.dayId,
        dayNumber: itineraryDay.dayNumber,
        locationId: itineraryStop.locationId,
        ord: itineraryStop.ord,
        locked: itineraryStop.locked,
      })
      .from(itineraryStop)
      .innerJoin(itineraryDay, eq(itineraryDay.id, itineraryStop.dayId))
      .where(eq(itineraryDay.tripId, tripId))
      .all();
    const existingByLocation = new Map(existingStops.map((s) => [s.locationId, s]));

    const desired = new Map<string, { dayNumber: number; ord: number }>();
    for (const plan of dayPlans) {
      plan.locationIds.forEach((locationId, ord) => desired.set(locationId, { dayNumber: plan.dayNumber, ord }));
    }

    // Assert the solver honored every lock: same Day, and locked Stops keep their relative
    // order within a Day. (Inert until the lock UI can set `locked`.)
    const lockedByDay = new Map<number, typeof existingStops>();
    for (const s of existingStops) {
      if (!s.locked) continue;
      const want = desired.get(s.locationId);
      if (!want) throw new LockViolationError(`solver dropped locked stop for location ${s.locationId}`);
      if (want.dayNumber !== s.dayNumber)
        throw new LockViolationError(`solver moved locked stop ${s.locationId} off day ${s.dayNumber}`);
      const arr = lockedByDay.get(s.dayNumber) ?? [];
      arr.push(s);
      lockedByDay.set(s.dayNumber, arr);
    }
    for (const [dayNumber, locks] of lockedByDay) {
      const lockedOrder = [...locks].sort((a, b) => a.ord - b.ord).map((s) => s.locationId);
      const lockedIds = new Set(lockedOrder);
      const plan = dayPlans.find((p) => p.dayNumber === dayNumber)!;
      const solverLockedOrder = plan.locationIds.filter((id) => lockedIds.has(id));
      for (let i = 0; i < lockedOrder.length; i++) {
        if (lockedOrder[i] !== solverLockedOrder[i])
          throw new LockViolationError(`solver reordered locked stops on day ${dayNumber}`);
      }
    }

    // Apply: upsert each scheduled Location's Stop in place; delete Stops that dropped out.
    for (const [locationId, place] of desired) {
      const dayId = dayIdByNumber.get(place.dayNumber)!;
      const existing = existingByLocation.get(locationId);
      if (existing) {
        if (existing.dayId !== dayId || existing.ord !== place.ord) {
          tx.update(itineraryStop).set({ dayId, ord: place.ord }).where(eq(itineraryStop.id, existing.id)).run();
        }
      } else {
        tx.insert(itineraryStop).values({ id: newId(), dayId, locationId, ord: place.ord }).run();
      }
    }
    for (const s of existingStops) {
      if (!desired.has(s.locationId)) tx.delete(itineraryStop).where(eq(itineraryStop.id, s.id)).run();
    }
  });

  return { trip: requireTrip(tripId), warnings };
}

// ─── Stay timeline ────────────────────────────────────────────────────────────

/** Thrown when a proposed Stay timeline violates ADR-0002/0013 invariants. */
export class StayValidationError extends Error {}

export type StayInput = { lodgingLocationId: string; checkInDate: string; checkOutDate: string };

/** Trip Day number a calendar date falls on (Day 1 = startDate). */
function dayNumberOf(date: string, startDate: string): number {
  const day0 = Date.parse(startDate.slice(0, 10) + "T00:00:00Z");
  const day = Date.parse(date.slice(0, 10) + "T00:00:00Z");
  return Math.round((day - day0) / 86400000) + 1;
}

/** Add `n` days to a "YYYY-MM-DD" date, returning "YYYY-MM-DD" (UTC math avoids DST drift). */
function addDaysIso(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

/**
 * Convert the date bookings into the integer night-ranges the optimizer interface consumes
 * (the day-anchor derivation no longer goes through here — it reads the dates directly). A
 * booking checking in on Day X and out on Day Y covers nights X..Y-1. Ranges are clamped to
 * [1, numDays] and empty ones dropped. Returns [] until the trip has a startDate (no calendar).
 */
function staysAsNightRanges(
  stayRows: Array<{ lodgingLocationId: string; checkInDate: string; checkOutDate: string }>,
  startDate: string | null,
  numDays: number | null
): Array<{ lodgingLocationId: string; startNight: number; endNight: number }> {
  if (!startDate) return [];
  const ranges: Array<{ lodgingLocationId: string; startNight: number; endNight: number }> = [];
  for (const s of stayRows) {
    const startNight = Math.max(1, dayNumberOf(s.checkInDate, startDate));
    let endNight = dayNumberOf(s.checkOutDate, startDate) - 1;
    if (numDays != null) endNight = Math.min(endNight, numDays);
    if (startNight <= endNight) ranges.push({ lodgingLocationId: s.lodgingLocationId, startNight, endNight });
  }
  return ranges;
}

/**
 * Replace a trip's Stay timeline atomically (ADR-0014). A Stay is a date booking: a Lodging with
 * a check-in and check-out date. Validates: checkInDate < checkOutDate, the bookings' half-open
 * [checkInDate, checkOutDate) date intervals do not overlap (adjacent same-day switches are
 * fine), and each lodging is a Location in the trip. Stored ordered by checkInDate; nights and
 * day-anchors derive at read time. Lodging *stops* are not written here — they are generated
 * per-day by optimize/rebuild.
 */
export function setStays(tripId: string, stays: StayInput[]): TripWithDetails {
  const db = getDrizzle();
  const tripRow = db.select({ id: trip.id }).from(trip).where(eq(trip.id, tripId)).get();
  if (!tripRow) throw new StayValidationError("Trip not found");

  // ISO dates sort and compare chronologically as plain strings.
  const sorted = [...stays].sort((a, b) => a.checkInDate.localeCompare(b.checkInDate));

  for (const s of sorted) {
    if (Number.isNaN(Date.parse(s.checkInDate)) || Number.isNaN(Date.parse(s.checkOutDate))) {
      throw new StayValidationError("Invalid check-in/check-out date");
    }
    if (s.checkInDate >= s.checkOutDate) throw new StayValidationError("Check-in must be before check-out");
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].checkInDate < sorted[i - 1].checkOutDate) {
      throw new StayValidationError("Bookings overlap");
    }
  }

  const lodgingIds = sorted.map((s) => s.lodgingLocationId);
  if (lodgingIds.length > 0) {
    const found = db
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.tripId, tripId), inArray(location.id, lodgingIds)))
      .all();
    const foundSet = new Set(found.map((r) => r.id));
    for (const id of lodgingIds) {
      if (!foundSet.has(id)) throw new StayValidationError("Lodging location is not in this trip");
    }
  }

  db.transaction((tx) => {
    tx.delete(stay).where(eq(stay.tripId, tripId)).run();
    for (const s of sorted) {
      tx.insert(stay)
        .values({
          id: newId(),
          tripId,
          lodgingLocationId: s.lodgingLocationId,
          checkInDate: s.checkInDate,
          checkOutDate: s.checkOutDate,
        })
        .run();
    }
  });

  return requireTrip(tripId);
}

/**
 * Set (or clear) the trip's arrival/departure edge anchors (ADR-0005). Each must reference a
 * Location in the trip, or be null to clear. A Location used as an endpoint plays the
 * arrival/departure role (derived, ADR-0014); it is never scheduled as a Stop.
 */
export function setTripEndpoints(
  tripId: string,
  endpoints: { arrivalLocationId: string | null; departureLocationId: string | null }
): TripWithDetails {
  const db = getDrizzle();
  const ids = [endpoints.arrivalLocationId, endpoints.departureLocationId].filter(
    (x): x is string => !!x
  );
  if (ids.length > 0) {
    const found = db
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.tripId, tripId), inArray(location.id, ids)))
      .all();
    const foundSet = new Set(found.map((r) => r.id));
    for (const id of ids) {
      if (!foundSet.has(id)) throw new StayValidationError("Endpoint location is not in this trip");
    }
  }
  db.update(trip)
    .set({
      arrivalLocationId: endpoints.arrivalLocationId,
      departureLocationId: endpoints.departureLocationId,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(trip.id, tripId))
    .run();
  return requireTrip(tripId);
}

/**
 * Import a parsed booking confirmation as a Stay (ADR-0013 Phase 2 / ADR-0010, #57). The property
 * is resolved to an existing trip Location by case-insensitive name, else created (pending
 * enrichment so it gets geocoded like any new place). The Stay is appended to the timeline;
 * setStays re-validates ordering and non-overlap. Overlap is pre-checked so a rejected import
 * doesn't leave behind a freshly-created lodging Location.
 */
export function importBookingStay(tripId: string, booking: ParsedBooking): TripWithDetails {
  const db = getDrizzle();
  if (!tripExists(tripId)) throw new StayValidationError("Trip not found");
  if (Number.isNaN(Date.parse(booking.checkInDate)) || Number.isNaN(Date.parse(booking.checkOutDate)))
    throw new StayValidationError("Invalid check-in/check-out date");
  if (booking.checkInDate >= booking.checkOutDate)
    throw new StayValidationError("Check-in must be before check-out");

  const existing = db
    .select({ lodgingLocationId: stay.lodgingLocationId, checkInDate: stay.checkInDate, checkOutDate: stay.checkOutDate })
    .from(stay)
    .where(eq(stay.tripId, tripId))
    .all();
  for (const s of existing) {
    if (booking.checkInDate < s.checkOutDate && s.checkInDate < booking.checkOutDate)
      throw new StayValidationError("Booking overlaps an existing stay");
  }

  const locs = db
    .select({ id: location.id, name: location.name })
    .from(location)
    .where(eq(location.tripId, tripId))
    .all();
  const match = locs.find((l) => l.name.trim().toLowerCase() === booking.property.trim().toLowerCase());
  const lodgingLocationId = match
    ? match.id
    : createLocation(tripId, { name: booking.property, enrichmentStatus: "pending" }).id;

  return setStays(tripId, [
    ...existing,
    { lodgingLocationId, checkInDate: booking.checkInDate, checkOutDate: booking.checkOutDate },
  ]);
}

// ─── Location mutations ───────────────────────────────────────────────────────

export type NewLocationInput = {
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  categories?: string[] | null;
  phone?: string | null;
  openTime?: string | null;
  closeTime?: string | null;
  hoursJson?: Record<string, { open: string; close: string | null }> | null;
  enrichmentStatus?: "done" | "pending" | "failed";
};

export function createLocation(tripId: string, data: NewLocationInput): Location {
  const id = newId();
  getDrizzle()
    .insert(location)
    .values({
      id,
      tripId,
      name: data.name,
      address: data.address ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      placeId: data.placeId ?? null,
      rating: data.rating ?? null,
      reviewCount: data.reviewCount ?? null,
      categories: data.categories ?? null,
      phone: data.phone ?? null,
      openTime: data.openTime ?? null,
      closeTime: data.closeTime ?? null,
      hoursJson: data.hoursJson ?? null,
      enrichmentStatus: data.enrichmentStatus ?? "done",
    })
    .run();
  const loc = getLocation(id);
  if (!loc) throw new Error("Location not found after insert");
  return loc;
}

/** Update a Location's editable fields. Lodging is managed via the Stay timeline (setStays), not here. */
export function updateLocation(
  tripId: string,
  locationId: string,
  fields: {
    excluded?: boolean;
    note?: string | null;
    name?: string;
    visitDuration?: number | null;
  }
): Location | null {
  const set = {
    ...(fields.excluded !== undefined ? { excluded: fields.excluded } : {}),
    ...(fields.note !== undefined ? { note: fields.note } : {}),
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.visitDuration !== undefined ? { visitDuration: fields.visitDuration } : {}),
  };
  if (Object.keys(set).length) {
    getDrizzle()
      .update(location)
      .set(set)
      .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
      .run();
  }
  // Excluding a Location drops its Stop on the next reconcile; clear any lock first so the
  // reconciling writer's lock assertion can't trip over a Stop that's about to vanish
  // (ADR-0006's confirm-and-cascade for a locked Stop's Location, enforced server-side).
  if (fields.excluded === true) {
    getDrizzle().update(itineraryStop).set({ locked: false }).where(eq(itineraryStop.locationId, locationId)).run();
  }
  return getLocation(locationId);
}

/**
 * Delete a Location. Relegation: dissolve any Stay that references it first (the lodging
 * FK is ON DELETE RESTRICT), then delete — Stops cascade away with the Location.
 */
export function deleteLocation(locationId: string): void {
  getDrizzle().transaction((tx) => {
    tx.delete(stay).where(eq(stay.lodgingLocationId, locationId)).run();
    tx.delete(location).where(eq(location.id, locationId)).run();
  });
}

// ─── Day mutations ────────────────────────────────────────────────────────────

export function updateDayLabel(dayId: string, label: string | null) {
  const db = getDrizzle();
  db.update(itineraryDay).set({ label: label ?? null }).where(eq(itineraryDay.id, dayId)).run();
  return db.select().from(itineraryDay).where(eq(itineraryDay.id, dayId)).get() ?? null;
}

// ─── Stop mutations ───────────────────────────────────────────────────────────

export function addStopToDay(
  tripId: string,
  locationId: string,
  dayId: string,
  /** When provided, insert immediately after this location's existing stop on the day. */
  afterLocationId?: string | null
): TripWithDetails {
  getDrizzle().transaction((tx) => {
    const loc = tx
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
      .get();
    if (!loc) throw new Error("Location not found in trip");

    const day = tx
      .select({ id: itineraryDay.id })
      .from(itineraryDay)
      .where(and(eq(itineraryDay.id, dayId), eq(itineraryDay.tripId, tripId)))
      .get();
    if (!day) throw new Error("Day not found in trip");

    let ord: number;
    const anchor = afterLocationId
      ? tx
          .select({ ord: itineraryStop.ord })
          .from(itineraryStop)
          .where(and(eq(itineraryStop.dayId, dayId), eq(itineraryStop.locationId, afterLocationId)))
          .get()
      : undefined;

    if (anchor) {
      tx.update(itineraryStop)
        .set({ ord: sql`${itineraryStop.ord} + 1` })
        .where(and(eq(itineraryStop.dayId, dayId), gt(itineraryStop.ord, anchor.ord)))
        .run();
      ord = anchor.ord + 1;
    } else {
      const m = tx
        .select({ maxOrd: max(itineraryStop.ord) })
        .from(itineraryStop)
        .where(eq(itineraryStop.dayId, dayId))
        .get();
      ord = (m?.maxOrd ?? -1) + 1;
    }

    // Hand-placing a stop locks it by default (ADR-0006): manual intent survives re-opt.
    tx.insert(itineraryStop).values({ id: newId(), dayId, locationId, ord, locked: true }).run();
  });

  return requireTrip(tripId);
}

export function setStopLocked(tripId: string, stopId: string, locked: boolean): TripWithDetails {
  getDrizzle()
    .update(itineraryStop)
    .set({ locked })
    .where(
      and(
        eq(itineraryStop.id, stopId),
        // Scope to the trip via the stop's day (defense against cross-trip stopIds).
        inArray(
          itineraryStop.dayId,
          getDrizzle().select({ id: itineraryDay.id }).from(itineraryDay).where(eq(itineraryDay.tripId, tripId))
        )
      )
    )
    .run();
  return requireTrip(tripId);
}

export function moveStop(
  tripId: string,
  stopId: string,
  targetDayId: string,
  targetOrder: number
): TripWithDetails {
  getDrizzle().transaction((tx) => {
    const stopRow = tx.select().from(itineraryStop).where(eq(itineraryStop.id, stopId)).get();
    if (!stopRow) throw new Error("Stop not found");

    const targetDay = tx
      .select({ id: itineraryDay.id })
      .from(itineraryDay)
      .where(and(eq(itineraryDay.id, targetDayId), eq(itineraryDay.tripId, tripId)))
      .get();
    if (!targetDay) throw new Error("Target day not found");

    const sourceDayId = stopRow.dayId;

    tx.update(itineraryStop)
      .set({ ord: sql`${itineraryStop.ord} + 1` })
      .where(and(eq(itineraryStop.dayId, targetDayId), gte(itineraryStop.ord, targetOrder)))
      .run();
    // A manual move locks the stop (ADR-0006): the user's placement now survives re-opt.
    tx.update(itineraryStop).set({ dayId: targetDayId, ord: targetOrder, locked: true }).where(eq(itineraryStop.id, stopId)).run();

    if (sourceDayId !== targetDayId) {
      const remaining = tx
        .select({ id: itineraryStop.id })
        .from(itineraryStop)
        .where(eq(itineraryStop.dayId, sourceDayId))
        .orderBy(asc(itineraryStop.ord))
        .all();
      for (let i = 0; i < remaining.length; i++) {
        tx.update(itineraryStop).set({ ord: i }).where(eq(itineraryStop.id, remaining[i].id)).run();
      }
    }
  });

  return requireTrip(tripId);
}

/**
 * Delete a stop. Unless keepLocation, orphan-delete the underlying Location when it has
 * no remaining stops — but a lodging Location (referenced by a Stay) is never orphan-deleted.
 */
export function deleteStop(tripId: string, stopId: string, keepLocation: boolean): void {
  getDrizzle().transaction((tx) => {
    const s = tx
      .select({ locationId: itineraryStop.locationId })
      .from(itineraryStop)
      .where(eq(itineraryStop.id, stopId))
      .get();

    tx.delete(itineraryStop).where(eq(itineraryStop.id, stopId)).run();

    if (!keepLocation && s) {
      const remaining = tx
        .select({ c: count() })
        .from(itineraryStop)
        .where(eq(itineraryStop.locationId, s.locationId))
        .get();
      if ((remaining?.c ?? 0) === 0) {
        // A Location referenced by a Stay plays the lodging role (ADR-0014) and is never
        // orphan-deleted — it's removed by dissolving its Stay (relegation).
        const referencedByStay =
          tx
            .select({ x: sql<number>`1` })
            .from(stay)
            .where(and(eq(stay.tripId, tripId), eq(stay.lodgingLocationId, s.locationId)))
            .get() !== undefined;
        if (!referencedByStay) tx.delete(location).where(eq(location.id, s.locationId)).run();
      }
    }
  });
}

// ─── Enrichment ───────────────────────────────────────────────────────────────

export type EnrichableLocation = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
};

export function getEnrichableLocations(tripId: string): EnrichableLocation[] {
  return getDrizzle()
    .select({ id: location.id, name: location.name, lat: location.lat, lng: location.lng, placeId: location.placeId })
    .from(location)
    .where(and(eq(location.tripId, tripId), inArray(location.enrichmentStatus, ["pending", "failed"])))
    .all();
}

export function getLocationForEnrichment(locationId: string): EnrichableLocation | null {
  return (
    getDrizzle()
      .select({ id: location.id, name: location.name, lat: location.lat, lng: location.lng, placeId: location.placeId })
      .from(location)
      .where(eq(location.id, locationId))
      .get() ?? null
  );
}

export function markEnrichmentFailed(locationId: string): void {
  getDrizzle().update(location).set({ enrichmentStatus: "failed" }).where(eq(location.id, locationId)).run();
}

/**
 * Apply a (partial) enrichment result: set only the non-null fields (so partial results
 * never overwrite good data with null), and mark 'done'. Returns false (and marks
 * 'failed') when the enrichment is empty.
 */
export function applyEnrichment(locationId: string, e: Partial<LocationEnrichment>): boolean {
  if (Object.keys(e).length === 0) {
    markEnrichmentFailed(locationId);
    return false;
  }
  const set: Partial<typeof location.$inferInsert> = { enrichmentStatus: "done" };
  if (e.placeId != null) set.placeId = e.placeId;
  if (e.lat != null) set.lat = e.lat;
  if (e.lng != null) set.lng = e.lng;
  if (e.address != null) set.address = e.address;
  if (e.rating != null) set.rating = e.rating;
  if (e.reviewCount != null) set.reviewCount = e.reviewCount;
  if (e.categories != null) set.categories = e.categories;
  if (e.phone != null) set.phone = e.phone;
  if (e.openTime != null) set.openTime = e.openTime;
  if (e.closeTime != null) set.closeTime = e.closeTime;
  if (e.hoursJson != null) set.hoursJson = e.hoursJson;
  getDrizzle().update(location).set(set).where(eq(location.id, locationId)).run();
  return true;
}
