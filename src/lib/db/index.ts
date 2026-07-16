import { randomUUID } from "crypto";
import { eq, and, asc, desc, ne, gt, gte, max, sql, count, inArray, getTableColumns } from "drizzle-orm";
import { getDrizzle, type Drizzle } from "./client";
import { trip, location, placement } from "./schema";
import type { TripWithDetails, Location, Placement, IsoDate } from "@/types";
import type { LocationEnrichment } from "@/lib/places";
import type { ParsedBooking } from "@/lib/bookingImport";
import type { TravelMode } from "@/lib/travelCost";
import { reorderPlacements, insertPlacement } from "@/lib/placementOrdering";
import { dedupeName } from "@/lib/dedupeName";

/**
 * Repository layer (ADR-0008, reshaped by ADR-0015). The schema lives in ./schema.ts and is applied
 * by the migration runner in ./client.ts. All persistence goes through typed Drizzle queries here —
 * no raw SQL outside this module, and Drizzle auto-parses json/boolean columns so there is no manual
 * deserialization. Locations are one table typed by `kind`; reads narrow each row into the
 * `Activity | Transit | Lodging` union. The plan is stored as `Placement`s; day-clustering, anchors,
 * and roles are *not* materialized here — they project from the constraint fields at read time via
 * the helpers in `@/types`. There is no Stay table, no locking, and no reconcile diff (ADR-0015).
 */

export const newId = () => randomUUID();

// ─── Mappers ──────────────────────────────────────────────────────────────────

function parseTrip(r: typeof trip.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    sourceUrl: r.sourceUrl,
    startDate: r.startDate,
    endDate: r.endDate,
    dayLabels: r.dayLabels ?? null,
    allowedModes: r.allowedModes ?? null,
    transitCaveatDismissed: r.transitCaveatDismissed,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

/** Narrow one DB row into the discriminated union (ADR-0015 §1). A lodging row must carry the
 *  booking dates that made it lodging; for other kinds those columns are dropped from the type. */
function toLocation(r: typeof location.$inferSelect): Location {
  const { kind, checkInDate, checkOutDate, ...base } = r;
  switch (kind) {
    case "lodging":
      if (!checkInDate || !checkOutDate)
        throw new Error(`Lodging ${r.id} is missing its booking dates — DB inconsistency`);
      return { ...base, kind, checkInDate, checkOutDate };
    case "transit":
      return { ...base, kind };
    case "activity":
      return { ...base, kind };
    default:
      throw new Error(`Unknown location kind: ${kind satisfies never}`);
  }
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

  const locations = db
    .select()
    .from(location)
    .where(eq(location.tripId, id))
    .orderBy(asc(location.name))
    .all()
    .map(toLocation);

  // The plan, flat and ordered. Day-clustering and projected lodging/transit presence are derived
  // by the consumer (Timeline) from these placements + the locations' constraint fields.
  const placements: Placement[] = db
    .select()
    .from(placement)
    .where(eq(placement.tripId, id))
    .orderBy(asc(placement.date), asc(placement.order))
    .all();

  return { ...parseTrip(tripRow), locations, placements };
}

function requireTrip(tripId: string): TripWithDetails {
  const t = getTripWithDetails(tripId);
  if (!t) throw new Error(`Trip ${tripId} not found after write — possible DB inconsistency`);
  return t;
}

export function tripExists(tripId: string): boolean {
  return getDrizzle().select({ id: trip.id }).from(trip).where(eq(trip.id, tripId)).get() !== undefined;
}

export function getLocation(locationId: string): Location | null {
  const row = getDrizzle().select().from(location).where(eq(location.id, locationId)).get();
  return row ? toLocation(row) : null;
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

/** Distinct categories across the activities placed on a date (for nearby diversity scoring). */
export function getDayCategories(tripId: string, date: IsoDate): string[] {
  const rows = getDrizzle()
    .select({ categories: location.categories })
    .from(placement)
    .innerJoin(location, eq(location.id, placement.locationId))
    .where(and(eq(placement.tripId, tripId), eq(placement.date, date)))
    .all();
  const set = new Set<string>();
  for (const r of rows) for (const c of r.categories ?? []) set.add(c);
  return [...set];
}

// ─── Trip mutations ─────────────────────────────────────────────────────────

export interface TripNameCollision {
  duplicate: true;
  existingTrips: { id: string; name: string; createdAt: Date; locationCount: number }[];
  suggestedName: string;
}

/**
 * Guards trip creation against silently producing indistinguishable trips. `Trip.id` is a random
 * UUID — it never collides, so it was never actually the identity a duplicate check should key
 * off. `name` is the one field a person actually reads on the homepage, so that's the collision
 * that matters (whether the create came from a blank-trip form or a My Maps re-import); this check
 * is shared by both call sites rather than each re-deriving its own notion of "the same trip."
 */
export function checkTripNameCollision(name: string): TripNameCollision | null {
  const trips = listTrips();
  const matches = trips.filter((t) => t.name === name);
  if (matches.length === 0) return null;
  return {
    duplicate: true,
    existingTrips: matches.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, locationCount: t._count.locations })),
    suggestedName: dedupeName(name, trips.map((t) => t.name)),
  };
}

