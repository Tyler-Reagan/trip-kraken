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
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import type { TravelMode } from "@/lib/travelCost";

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
  // The Trip's allowed travel modes (ADR-0019 §mode) — resolved to a single primary mode by
  // `resolvePrimaryMode` (travelCostRegistry.ts) at optimize time, replacing the old hardcoded
  // `DEFAULT_MODE` constant. Nullable rather than DB-defaulted: `resolvePrimaryMode` already
  // treats an unset Trip as the default set (which includes transit), so there is no meaningful
  // "unset" state to distinguish at the schema level.
  allowedModes: text("allowedModes", { mode: "json" }).$type<TravelMode[]>(),
  // Whether the user has dismissed ADR-0019's estimated-transit-timing caveat (#130) — persisted
  // so it stays dismissed across reloads instead of reappearing on every page mount.
  transitCaveatDismissed: integer("transitCaveatDismissed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("createdAt").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updatedAt").notNull().default(sql`(datetime('now'))`),
});

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
  visitDuration: integer("visitDuration"),
  openTime: text("openTime"),
  closeTime: text("closeTime"),
  hoursJson: text("hoursJson", { mode: "json" }).$type<
    Record<string, { open: string; close: string | null }>
  >(),
  phone: text("phone"),
  // Lodging constraint fields, folded in from the removed Stay table (ADR-0015 §2/§5). Calendar
  // dates "YYYY-MM-DD", half-open: you sleep the nights in [checkInDate, checkOutDate). Nullable —
  // populated only for kind=lodging. Transit constraint fields are parked (open bill).
  checkInDate: text("checkInDate"),
  checkOutDate: text("checkOutDate"),
  enrichmentStatus: text("enrichmentStatus", { enum: ["done", "pending", "failed"] })
    .notNull()
    .default("done"),
});

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
