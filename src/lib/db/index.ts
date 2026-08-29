import { randomUUID } from "crypto";
import { eq, and, asc, desc, ne, gt, gte, max, sql, count, inArray, isNotNull, getTableColumns } from "drizzle-orm";
import { getDrizzle, type Drizzle } from "./client";
import { trip, location, placement, journeyRoadKind } from "./schema";
import type { TripWithDetails, Location, Placement, JourneyRoadKind, IsoDate } from "@/types";
import type { LocationEnrichment } from "@/lib/places";
import type { ParsedBooking } from "@/lib/bookingImport";
import type { RoadProfile } from "@/types/path";
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
 *
 * Every function here is async (ADR-0037): Turso/libSQL is Promise-based even against a local
 * file, unlike the synchronous better-sqlite3 driver this replaced.
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
    roadProfile: r.roadProfile,
    transitCaveatDismissed: r.transitCaveatDismissed,
    hasJrPass: r.hasJrPass,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

/** Narrow one DB row into the discriminated union (ADR-0015 §1, ADR-0028). A lodging row must
 *  carry the booking dates that made it lodging; a transit row carries whichever of
 *  `arriveAt`/`departAt` made it transit (possibly both); for activity, those columns are dropped
 *  from the type. */
function toLocation(r: typeof location.$inferSelect): Location {
  const { kind, checkInDate, checkOutDate, arriveAt, departAt, ...base } = r;
  switch (kind) {
    case "lodging":
      if (!checkInDate || !checkOutDate)
        throw new Error(`Lodging ${r.id} is missing its booking dates — DB inconsistency`);
      return { ...base, kind, checkInDate, checkOutDate };
    case "transit":
      // Every row this narrows is a real database row — `authored: true` by construction (ADR-0035).
      return { ...base, kind, authored: true, arriveAt: arriveAt ?? null, departAt: departAt ?? null };
    case "activity":
      return { ...base, kind };
    default:
      throw new Error(`Unknown location kind: ${kind satisfies never}`);
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listTrips() {
  const db = await getDrizzle();
  const rows = await db
    .select({ ...getTableColumns(trip), locationCount: count(location.id) })
    .from(trip)
    .leftJoin(location, eq(location.tripId, trip.id))
    .groupBy(trip.id)
    .orderBy(desc(trip.createdAt))
    .all();

  return rows.map((r) => ({ ...parseTrip(r), _count: { locations: r.locationCount } }));
}

export async function getTripWithDetails(id: string): Promise<TripWithDetails | null> {
  const db = await getDrizzle();

  const tripRow = await db.select().from(trip).where(eq(trip.id, id)).get();
  if (!tripRow) return null;

  const locationRows = await db
    .select()
    .from(location)
    .where(eq(location.tripId, id))
    .orderBy(asc(location.name))
    .all();
  const locations = locationRows.map(toLocation);

  // The plan, flat and ordered. Day-clustering and projected lodging/transit presence are derived
  // by the consumer (Timeline) from these placements + the locations' constraint fields.
  const placements: Placement[] = await db
    .select()
    .from(placement)
    .where(eq(placement.tripId, id))
    .orderBy(asc(placement.date), asc(placement.order))
    .all();

  const journeyRoadKinds: JourneyRoadKind[] = await db
    .select()
    .from(journeyRoadKind)
    .where(eq(journeyRoadKind.tripId, id))
    .all();

  return { ...parseTrip(tripRow), locations, placements, journeyRoadKinds };
}

/** Canonical (unordered) key for a Journey's Location pair — sorted so `(a, b)` and `(b, a)` land
 *  on the same row regardless of which direction the caller names them in. */
function canonicalJourneyPair(locationIdA: string, locationIdB: string): [string, string] {
  return locationIdA < locationIdB ? [locationIdA, locationIdB] : [locationIdB, locationIdA];
}

async function requireTrip(tripId: string): Promise<TripWithDetails> {
  const t = await getTripWithDetails(tripId);
  if (!t) throw new Error(`Trip ${tripId} not found after write — possible DB inconsistency`);
  return t;
}

export async function tripExists(tripId: string): Promise<boolean> {
  const db = await getDrizzle();
  return (await db.select({ id: trip.id }).from(trip).where(eq(trip.id, tripId)).get()) !== undefined;
}

export async function getLocation(locationId: string): Promise<Location | null> {
  const db = await getDrizzle();
  const row = await db.select().from(location).where(eq(location.id, locationId)).get();
  return row ? toLocation(row) : null;
}

export async function getLocationCoords(
  tripId: string,
  locationId: string
): Promise<{ lat: number | null; lng: number | null } | null> {
  const db = await getDrizzle();
  const r = await db
    .select({ lat: location.lat, lng: location.lng })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .get();
  return r ?? null;
}

export async function locationExistsByPlaceId(tripId: string, placeId: string): Promise<boolean> {
  const db = await getDrizzle();
  return (
    (await db
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.tripId, tripId), eq(location.placeId, placeId)))
      .get()) !== undefined
  );
}