export function createTripWithLocations(data: {
  name: string;
  /** Null for blank-slate trips (ADR-0010); the My Maps import passes the source URL. */
  sourceUrl?: string | null;
  /** Required temporal axis (ADR-0015 §3): every trip has a real calendar range. */
  startDate: IsoDate;
  endDate: IsoDate;
  /** ADR-0019 §mode; unset resolves to the default set (transit included) at optimize time. */
  allowedModes?: TravelMode[] | null;
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
    tx.insert(trip)
      .values({
        id: tripId,
        name: data.name,
        sourceUrl: data.sourceUrl ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
        allowedModes: data.allowedModes ?? null,
      })
      .run();
    for (const loc of data.locations) {
      // Imported places start as activities; kind is elevated later by the gesture that attaches a
      // constraint (e.g. setLodgingDates). enrichment is pending so they get geocoded.
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
  fields: {
    name?: string;
    startDate?: IsoDate;
    endDate?: IsoDate;
    dayLabels?: Record<string, string> | null;
    allowedModes?: TravelMode[] | null;
    transitCaveatDismissed?: boolean;
  }
): TripWithDetails {
  getDrizzle()
    .update(trip)
    .set({
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.startDate !== undefined ? { startDate: fields.startDate } : {}),
      ...(fields.endDate !== undefined ? { endDate: fields.endDate } : {}),
      ...(fields.dayLabels !== undefined ? { dayLabels: fields.dayLabels } : {}),
      ...(fields.allowedModes !== undefined ? { allowedModes: fields.allowedModes } : {}),
      ...(fields.transitCaveatDismissed !== undefined ? { transitCaveatDismissed: fields.transitCaveatDismissed } : {}),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(trip.id, id))
    .run();
  return requireTrip(id);
}

export function deleteTrip(id: string): void {
  getDrizzle().delete(trip).where(eq(trip.id, id)).run();
}

/**
 * Set or clear a day's label (ADR-0015). Days are a derived clustering, not an entity, so the only
 * thing a day owns — its label — lives in a {date → label} map on the Trip. An empty label clears.
 */
export function setDayLabel(tripId: string, date: IsoDate, label: string | null): TripWithDetails {
  const db = getDrizzle();
  const row = db.select({ dayLabels: trip.dayLabels }).from(trip).where(eq(trip.id, tripId)).get();
  if (!row) throw new Error("Trip not found");
  const labels = { ...(row.dayLabels ?? {}) };
  if (label && label.trim()) labels[date] = label;
  else delete labels[date];
  db.update(trip).set({ dayLabels: labels, updatedAt: sql`(datetime('now'))` }).where(eq(trip.id, tripId)).run();
  return requireTrip(tripId);
}

// ─── The plan ─────────────────────────────────────────────────────────────────

/**
 * Replace the trip's plan wholesale (ADR-0015 §5). Re-optimize is explicit and total: it
 * regenerates every placement, and manual edits persist only until the next optimize. There is no
 * lock-preserving diff — that machinery is gone. Only activities are placed; the caller (optimizer)
 * upholds that invariant.
 */
export function setPlacements(
  tripId: string,
  placements: Array<{ locationId: string; date: IsoDate; order: number }>
): TripWithDetails {
  getDrizzle().transaction((tx) => {
    tx.delete(placement).where(eq(placement.tripId, tripId)).run();
    for (const p of placements) {
      tx.insert(placement)
        .values({ id: newId(), tripId, locationId: p.locationId, date: p.date, order: p.order })
        .run();
    }
  });
  return requireTrip(tripId);
}

type Tx = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];

/** Replace a trip's placements wholesale within a transaction (small per-trip row counts, so this
 *  is simpler and no slower than diffing which rows actually changed). */
function replacePlacements(tx: Tx, tripId: string, placements: Placement[]) {
  tx.delete(placement).where(eq(placement.tripId, tripId)).run();
  for (const p of placements) {
    tx.insert(placement).values({ id: p.id, tripId: p.tripId, locationId: p.locationId, date: p.date, order: p.order }).run();
  }
}

/**
 * Manually place an activity on a date (ADR-0015) — a hand edit that persists until the next
 * optimize. Appends to the end of the date unless `order` is given, in which case siblings at or
 * after it shift down to make room. Reordering itself is the shared, pure `insertPlacement`
 * algorithm (src/lib/placementOrdering.ts) so the server and the store's optimistic client patch
 * can never drift apart.
 */
export function addPlacement(
  tripId: string,
  locationId: string,
  date: IsoDate,
  order?: number
): TripWithDetails {
  getDrizzle().transaction((tx) => {
    const loc = tx
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
      .get();
    if (!loc) throw new Error("Location not found in trip");

    const existing = tx.select().from(placement).where(eq(placement.tripId, tripId)).all();
    const next = insertPlacement(existing, tripId, { id: newId(), locationId, date, order });
    replacePlacements(tx, tripId, next);
  });
  return requireTrip(tripId);
}

/**
 * Move a placement to a date and order (ADR-0015). Siblings at/after the target order shift down;
 * if the placement left another date, that date's remaining placements are re-densified to 0..n.
 * Reordering itself is the shared, pure `reorderPlacements` algorithm
 * (src/lib/placementOrdering.ts) so the server and the store's optimistic client patch can never
 * drift apart.
 */
export function movePlacement(
  tripId: string,
  placementId: string,
  date: IsoDate,
  order: number
): TripWithDetails {
  getDrizzle().transaction((tx) => {
    const existing = tx.select().from(placement).where(eq(placement.tripId, tripId)).all();
    if (!existing.some((p) => p.id === placementId)) throw new Error("Placement not found");
    const next = reorderPlacements(existing, placementId, date, order);
    replacePlacements(tx, tripId, next);
  });
  return requireTrip(tripId);
}

/** Unschedule an activity (ADR-0015): delete the placement, never the Location — it stays a
 *  candidate in the Manifest. */
export function removePlacement(tripId: string, placementId: string): TripWithDetails {
  getDrizzle()
    .delete(placement)
    .where(and(eq(placement.id, placementId), eq(placement.tripId, tripId)))
    .run();
  return requireTrip(tripId);
}

// ─── Lodging ────────────────────────────────────────────────────────────────

/** Thrown when a proposed lodging booking violates ADR-0015 invariants. */
export class LodgingValidationError extends Error {}

/**
 * Attach a booking to a Location, elevating it to `kind: lodging` (ADR-0015 §2) — the gesture that
 * makes a place a lodging is giving it dates. Calendar dates "YYYY-MM-DD", half-open: you sleep the
 * nights in [checkInDate, checkOutDate). Validates ordering and non-overlap with the trip's other
 * lodgings (you sleep in one place per night; same-place multiplicity is out of scope).
 */
export function setLodgingDates(
  tripId: string,
  locationId: string,
  dates: { checkInDate: IsoDate; checkOutDate: IsoDate }
): TripWithDetails {
  const db = getDrizzle();
  const { checkInDate, checkOutDate } = dates;

  if (Number.isNaN(Date.parse(checkInDate)) || Number.isNaN(Date.parse(checkOutDate)))
    throw new LodgingValidationError("Invalid check-in/check-out date");
  if (checkInDate >= checkOutDate) throw new LodgingValidationError("Check-in must be before check-out");

  const target = db
    .select({ id: location.id })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .get();
  if (!target) throw new LodgingValidationError("Location is not in this trip");

  // Half-open intervals overlap iff each starts before the other ends. Adjacent same-day switches
  // (checkOut == next checkIn) are fine.
  const others = db
    .select({ checkInDate: location.checkInDate, checkOutDate: location.checkOutDate })
    .from(location)
    .where(and(eq(location.tripId, tripId), eq(location.kind, "lodging"), ne(location.id, locationId)))
    .all();
  for (const o of others) {
    if (o.checkInDate && o.checkOutDate && checkInDate < o.checkOutDate && o.checkInDate < checkOutDate)
      throw new LodgingValidationError("Booking overlaps an existing lodging");
  }

  db.update(location)
    .set({ kind: "lodging", checkInDate, checkOutDate })
    .where(eq(location.id, locationId))
    .run();
  return requireTrip(tripId);
}

/** Relegate a lodging back to a plain activity (ADR-0015): removing the booking — its constraint —
 *  drops it to kind=activity and clears the dates. */
export function clearLodging(tripId: string, locationId: string): TripWithDetails {
  getDrizzle()
    .update(location)
    .set({ kind: "activity", checkInDate: null, checkOutDate: null })
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .run();
  return requireTrip(tripId);
}

/**
 * Import a parsed booking confirmation as a lodging (ADR-0010, #57). The property is resolved to an
 * existing trip Location by case-insensitive name, else created (pending enrichment so it gets
 * geocoded like any new place). setLodgingDates then attaches the dates and elevates kind; it
 * re-validates non-overlap, so a rejected import is pre-checked here to avoid leaving an orphan
 * Location behind.
 */
export function importBookingLodging(tripId: string, booking: ParsedBooking): TripWithDetails {
  const db = getDrizzle();
  if (!tripExists(tripId)) throw new LodgingValidationError("Trip not found");
  if (Number.isNaN(Date.parse(booking.checkInDate)) || Number.isNaN(Date.parse(booking.checkOutDate)))
    throw new LodgingValidationError("Invalid check-in/check-out date");
  if (booking.checkInDate >= booking.checkOutDate)
    throw new LodgingValidationError("Check-in must be before check-out");

  const existingLodgings = db
    .select({ checkInDate: location.checkInDate, checkOutDate: location.checkOutDate })
    .from(location)
    .where(and(eq(location.tripId, tripId), eq(location.kind, "lodging")))
    .all();
  for (const s of existingLodgings) {
    if (s.checkInDate && s.checkOutDate && booking.checkInDate < s.checkOutDate && s.checkInDate < booking.checkOutDate)
      throw new LodgingValidationError("Booking overlaps an existing lodging");
  }

  const locs = db
    .select({ id: location.id, name: location.name })
    .from(location)
    .where(eq(location.tripId, tripId))
    .all();
  const match = locs.find((l) => l.name.trim().toLowerCase() === booking.property.trim().toLowerCase());
  const locationId = match
    ? match.id
    : createLocation(tripId, { name: booking.property, enrichmentStatus: "pending" }).id;

  return setLodgingDates(tripId, locationId, {
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
  });
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

/** Update a Location's editable fields. Lodging dates are managed via setLodgingDates, not here. */
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
  return getLocation(locationId);
}

/** Delete a Location; its placements cascade away (ADR-0015 — no Stay to dissolve first). */
export function deleteLocation(locationId: string): void {
  getDrizzle().delete(location).where(eq(location.id, locationId)).run();
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
 * Apply a (partial) enrichment result: set only the non-null fields (so partial results never
 * overwrite good data with null), and mark 'done'. Returns false (and marks 'failed') when the
 * enrichment is empty.
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
