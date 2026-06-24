import type DatabaseType from "better-sqlite3";
import { randomUUID } from "crypto";
import { eq, and, gt, gte, asc, desc, sql, count, max, getTableColumns } from "drizzle-orm";
import { getDrizzle, getSqlite } from "./client";
import { trip, location, stay, itineraryDay, itineraryStop } from "./schema";
import type { TripWithDetails, Location, ItineraryDay } from "@/types";

/**
 * Repository layer (ADR-0008). The schema lives in ./schema.ts and is applied by the
 * migration runner in ./client.ts. These helpers use typed Drizzle queries — Drizzle
 * auto-parses the json/boolean-mode columns, so there is no manual JSON.parse / `!== 0`
 * deserialization. `isLodging` is not a column; it is derived from Stay membership
 * (ADR-0002/0005): a Location is lodging iff a Stay references it.
 *
 * `getDb()` exposes the raw better-sqlite3 handle for route handlers whose hand-written
 * SQL has not yet been moved into this repository (tracked follow-up).
 */

/** Raw better-sqlite3 handle (same API as the old node:sqlite `getDb()`). */
export function getDb(): DatabaseType.Database {
  return getSqlite();
}

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

// ─── Queries ──────────────────────────────────────────────────────────────────

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

// ─── Mutations ────────────────────────────────────────────────────────────────

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

export function rebuildItinerary(
  tripId: string,
  numDays: number,
  startDate: string | null,
  dayPlans: Array<{ dayNumber: number; locationIds: string[] }>
): TripWithDetails {
  getDrizzle().transaction((tx) => {
    tx.delete(itineraryDay).where(eq(itineraryDay.tripId, tripId)).run();
    tx.update(trip)
      .set({
        numDays,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(trip.id, tripId))
      .run();

    for (const plan of dayPlans) {
      const dayId = newId();
      const date =
        startDate && plan.dayNumber > 0
          ? new Date(new Date(startDate).getTime() + (plan.dayNumber - 1) * 86400000).toISOString()
          : null;
      tx.insert(itineraryDay).values({ id: dayId, tripId, dayNumber: plan.dayNumber, date }).run();
      for (let i = 0; i < plan.locationIds.length; i++) {
        tx.insert(itineraryStop)
          .values({ id: newId(), dayId, locationId: plan.locationIds[i], ord: i })
          .run();
      }
    }
  });

  return requireTrip(tripId);
}

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
      // Shift stops after the anchor up by one, then slot in right after it.
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

    tx.insert(itineraryStop).values({ id: newId(), dayId, locationId, ord }).run();
  });

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

    // Make room at targetOrder, then move the stop in.
    tx.update(itineraryStop)
      .set({ ord: sql`${itineraryStop.ord} + 1` })
      .where(and(eq(itineraryStop.dayId, targetDayId), gte(itineraryStop.ord, targetOrder)))
      .run();
    tx.update(itineraryStop).set({ dayId: targetDayId, ord: targetOrder }).where(eq(itineraryStop.id, stopId)).run();

    // Re-pack the source day's ords if the stop left it.
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