/** Distinct categories across the activities placed on a date (for nearby diversity scoring). */
export async function getDayCategories(tripId: string, date: IsoDate): Promise<string[]> {
  const db = await getDrizzle();
  const rows = await db
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

/** Thrown by `createTripWithLocations` when the DB's unique index rejects a name the app-level
 *  `checkTripNameCollision` pre-check missed — the race it exists to close (#121). Carries the same
 *  shape the pre-check returns, so a caller handles both identically. */
export class TripNameCollisionError extends Error {
  constructor(public readonly collision: TripNameCollision) {
    super(`Trip name collision: "${collision.existingTrips[0]?.name}"`);
  }
}

/**
 * Guards trip creation against silently producing indistinguishable trips. `Trip.id` is a random
 * UUID — it never collides, so it was never actually the identity a duplicate check should key
 * off. `name` is the one field a person actually reads on the homepage, so that's the collision
 * that matters (whether the create came from a blank-trip form or a My Maps re-import); this check
 * is shared by both call sites rather than each re-deriving its own notion of "the same trip."
 */
export async function checkTripNameCollision(name: string): Promise<TripNameCollision | null> {
  const trips = await listTrips();
  const matches = trips.filter((t) => t.name === name);
  if (matches.length === 0) return null;
  return {
    duplicate: true,
    existingTrips: matches.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, locationCount: t._count.locations })),
    suggestedName: dedupeName(name, trips.map((t) => t.name)),
  };
}

export async function createTripWithLocations(data: {
  name: string;
  /** Null for blank-slate trips (ADR-0010); the My Maps import passes the source URL. */
  sourceUrl?: string | null;
  /** Required temporal axis (ADR-0015 §3): every trip has a real calendar range. */
  startDate: IsoDate;
  endDate: IsoDate;
  locations: Array<{
    name: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    placeId?: string | null;
  }>;
}): Promise<TripWithDetails> {
  const tripId = newId();
  const db = await getDrizzle();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(trip).values({
        id: tripId,
        name: data.name,
        sourceUrl: data.sourceUrl ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
      });
      for (const loc of data.locations) {
        // Imported places start as activities; kind is elevated later by the gesture that attaches
        // a constraint (e.g. setLodgingDates). enrichment is pending so they get geocoded.
        await tx.insert(location).values({
          id: newId(),
          tripId,
          name: loc.name,
          address: loc.address ?? null,
          lat: loc.lat ?? null,
          lng: loc.lng ?? null,
          placeId: loc.placeId ?? null,
          enrichmentStatus: "pending",
        });
      }
    });
  } catch (e) {
    // The DB is the final word on uniqueness (#121) — the app-level checkTripNameCollision
    // pre-check is best-effort and can lose a race between two concurrent creates. Translate the
    // constraint violation into the same shape the pre-check returns, so a caller handles both
    // identically. Drizzle wraps the driver error in a DrizzleQueryError; the libSQL error it
    // wraps carries the specific SQLite code in `extendedCode` (`code` is only the generic
    // "SQLITE_CONSTRAINT"), and the original "UNIQUE constraint failed: Trip.name" message lives
    // on that wrapped cause, not on DrizzleQueryError's own (generic "Failed query: ...") message.
    const cause = e instanceof Error ? e.cause : undefined;
    if (
      cause instanceof Error &&
      "extendedCode" in cause &&
      cause.extendedCode === "SQLITE_CONSTRAINT_UNIQUE" &&
      cause.message.includes("Trip.name")
    ) {
      const collision = await checkTripNameCollision(data.name);
      if (collision) throw new TripNameCollisionError(collision);
    }
    throw e;
  }

  return requireTrip(tripId);
}

