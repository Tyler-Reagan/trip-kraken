/**
 * Drizzle schema — the single source of truth for the database shape (ADR-0008, reshaped by ADR-0015).
 *
 * Domain model per ADR-0015: Trip → (Locations, Placements).
 *  - One place primitive, `Location`, typed by `kind` ∈ {activity, transit, lodging}: a
 *    discriminated union over a single table (subtype columns nullable). "Lodging" is a kind,
 *    not a role derived from a reference — the Stay table is gone, its dates fold onto Location.
 *  - The constraint/plan seam: intrinsic temporal facts are *fields on the Location* (optimizer
 *    inputs — a Lodging's checkIn/checkOut; transit times parked). The plan is the optimizer's
 *    *output*: stored `Placement`s {date, locationId, order}. Only activities are placed; lodging
 *    and transit day-presence is a derived projection over their date fields, never stored.
 *  - One temporal axis: every Trip has a required start/end date; day-numbers derive. Days are not
 *    an entity — a day's optional label lives in Trip.dayLabels ({date → label}).
 *  - Roles (lodging/arrival/departure/candidate/anchor) and trip edges are derived adjectives,
 *    never stored. No isLodging, no role column, no arrival/departure FK. Locking is removed.
 *  - Trip.sourceUrl is nullable to allow blank-slate trips (ADR-0010).
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const trip = sqliteTable("Trip", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceUrl: text("sourceUrl"), // nullable: blank-slate trips have no import source (ADR-0010)
  // The single temporal axis (ADR-0015 §3): a required calendar range "YYYY-MM-DD". Day-numbers
  // are a derived label over it; the date/day-number dual mode is gone.
  startDate: text("startDate").notNull(),
  endDate: text("endDate").notNull(),
  // A day's optional label, keyed by date. Days are a derived clustering of Placements, not an
  // entity, so the only thing a day "owns" — a label — rides here (locked decision, ADR-0015).
  dayLabels: text("dayLabels", { mode: "json" }).$type<Record<string, string>>(),
  // Which OSRM profile answers this Trip's road cells (ADR-0024, amended 2026-08-11) — the
  // traveler-facing selector CONTEXT.md's "kind (Path)" entry licenses returning ("the term
  // returns only if a traveler-facing selector does"). Deliberately narrower than the deleted
  // `allowedPathKinds`: it never gates osm-japan or google, only which profile a *road* cell
  // routes on. `notNull` + a default, not nullable: there is no meaningful unset state, same
  // reasoning as `transitCaveatDismissed` below.
  roadProfile: text("roadProfile", { enum: ["walking", "driving"] }).notNull().default("walking"),
  // Whether the user has dismissed ADR-0019's estimated-transit-timing caveat (#130) — persisted
  // so it stays dismissed across reloads instead of reappearing on every page mount.
  transitCaveatDismissed: integer("transitCaveatDismissed", { mode: "boolean" }).notNull().default(false),
  // Whether the traveler holds a Japan Rail Pass (issue #211) — gates the OSM-Japan provider's
  // graph search to hard-exclude confirmed non-JR-group operators. `notNull` + a default, same
  // reasoning as `transitCaveatDismissed` above: there is no meaningful unset state.
  hasJrPass: integer("hasJrPass", { mode: "boolean" }).notNull().default(false),
  createdAt: text("createdAt").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updatedAt").notNull().default(sql`(datetime('now'))`),
}, (t) => [
  // Hardens the app-level collision guard (checkTripNameCollision, #119) at the layer that can
  // actually make it hold under concurrency (#121) — two creates racing past the app-level
  // pre-check can no longer both succeed.
  uniqueIndex("trip_name_unique").on(t.name),
]);

export const location = sqliteTable("Location", {
  id: text("id").primaryKey(),
  tripId: text("tripId")
    .notNull()
    .references(() => trip.id, { onDelete: "cascade" }),
  // Discriminant for the single-table union (ADR-0015 §1). Defaults to `activity`; the gesture
  // that attaches a constraint (lodging dates / transit time) elevates it. `categories` (Places
  // types[]) is enrichment metadata, never the authority for `kind`.
  kind: text("kind", { enum: ["activity", "transit", "lodging"] })
    .notNull()
    .default("activity"),
  name: text("name").notNull(),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
  placeId: text("placeId"),
  excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  rating: real("rating"),
  reviewCount: integer("reviewCount"),
  categories: text("categories", { mode: "json" }).$type<string[]>(),
  // The small, domain-facing vocabulary derived from `categories` at write time (ADR-0023 §4,
  // issue #153) — what a VROOM capacity dimension keys off. Null means "not yet derived" (no
  // `categories` yet), distinct from the derived value `"other"`. See `activityCategory.ts`.
  category: text("category", { enum: ["food", "nightlife", "shopping", "sight", "other"] }),
  visitDuration: integer("visitDuration"),
  openTime: text("openTime"),
  closeTime: text("closeTime"),
  hoursJson: text("hoursJson", { mode: "json" }).$type<
    Record<string, { open: string; close: string | null }>
  >(),
  phone: text("phone"),
  // Lodging constraint fields, folded in from the removed Stay table (ADR-0015 §2/§5). Calendar
  // dates "YYYY-MM-DD", half-open: you sleep the nights in [checkInDate, checkOutDate). Nullable —
  // populated only for kind=lodging.
  checkInDate: text("checkInDate"),
  checkOutDate: text("checkOutDate"),
  // Transit constraint fields (ADR-0028), paying ADR-0015's parked bill. Local ISO, date-or-
  // datetime: "2026-09-14" designates a trip edge with no known time; "2026-09-14T14:00" designates
  // it and constrains that Day's window. Either present makes the kind transit, the same gesture
  // checkInDate/checkOutDate use for lodging. At most one Location per Trip carries each — enforced
  // below by a partial unique index, not just by the write path.
  arriveAt: text("arriveAt"),
  departAt: text("departAt"),
  enrichmentStatus: text("enrichmentStatus", { enum: ["done", "pending", "failed"] })
    .notNull()
    .default("done"),
  // Why the last enrichment attempt failed, for the Retry affordance to explain itself. Null
  // whenever `enrichmentStatus` isn't 'failed'. The two failure modes reach here from different
  // places — a thrown lookup error, and a lookup that simply matched nothing — and the UI can only
  // tell a user which one happened if the distinction is kept.
  enrichmentError: text("enrichmentError"),
}, (t) => [
  // The trip-edge uniqueness invariant (ADR-0028 §2). First index/unique constraint in this
  // schema; drizzle-kit 0.31 does emit the partial WHERE clause for SQLite (verified against the
  // generated migration and its snapshot), so this stays the single source of truth.
  uniqueIndex("arrival_per_trip").on(t.tripId).where(sql`${t.arriveAt} is not null`),
  uniqueIndex("departure_per_trip").on(t.tripId).where(sql`${t.departAt} is not null`),
]);

// The plan's stored unit (ADR-0015 §2), renamed Stop → Placement and re-parented from a Day to the
// Trip+date directly (days dissolved). Only activities are placed; order is within a date. `locked`
// and per-stop `notes` are gone — locking is removed, notes live on Location.
export const placement = sqliteTable("Placement", {
  id: text("id").primaryKey(),
  tripId: text("tripId")
    .notNull()
    .references(() => trip.id, { onDelete: "cascade" }),
  locationId: text("locationId")
    .notNull()
    .references(() => location.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  order: integer("order").notNull(),
});

// A rider's chosen road kind for one Journey (issue #209/#217, renamed from "LegModePin" #223 —
// "Leg" is retired domain vocabulary (ADR-0021) and "pin" implied a defensive override that
// resists change, which this isn't: it's a plain, resolved choice, the same status as any other
// setting). The road kind ("rail"/"bus" always stay eligible alongside it) this Journey uses
// instead of the Trip's `roadProfile` default, consulted at matrix-build time (#218). Keyed by
// Location pair rather than by Path/shift id — Paths are never persisted (`src/types/path.ts`) and
// Placements are wholesale-replaced by every re-optimize (ADR-0015), so neither is a safe key;
// Locations are the one stable thing in this chain. Stored unordered: `locationAId`/`locationBId`
// are canonicalized (lexicographically sorted) at the write path, not by insertion order — a
// Journey's chosen kind doesn't depend on which direction the itinerary happens to traverse it
// after a re-optimize reshuffles day order. (`pairKey` in `src/lib/pathPairs.ts` is directional,
// but that's a coordinate cache key for a routing *answer*, which can legitimately differ by
// direction — a different concern from which *kinds are eligible*, which doesn't.)
export const journeyRoadKind = sqliteTable("JourneyRoadKind", {
  id: text("id").primaryKey(),
  tripId: text("tripId")
    .notNull()
    .references(() => trip.id, { onDelete: "cascade" }),
  locationAId: text("locationAId")
    .notNull()
    .references(() => location.id, { onDelete: "cascade" }),
  locationBId: text("locationBId")
    .notNull()
    .references(() => location.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["walking", "driving"] }).notNull(),
}, (t) => [
  uniqueIndex("journey_road_kind_unique").on(t.tripId, t.locationAId, t.locationBId),
]);
