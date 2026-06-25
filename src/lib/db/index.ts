import { randomUUID } from "crypto";
import { eq, and, gt, gte, asc, desc, sql, count, max, inArray, getTableColumns } from "drizzle-orm";
import { getDrizzle } from "./client";
import { trip, location, stay, itineraryDay, itineraryStop } from "./schema";
import type { TripWithDetails, Location, ItineraryDay } from "@/types";
import type { LocationEnrichment } from "@/lib/places";

/**
 * Repository layer (ADR-0008). The schema lives in ./schema.ts and is applied by the
 * migration runner in ./client.ts. All persistence goes through typed Drizzle queries
 * here — there is no raw SQL outside this module. Drizzle auto-parses json/boolean-mode
 * columns, so there is no manual JSON.parse / `!== 0` deserialization. `isLodging` is
 * not a column; it is derived from Stay membership (ADR-0002/0005).
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
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

/** Drizzle returns json/boolean columns already parsed; only isLodging is derived. */
function toLocation(r: typeof location.$inferSelect, lodgingIds: Set<string>): Location {
  return { ...r, isLodging: lodgingIds.has(r.id) };
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

  const stayRows = db.select().from(stay).where(eq(stay.tripId, id)).orderBy(asc(stay.ord)).all();
  const lodgingIds = new Set(stayRows.map((s) => s.lodgingLocationId));

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

  const days: ItineraryDay[] = dayRows.map((day) => ({
    id: day.id,
    tripId: day.tripId,
    dayNumber: day.dayNumber,
    date: day.date ? new Date(day.date) : null,
    label: day.label,
    stops: stopRows
      .filter((s) => s.stop.dayId === day.id)
      .map((s) => ({
        id: s.stop.id,
        dayId: s.stop.dayId,
        locationId: s.stop.locationId,
        order: s.stop.ord,
        notes: s.stop.notes,
        locked: s.stop.locked,
        location: toLocation(s.loc, lodgingIds),
      })),
  }));

  return {
    ...parseTrip(tripRow),
    locations: locationRows.map((l) => toLocation(l, lodgingIds)),
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

/** A single Location with derived isLodging. */
export function getLocation(locationId: string): Location | null {
  const db = getDrizzle();
  const row = db.select().from(location).where(eq(location.id, locationId)).get();
  if (!row) return null;
  const lodging = db
    .select({ x: sql<number>`1` })
    .from(stay)
    .where(eq(stay.lodgingLocationId, locationId))
    .get();
  return { ...row, isLodging: lodging !== undefined };
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
};

export function getOptimizationInputs(tripId: string): OptimizationInputs | null {
  const db = getDrizzle();
  if (!tripExists(tripId)) return null;

  const stays = db
    .select({ lodgingLocationId: stay.lodgingLocationId, startNight: stay.startNight, endNight: stay.endNight })
    .from(stay)
    .where(eq(stay.tripId, tripId))
    .orderBy(asc(stay.ord))
    .all();

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

  return { locations, stays };
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

/** Thrown when a proposed Stay timeline violates ADR-0002/0005 invariants. */
export class StayValidationError extends Error {}

export type StayInput = { lodgingLocationId: string; startNight: number; endNight: number };

/**
 * Replace a trip's Stay timeline atomically (ADR-0005). Validates ADR-0002 invariants:
 * each range within [1, numDays], non-overlapping, each lodging a Location in the trip.
 * Stays may have gaps (lodging is optional). Stays are stored ordered by startNight.
 * Lodging *stops* are not written here — they are generated per-day by optimize/rebuild.
 */
export function setStays(tripId: string, stays: StayInput[]): TripWithDetails {
  const db = getDrizzle();
  const tripRow = db.select({ numDays: trip.numDays }).from(trip).where(eq(trip.id, tripId)).get();
  if (!tripRow) throw new StayValidationError("Trip not found");
  const numDays = tripRow.numDays;

  const sorted = [...stays].sort((a, b) => a.startNight - b.startNight);

  for (const s of sorted) {
    if (!Number.isInteger(s.startNight) || !Number.isInteger(s.endNight) || s.startNight < 1 || s.endNight < s.startNight) {
      throw new StayValidationError(`Invalid night range ${s.startNight}–${s.endNight}`);
    }
    if (numDays != null && s.endNight > numDays) {
      throw new StayValidationError(`Stay ends on night ${s.endNight} but the trip has ${numDays} days`);
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startNight <= sorted[i - 1].endNight) {
      throw new StayValidationError("Stays overlap");
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
    sorted.forEach((s, ord) => {
      tx.insert(stay)
        .values({
          id: newId(),
          tripId,
          lodgingLocationId: s.lodgingLocationId,
          ord,
          startNight: s.startNight,
          endNight: s.endNight,
        })
        .run();
    });
  });

  return requireTrip(tripId);
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
        const isLodging =
          tx
            .select({ x: sql<number>`1` })
            .from(stay)
            .where(and(eq(stay.tripId, tripId), eq(stay.lodgingLocationId, s.locationId)))
            .get() !== undefined;
        if (!isLodging) tx.delete(location).where(eq(location.id, s.locationId)).run();
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