export async function updateTrip(
  id: string,
  fields: {
    name?: string;
    startDate?: IsoDate;
    endDate?: IsoDate;
    dayLabels?: Record<string, string> | null;
    roadProfile?: RoadProfile;
    transitCaveatDismissed?: boolean;
    hasJrPass?: boolean;
  }
): Promise<TripWithDetails> {
  const db = await getDrizzle();
  await db.transaction(async (tx) => {
    await tx
      .update(trip)
      .set({
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.startDate !== undefined ? { startDate: fields.startDate } : {}),
        ...(fields.endDate !== undefined ? { endDate: fields.endDate } : {}),
        ...(fields.dayLabels !== undefined ? { dayLabels: fields.dayLabels } : {}),
        ...(fields.roadProfile !== undefined ? { roadProfile: fields.roadProfile } : {}),
        ...(fields.transitCaveatDismissed !== undefined ? { transitCaveatDismissed: fields.transitCaveatDismissed } : {}),
        ...(fields.hasJrPass !== undefined ? { hasJrPass: fields.hasJrPass } : {}),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(trip.id, id));

    // The trip edges' date component follows the trip's own dates (ADR-0028 §3) — a user never
    // edits it directly, so a date-range change must carry a stored arrival/departure forward
    // rather than leaving it pointing at a date the trip no longer has.
    if (fields.startDate !== undefined) await rewriteEdgeDate(tx, id, "arriveAt", fields.startDate);
    if (fields.endDate !== undefined) await rewriteEdgeDate(tx, id, "departAt", fields.endDate);
  });
  return requireTrip(id);
}

/** Re-stamp a trip edge's date component after the trip's date range moves, preserving any time
 *  the edge already carried (ADR-0028 §3). A no-op when no Location currently holds that edge. */
async function rewriteEdgeDate(tx: Tx, tripId: string, field: "arriveAt" | "departAt", newDate: IsoDate) {
  const column = field === "arriveAt" ? location.arriveAt : location.departAt;
  const row = await tx
    .select({ id: location.id, value: column })
    .from(location)
    .where(and(eq(location.tripId, tripId), isNotNull(column)))
    .get();
  if (!row || row.value == null) return;
  const time = row.value.includes("T") ? row.value.slice(row.value.indexOf("T")) : "";
  const next = `${newDate}${time}`;
  if (field === "arriveAt") await tx.update(location).set({ arriveAt: next }).where(eq(location.id, row.id));
  else await tx.update(location).set({ departAt: next }).where(eq(location.id, row.id));
}

export async function deleteTrip(id: string): Promise<void> {
  const db = await getDrizzle();
  await db.delete(trip).where(eq(trip.id, id));
}

/**
 * Set or clear a day's label (ADR-0015). Days are a derived clustering, not an entity, so the only
 * thing a day owns — its label — lives in a {date → label} map on the Trip. An empty label clears.
 */
export async function setDayLabel(tripId: string, date: IsoDate, label: string | null): Promise<TripWithDetails> {
  const db = await getDrizzle();
  const row = await db.select({ dayLabels: trip.dayLabels }).from(trip).where(eq(trip.id, tripId)).get();
  if (!row) throw new Error("Trip not found");
  const labels = { ...(row.dayLabels ?? {}) };
  if (label && label.trim()) labels[date] = label;
  else delete labels[date];
  await db.update(trip).set({ dayLabels: labels, updatedAt: sql`(datetime('now'))` }).where(eq(trip.id, tripId));
  return requireTrip(tripId);
}

/**
 * Set or clear a Journey's chosen road kind (issue #217). `kind: null` clears it. Upserts on the
 * canonicalized pair rather than insert-then-conflict — a Journey has one current choice, not a
 * history of them.
 */
