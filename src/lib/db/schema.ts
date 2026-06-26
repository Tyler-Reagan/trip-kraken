/**
 * Drizzle schema — the single source of truth for the database shape (ADR-0008).
 *
 * Domain model per ADR-0002: Trip → (Locations, Stays, Days → Stops).
 *  - Lodging is no longer a boolean on Location; a Stay references a Location as its
 *    lodging (ADR-0005). "Is this Location a lodging?" = "is it referenced by a Stay?"
 *  - Stops carry a `locked` flag (ADR-0006).
 *  - Trip.sourceUrl is nullable to allow blank-slate trips (ADR-0010).
 * A Stay is a timed booking — a Lodging with check-in/check-out datetimes (ADR-0013).
 * Day → Stay membership and "nights" derive from those datetimes, so there is no stayId
 * column on a Day and no stored night-range.
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const trip = sqliteTable("Trip", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceUrl: text("sourceUrl"), // nullable: blank-slate trips have no import source (ADR-0010)
  numDays: integer("numDays"),
  startDate: text("startDate"),
  createdAt: text("createdAt").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updatedAt").notNull().default(sql`(datetime('now'))`),
});

export const location = sqliteTable("Location", {
  id: text("id").primaryKey(),
  tripId: text("tripId")
    .notNull()
    .references(() => trip.id, { onDelete: "cascade" }),
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
  enrichmentStatus: text("enrichmentStatus", { enum: ["done", "pending", "failed"] })
    .notNull()
    .default("done"),
});

export const stay = sqliteTable("Stay", {
  id: text("id").primaryKey(),
  tripId: text("tripId")
    .notNull()
    .references(() => trip.id, { onDelete: "cascade" }),
  // RESTRICT, not cascade: a Location serving as a Stay's Lodging can't be deleted out
  // from under it (would orphan the Stay's Days). Escape hatch = relegation: dissolve
  // the Stay first, then the Location is an ordinary candidate and deletes normally.
  lodgingLocationId: text("lodgingLocationId")
    .notNull()
    .references(() => location.id, { onDelete: "restrict" }),
  // ISO datetime strings (ADR-0013). Phase 1 enters dates only, with default times
  // (check-in 15:00, check-out 11:00). Stays are ordered by checkIn; nights derive from these.
  checkIn: text("checkIn").notNull(),
  checkOut: text("checkOut").notNull(),
});

export const itineraryDay = sqliteTable("ItineraryDay", {
  id: text("id").primaryKey(),
  tripId: text("tripId")
    .notNull()
    .references(() => trip.id, { onDelete: "cascade" }),
  dayNumber: integer("dayNumber").notNull(),
  date: text("date"),
  label: text("label"),
});

export const itineraryStop = sqliteTable("ItineraryStop", {
  id: text("id").primaryKey(),
  dayId: text("dayId")
    .notNull()
    .references(() => itineraryDay.id, { onDelete: "cascade" }),
  locationId: text("locationId")
    .notNull()
    .references(() => location.id, { onDelete: "cascade" }),
  ord: integer("ord").notNull(),
  notes: text("notes"),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false), // ADR-0006
});
