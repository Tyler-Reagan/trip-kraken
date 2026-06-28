/**
 * Integration test for the ADR-0015 model: Locations typed by `kind`, lodging dates as constraint
 * fields, the plan as `Placement`s, and day-presence as a derived projection (not stored). Standalone
 * (no test runner): run with `tsx src/lib/db/model.test.ts`. It points the repository's global Drizzle
 * handle at a throwaway temp DB, then exercises the kind-aware repository end-to-end and checks the
 * projection helpers in @/types against what the repository returns.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import {
  createTripWithLocations,
  createLocation,
  setLodgingDates,
  setPlacements,
  setDayLabel,
  importBookingLodging,
  getTripWithDetails,
  LodgingValidationError,
} from "@/lib/db";
import {
  isActivity,
  isLodging,
  rolesOf,
  lodgingOnNight,
  lodgingCoversNight,
  numDaysOf,
  tripDates,
  dayNumberOf,
  addDaysIso,
  type Lodging,
} from "@/types";
import { parseBookingConfirmation } from "@/lib/bookingImport";

// Stand up a temp DB and install it as the repository's connection BEFORE any repo call.
// (The repo's getDrizzle() is lazy, so the static import above never opens the real dev DB.)
const dir = fs.mkdtempSync(path.join(tmpdir(), "tk-test-"));
const sqlite = new Database(path.join(dir, "test.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
(globalThis as unknown as { _drizzle?: typeof db })._drizzle = db;

function expectRejected(fn: () => void, label: string) {
  assert.throws(fn, (e) => e instanceof LodgingValidationError, `expected ${label} to be rejected`);
}

// ── Pure date helpers: the single projection axis (ADR-0015 §3) ──
assert.equal(numDaysOf("2026-06-24", "2026-06-26"), 3, "inclusive day count");
assert.deepEqual(tripDates("2026-06-24", "2026-06-26"), ["2026-06-24", "2026-06-25", "2026-06-26"], "every trip date");
assert.equal(dayNumberOf("2026-06-24", "2026-06-26"), 3, "1-based day number");
assert.equal(addDaysIso("2026-06-24", 2), "2026-06-26", "add days (UTC, no DST drift)");

// ── Fixture: a required-date 3-day trip with two imported places ──
const trip = createTripWithLocations({
  name: "Test trip",
  sourceUrl: "",
  startDate: "2026-06-24",
  endDate: "2026-06-26",
  locations: [{ name: "A" }, { name: "B" }],
});
assert.equal(trip.startDate, "2026-06-24", "trip carries its required start date");
assert.equal(trip.endDate, "2026-06-26", "trip carries its required end date");
const A = trip.locations.find((l) => l.name === "A")!.id;
const B = trip.locations.find((l) => l.name === "B")!.id;

// ── Default kind: imported places are activities until a constraint elevates them (ADR-0015 §1) ──
assert.ok(trip.locations.every(isActivity), "imported places default to kind=activity");
assert.deepEqual(rolesOf(trip.locations[0]), [], "a plain activity has no role (candidate)");

// ── The kind-elevating gesture: attaching dates makes a place a lodging (ADR-0015 §2) ──
setLodgingDates(trip.id, A, { checkInDate: "2026-06-24", checkOutDate: "2026-06-26" }); // nights 24, 25
setLodgingDates(trip.id, B, { checkInDate: "2026-06-26", checkOutDate: "2026-06-27" }); // night 26 (adjacent switch)

const details = getTripWithDetails(trip.id)!;
const a = details.locations.find((l) => l.id === A)!;
assert.ok(isLodging(a), "A narrowed to kind=lodging");
assert.deepEqual(rolesOf(a), ["lodging"], "a lodging derives the lodging role");
if (isLodging(a)) {
  assert.equal(a.checkInDate, "2026-06-24", "lodging carries its check-in date");
  assert.equal(a.checkOutDate, "2026-06-26", "lodging carries its check-out date");
}

// ── Day-presence is a derived projection over the date fields — never stored (ADR-0015 §2) ──
const lodgings: Lodging[] = details.locations.filter(isLodging);
assert.equal(lodgingOnNight(lodgings, "2026-06-24")?.id, A, "night 24 → A");
assert.equal(lodgingOnNight(lodgings, "2026-06-25")?.id, A, "night 25 → A");
assert.equal(lodgingOnNight(lodgings, "2026-06-26")?.id, B, "night 26 → B (the switch)");
assert.ok(!lodgingCoversNight(lodgings.find((l) => l.id === A)! , "2026-06-26"), "half-open: checkout night is not covered");

// ── The plan: setPlacements writes activities; re-optimize replaces wholesale (ADR-0015 §5) ──
const C = createLocation(trip.id, { name: "C (activity)" }).id;
setPlacements(trip.id, [{ locationId: C, date: "2026-06-25", order: 0 }]);
let plan = getTripWithDetails(trip.id)!.placements;
assert.equal(plan.length, 1, "one placement stored");
assert.deepEqual(
  { locationId: plan[0].locationId, date: plan[0].date, order: plan[0].order },
  { locationId: C, date: "2026-06-25", order: 0 },
  "placement round-trips"
);
// Wholesale replace: a second setPlacements discards the prior plan entirely (no diff, no locks).
setPlacements(trip.id, [{ locationId: C, date: "2026-06-24", order: 0 }]);
plan = getTripWithDetails(trip.id)!.placements;
assert.equal(plan.length, 1, "re-optimize replaced, not appended");
assert.equal(plan[0].date, "2026-06-24", "placement moved to the new plan");

// ── Lodging validation (LodgingValidationError) ──
expectRejected(() => setLodgingDates(trip.id, B, { checkInDate: "2026-06-25", checkOutDate: "2026-06-24" }), "checkIn >= checkOut");
expectRejected(() => setLodgingDates(trip.id, B, { checkInDate: "2026-06-25", checkOutDate: "2026-06-27" }), "overlaps A's nights");
expectRejected(() => setLodgingDates(trip.id, "not-a-location", { checkInDate: "2026-06-24", checkOutDate: "2026-06-25" }), "location not in trip");

// ── Day labels live in a {date → label} map on the Trip (days are not an entity, ADR-0015) ──
const labelled = setDayLabel(trip.id, "2026-06-25", "Museum day");
assert.deepEqual(labelled.dayLabels, { "2026-06-25": "Museum day" }, "label stored under its date");
const cleared = setDayLabel(trip.id, "2026-06-25", "");
assert.deepEqual(cleared.dayLabels, {}, "empty label clears the entry");

// ── Booking import (ADR-0010, #57): property → lodging Location with dates ──
const parsed = parseBookingConfirmation(
  ["Your stay at Hotel Sakura", "Check-in: August 3, 2026", "Check-out: 2026-08-06", "Confirmation #ABC"].join("\n")
);
assert.ok(parsed.ok, "clean confirmation parses");
if (parsed.ok) {
  assert.equal(parsed.booking.property, "Hotel Sakura", "property parsed");
  assert.equal(parsed.booking.checkInDate, "2026-08-03", "check-in parsed from a month-name date");
  assert.equal(parsed.booking.checkOutDate, "2026-08-06", "check-out parsed from an ISO date");
}
assert.equal(parseBookingConfirmation("no dates or property here").ok, false, "malformed confirmation reports an error");

const it = createTripWithLocations({ name: "Import trip", sourceUrl: "", startDate: "2026-08-03", endDate: "2026-08-08", locations: [] });
const imp1 = importBookingLodging(it.id, { property: "Hotel Sakura", checkInDate: "2026-08-03", checkOutDate: "2026-08-06" });
const sakura = imp1.locations.find((l) => l.name === "Hotel Sakura")!;
assert.ok(sakura && isLodging(sakura), "the property became a lodging Location");
// Re-importing the same property name resolves the existing Location (no duplicate).
const imp2 = importBookingLodging(it.id, { property: "hotel sakura", checkInDate: "2026-08-06", checkOutDate: "2026-08-08" });
assert.equal(imp2.locations.filter((l) => l.name.toLowerCase() === "hotel sakura").length, 1, "same property resolves — no duplicate");
assert.equal(imp2.locations.filter(isLodging).length, 1, "still one lodging (dates extended, not duplicated)");
expectRejected(
  () => importBookingLodging(it.id, { property: "Hotel Overlap", checkInDate: "2026-08-04", checkOutDate: "2026-08-07" }),
  "overlapping booking import"
);

// ── Blank-slate trip (ADR-0010): null sourceUrl, no locations, but still a required date range ──
const blank = createTripWithLocations({ name: "Blank trip", sourceUrl: null, startDate: "2026-09-01", endDate: "2026-09-05", locations: [] });
assert.equal(blank.sourceUrl, null, "blank-slate trip has a null sourceUrl");
assert.equal(blank.locations.length, 0, "blank-slate trip starts with no locations");
assert.equal(numDaysOf(blank.startDate, blank.endDate), 5, "blank trip still has a real calendar");

fs.rmSync(dir, { recursive: true, force: true });
console.log("✓ model.test.ts passed");