export async function setJourneyRoadKind(
  tripId: string,
  fromLocationId: string,
  toLocationId: string,
  kind: RoadProfile | null
): Promise<TripWithDetails> {
  const db = await getDrizzle();
  const [locationAId, locationBId] = canonicalJourneyPair(fromLocationId, toLocationId);

  if (kind === null) {
    await db
      .delete(journeyRoadKind)
      .where(
        and(
          eq(journeyRoadKind.tripId, tripId),
          eq(journeyRoadKind.locationAId, locationAId),
          eq(journeyRoadKind.locationBId, locationBId)
        )
      );
    return requireTrip(tripId);
  }

  const existing = await db
    .select({ id: journeyRoadKind.id })
    .from(journeyRoadKind)
    .where(
      and(
        eq(journeyRoadKind.tripId, tripId),
        eq(journeyRoadKind.locationAId, locationAId),
        eq(journeyRoadKind.locationBId, locationBId)
      )
    )
    .get();

  if (existing) {
    await db.update(journeyRoadKind).set({ kind }).where(eq(journeyRoadKind.id, existing.id));
  } else {
    await db.insert(journeyRoadKind).values({ id: newId(), tripId, locationAId, locationBId, kind });
  }

  return requireTrip(tripId);
}

// ─── The plan ─────────────────────────────────────────────────────────────────

/**
 * Replace the trip's plan wholesale (ADR-0015 §5). Re-optimize is explicit and total: it
 * regenerates every placement, and manual edits persist only until the next optimize. There is no
 * lock-preserving diff — that machinery is gone. Only activities are placed; the caller (optimizer)
 * upholds that invariant.
 */
export async function setPlacements(
  tripId: string,
  placements: Array<{ locationId: string; date: IsoDate; order: number }>
): Promise<TripWithDetails> {
  const db = await getDrizzle();
  await db.transaction(async (tx) => {
    await tx.delete(placement).where(eq(placement.tripId, tripId));
    for (const p of placements) {
      await tx.insert(placement).values({ id: newId(), tripId, locationId: p.locationId, date: p.date, order: p.order });
    }
  });
  return requireTrip(tripId);
}

type Tx = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];

/** Replace a trip's placements wholesale within a transaction (small per-trip row counts, so this
 *  is simpler and no slower than diffing which rows actually changed). */
async function replacePlacements(tx: Tx, tripId: string, placements: Placement[]) {
  await tx.delete(placement).where(eq(placement.tripId, tripId));
  for (const p of placements) {
    await tx.insert(placement).values({ id: p.id, tripId: p.tripId, locationId: p.locationId, date: p.date, order: p.order });
  }
}

/**
 * Manually place an activity on a date (ADR-0015) — a hand edit that persists until the next
 * optimize. Appends to the end of the date unless `order` is given, in which case siblings at or
 * after it shift down to make room. Reordering itself is the shared, pure `insertPlacement`
 * algorithm (src/lib/placementOrdering.ts) so the server and the store's optimistic client patch
 * can never drift apart.
 */
export async function addPlacement(
  tripId: string,
  locationId: string,
  date: IsoDate,
  order?: number
): Promise<TripWithDetails> {
  const db = await getDrizzle();
  await db.transaction(async (tx) => {
    const loc = await tx
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
      .get();
    if (!loc) throw new Error("Location not found in trip");

    const existing = await tx.select().from(placement).where(eq(placement.tripId, tripId)).all();
    const next = insertPlacement(existing, tripId, { id: newId(), locationId, date, order });
    await replacePlacements(tx, tripId, next);
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
export async function movePlacement(
  tripId: string,
  placementId: string,
  date: IsoDate,
  order: number
): Promise<TripWithDetails> {
  const db = await getDrizzle();
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(placement).where(eq(placement.tripId, tripId)).all();
    if (!existing.some((p) => p.id === placementId)) throw new Error("Placement not found");
    const next = reorderPlacements(existing, placementId, date, order);
    await replacePlacements(tx, tripId, next);
  });
  return requireTrip(tripId);
}

/** Unschedule an activity (ADR-0015): delete the placement, never the Location — it stays a
 *  candidate in the Manifest. */
export async function removePlacement(tripId: string, placementId: string): Promise<TripWithDetails> {
  const db = await getDrizzle();
  await db.delete(placement).where(and(eq(placement.id, placementId), eq(placement.tripId, tripId)));
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
export async function setLodgingDates(
  tripId: string,
  locationId: string,
  dates: { checkInDate: IsoDate; checkOutDate: IsoDate }
): Promise<TripWithDetails> {
  const db = await getDrizzle();
  const { checkInDate, checkOutDate } = dates;

  if (Number.isNaN(Date.parse(checkInDate)) || Number.isNaN(Date.parse(checkOutDate)))
    throw new LodgingValidationError("Invalid check-in/check-out date");
  if (checkInDate >= checkOutDate) throw new LodgingValidationError("Check-in must be before check-out");

  // The stay must cover at least one of the trip's nights. This is the same half-open
  // intersection optimize.ts uses to build night-ranges, stated as a rule instead of a silent
  // drop: a stay it discards leaves a Location that is a lodging by kind — so filtered out of the
  // activity list — with no night to render on, invisible in both views. Checking out the morning
  // after the final night is normal, hence `checkOutDate > startDate` rather than `<= endDate`.
  const owner = await db
    .select({ startDate: trip.startDate, endDate: trip.endDate })
    .from(trip)
    .where(eq(trip.id, tripId))
    .get();
  if (!owner) throw new LodgingValidationError("Trip not found");
  if (checkInDate > owner.endDate || checkOutDate <= owner.startDate)
    throw new LodgingValidationError(
      `Stay (${checkInDate} to ${checkOutDate}) falls outside the trip's dates (${owner.startDate} to ${owner.endDate})`
    );

  const target = await db
    .select({ id: location.id })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .get();
  if (!target) throw new LodgingValidationError("Location is not in this trip");

  // Half-open intervals overlap iff each starts before the other ends. Adjacent same-day switches
  // (checkOut == next checkIn) are fine.
  const others = await db
    .select({ checkInDate: location.checkInDate, checkOutDate: location.checkOutDate })
    .from(location)
    .where(and(eq(location.tripId, tripId), eq(location.kind, "lodging"), ne(location.id, locationId)))
    .all();
  for (const o of others) {
    if (o.checkInDate && o.checkOutDate && checkInDate < o.checkOutDate && o.checkInDate < checkOutDate)
      throw new LodgingValidationError("Booking overlaps an existing lodging");
  }

  await db.update(location).set({ kind: "lodging", checkInDate, checkOutDate }).where(eq(location.id, locationId));
  return requireTrip(tripId);
}

/** Relegate a lodging back to a plain activity (ADR-0015): removing the booking — its constraint —
 *  drops it to kind=activity and clears the dates. */
export async function clearLodging(tripId: string, locationId: string): Promise<TripWithDetails> {
  const db = await getDrizzle();
  await db
    .update(location)
    .set({ kind: "activity", checkInDate: null, checkOutDate: null })
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)));
  return requireTrip(tripId);
}

/**
 * Import a parsed booking confirmation as a lodging (ADR-0010, #57). The property is resolved to an
 * existing trip Location by case-insensitive name, else created (pending enrichment so it gets
 * geocoded like any new place). setLodgingDates then attaches the dates and elevates kind; it
 * re-validates non-overlap, so a rejected import is pre-checked here to avoid leaving an orphan
 * Location behind.
 */
export async function importBookingLodging(tripId: string, booking: ParsedBooking): Promise<TripWithDetails> {
  const db = await getDrizzle();
  if (!(await tripExists(tripId))) throw new LodgingValidationError("Trip not found");
  if (Number.isNaN(Date.parse(booking.checkInDate)) || Number.isNaN(Date.parse(booking.checkOutDate)))
    throw new LodgingValidationError("Invalid check-in/check-out date");
  if (booking.checkInDate >= booking.checkOutDate)
    throw new LodgingValidationError("Check-in must be before check-out");

  const existingLodgings = await db
    .select({ checkInDate: location.checkInDate, checkOutDate: location.checkOutDate })
    .from(location)
    .where(and(eq(location.tripId, tripId), eq(location.kind, "lodging")))
    .all();
  for (const s of existingLodgings) {
    if (s.checkInDate && s.checkOutDate && booking.checkInDate < s.checkOutDate && s.checkInDate < booking.checkOutDate)
      throw new LodgingValidationError("Booking overlaps an existing lodging");
  }

  const locs = await db
    .select({ id: location.id, name: location.name })
    .from(location)
    .where(eq(location.tripId, tripId))
    .all();
  const match = locs.find((l) => l.name.trim().toLowerCase() === booking.property.trim().toLowerCase());
  const locationId = match
    ? match.id
    : (await createLocation(tripId, { name: booking.property, enrichmentStatus: "pending" })).id;

  return setLodgingDates(tripId, locationId, {
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
  });
}

// ─── Transit trip edges ─────────────────────────────────────────────────────

/** Thrown when a proposed trip-edge assignment violates ADR-0028 invariants. */
export class TransitValidationError extends Error {}

const HHMM = /^\d{2}:\d{2}$/;

/**
 * Designate a Location as the trip's arrival, elevating it to `kind: transit` (ADR-0028 §1/§2) —
 * the same "the gesture that attaches a constraint elevates the kind" rule `setLodgingDates`
 * follows for lodging. The date component is always the trip's first date, read fresh here rather
 * than trusted from the caller; the caller supplies only an optional time ("HH:MM"), never a date.
 * `time: null` designates the edge with no known time yet, still anchoring the geography.
 *
 * At most one Location per Trip may hold `arriveAt`. Whichever Location held it before is released
 * in the same transaction the new one is set, so "assign a different arrival" never needs a
 * separate clear step and the two can never disagree. A partial unique index (schema.ts) backs
 * this as a database guarantee, not just a write-path convention.
 */
export async function setTripArrival(tripId: string, locationId: string, time: string | null): Promise<TripWithDetails> {
  const db = await getDrizzle();
  if (time != null && !HHMM.test(time)) throw new TransitValidationError("Invalid time (expected HH:MM)");
  const t = await db.select({ startDate: trip.startDate }).from(trip).where(eq(trip.id, tripId)).get();
  if (!t) throw new TransitValidationError("Trip not found");
  const target = await db
    .select({ id: location.id })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .get();
  if (!target) throw new TransitValidationError("Location is not in this trip");
  const arriveAt = time != null ? `${t.startDate}T${time}` : t.startDate;

  await db.transaction(async (tx) => {
    // Release whoever held the arrival before — clearing the field alone isn't enough if that was
    // its only edge, or the release would leave a `kind: transit` row with both fields null.
    const holder = await tx
      .select({ id: location.id, departAt: location.departAt })
      .from(location)
      .where(and(eq(location.tripId, tripId), isNotNull(location.arriveAt), ne(location.id, locationId)))
      .get();
    if (holder) {
      await tx
        .update(location)
        .set({ arriveAt: null, ...(holder.departAt == null ? { kind: "activity" } : {}) })
        .where(eq(location.id, holder.id));
    }
    await tx.update(location).set({ kind: "transit", arriveAt }).where(eq(location.id, locationId));
  });
  return requireTrip(tripId);
}

/** The departure mirror of `setTripArrival` — the trip's last date (ADR-0028 §1/§2). */
export async function setTripDeparture(tripId: string, locationId: string, time: string | null): Promise<TripWithDetails> {
  const db = await getDrizzle();
  if (time != null && !HHMM.test(time)) throw new TransitValidationError("Invalid time (expected HH:MM)");
  const t = await db.select({ endDate: trip.endDate }).from(trip).where(eq(trip.id, tripId)).get();
  if (!t) throw new TransitValidationError("Trip not found");
  const target = await db
    .select({ id: location.id })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .get();
  if (!target) throw new TransitValidationError("Location is not in this trip");
  const departAt = time != null ? `${t.endDate}T${time}` : t.endDate;

  await db.transaction(async (tx) => {
    const holder = await tx
      .select({ id: location.id, arriveAt: location.arriveAt })
      .from(location)
      .where(and(eq(location.tripId, tripId), isNotNull(location.departAt), ne(location.id, locationId)))
      .get();
    if (holder) {
      await tx
        .update(location)
        .set({ departAt: null, ...(holder.arriveAt == null ? { kind: "activity" } : {}) })
        .where(eq(location.id, holder.id));
    }
    await tx.update(location).set({ kind: "transit", departAt }).where(eq(location.id, locationId));
  });
  return requireTrip(tripId);
}

/**
 * Release a Location from an edge role (ADR-0028). Clearing the *last* of `arriveAt`/`departAt`
 * relegates the Location back to `kind: activity` — the same "removing the constraint drops the
 * kind" rule `clearLodging` follows; clearing one of two still leaves it transit.
 */
export async function clearTripEdge(tripId: string, locationId: string, which: "arrival" | "departure"): Promise<TripWithDetails> {
  const db = await getDrizzle();
  const row = await db
    .select({ arriveAt: location.arriveAt, departAt: location.departAt })
    .from(location)
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)))
    .get();
  if (!row) throw new TransitValidationError("Location is not in this trip");

  const clearingArrival = which === "arrival";
  const relegate = (clearingArrival ? row.departAt : row.arriveAt) == null;

  await db
    .update(location)
    .set({
      ...(clearingArrival ? { arriveAt: null } : { departAt: null }),
      ...(relegate ? { kind: "activity" } : {}),
    })
    .where(and(eq(location.id, locationId), eq(location.tripId, tripId)));
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

export async function createLocation(tripId: string, data: NewLocationInput): Promise<Location> {
  const id = newId();
  const db = await getDrizzle();
  await db.insert(location).values({
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
  });
  const loc = await getLocation(id);
  if (!loc) throw new Error("Location not found after insert");
  return loc;
}

/** Update a Location's editable fields. Lodging dates are managed via setLodgingDates, not here. */
export async function updateLocation(
  tripId: string,
  locationId: string,
  fields: {
    excluded?: boolean;
    note?: string | null;
    name?: string;
    visitDuration?: number | null;
  }
): Promise<Location | null> {
  const set = {
    ...(fields.excluded !== undefined ? { excluded: fields.excluded } : {}),
    ...(fields.note !== undefined ? { note: fields.note } : {}),
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.visitDuration !== undefined ? { visitDuration: fields.visitDuration } : {}),
  };
  if (Object.keys(set).length) {
    const db = await getDrizzle();
    await db
      .update(location)
      .set(set)
      .where(and(eq(location.id, locationId), eq(location.tripId, tripId)));
  }
  return getLocation(locationId);
}

/** Delete a Location; its placements cascade away (ADR-0015 — no Stay to dissolve first). */
export async function deleteLocation(locationId: string): Promise<void> {
  const db = await getDrizzle();
  await db.delete(location).where(eq(location.id, locationId));
}

// ─── Enrichment ───────────────────────────────────────────────────────────────

export type EnrichableLocation = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
};

/** Every Location still `enrichmentStatus: 'pending'`, across every Trip — the durable work-list
 *  ADR-0009 decided on (#124): no separate jobs table, the pending rows *are* the queue. Read once
 *  at server startup to re-enqueue anything the in-memory queue lost to a process restart. */
export async function getPendingLocationIds(): Promise<string[]> {
  const db = await getDrizzle();
  const rows = await db.select({ id: location.id }).from(location).where(eq(location.enrichmentStatus, "pending")).all();
  return rows.map((r) => r.id);
}

export async function getEnrichableLocations(tripId: string): Promise<EnrichableLocation[]> {
  const db = await getDrizzle();
  return db
    .select({ id: location.id, name: location.name, lat: location.lat, lng: location.lng, placeId: location.placeId })
    .from(location)
    .where(and(eq(location.tripId, tripId), inArray(location.enrichmentStatus, ["pending", "failed"])))
    .all();
}

export async function getLocationForEnrichment(locationId: string): Promise<EnrichableLocation | null> {
  const db = await getDrizzle();
  return (
    (await db
      .select({ id: location.id, name: location.name, lat: location.lat, lng: location.lng, placeId: location.placeId })
      .from(location)
      .where(eq(location.id, locationId))
      .get()) ?? null
  );
}

/** `reason` is what the Retry affordance shows the user, so it must read as a sentence about this
 *  place, not as a stack frame. */
export async function markEnrichmentFailed(locationId: string, reason: string): Promise<void> {
  const db = await getDrizzle();
  await db
    .update(location)
    .set({ enrichmentStatus: "failed", enrichmentError: reason })
    .where(eq(location.id, locationId));
}

/**
 * Apply a (partial) enrichment result: set only the non-null fields (so partial results never
 * overwrite good data with null), and mark 'done'. Returns false (and marks 'failed') when the
 * enrichment is empty.
 */
export async function applyEnrichment(locationId: string, e: Partial<LocationEnrichment>): Promise<boolean> {
  if (Object.keys(e).length === 0) {
    await markEnrichmentFailed(locationId, "No matching place found for this name.");
    return false;
  }
  // Clearing the error alongside the status: a row that succeeds on retry must not keep showing
  // why it failed the time before.
  const set: Partial<typeof location.$inferInsert> = { enrichmentStatus: "done", enrichmentError: null };
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
  const db = await getDrizzle();
  await db.update(location).set(set).where(eq(location.id, locationId));
  return true;
}
