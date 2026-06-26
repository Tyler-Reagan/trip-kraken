/**
 * Integration test for the booking → derived-anchor / night-range conversion (ADR-0013).
 * Standalone (no test runner): run with `pnpm exec tsx src/lib/db/lodging.test.ts`. It points
 * the repository's global Drizzle handle at a throwaway temp DB, then exercises setStays,
 * getTripWithDetails, and getOptimizationInputs end-to-end.
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
  updateTrip,
  setStays,
  getTripWithDetails,
  getOptimizationInputs,
  StayValidationError,
  newId,
} from "@/lib/db";

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
  assert.throws(fn, (e) => e instanceof StayValidationError, `expected ${label} to be rejected`);
}

// ── Fixture: 3-day trip starting 2026-06-24, lodgings A and B ──
const trip = createTripWithLocations({
  name: "Test trip",
  sourceUrl: "",
  locations: [{ name: "A" }, { name: "B" }],
});
updateTrip(trip.id, { numDays: 3, startDate: "2026-06-24" });
for (const dayNumber of [1, 2, 3]) {
  db.insert(schema.itineraryDay).values({ id: newId(), tripId: trip.id, dayNumber }).run();
}
const A = trip.locations.find((l) => l.name === "A")!.id;
const B = trip.locations.find((l) => l.name === "B")!.id;

// ── Happy path: A covers 06-24→06-26, B covers 06-26→06-27 ──
setStays(trip.id, [
  { lodgingLocationId: A, checkIn: "2026-06-24T15:00:00", checkOut: "2026-06-26T11:00:00" },
  { lodgingLocationId: B, checkIn: "2026-06-26T15:00:00", checkOut: "2026-06-27T11:00:00" },
]);

const details = getTripWithDetails(trip.id)!;
const [d1, d2, d3] = details.days;
assert.equal(d1.startLodging?.id, A, "day1 start = A");
assert.equal(d1.endLodging, null, "day1 end same as start → null");
assert.equal(d2.startLodging?.id, A, "day2 start = A");
assert.equal(d2.endLodging, null, "day2 end same as start → null");
assert.equal(d3.startLodging?.id, A, "day3 start = A (travel day)");
assert.equal(d3.endLodging?.id, B, "day3 end = B (travel day)");

const opt = getOptimizationInputs(trip.id)!;
assert.deepEqual(
  opt.stays,
  [
    { lodgingLocationId: A, startNight: 1, endNight: 2 },
    { lodgingLocationId: B, startNight: 3, endNight: 3 },
  ],
  "night-ranges A(1-2), B(3)"
);

// ── Rejections ──
expectRejected(
  () =>
    setStays(trip.id, [
      { lodgingLocationId: A, checkIn: "2026-06-24T15:00:00", checkOut: "2026-06-26T11:00:00" },
      { lodgingLocationId: B, checkIn: "2026-06-25T15:00:00", checkOut: "2026-06-27T11:00:00" },
    ]),
  "overlapping bookings"
);
expectRejected(
  () => setStays(trip.id, [{ lodgingLocationId: A, checkIn: "2026-06-26T15:00:00", checkOut: "2026-06-24T11:00:00" }]),
  "checkIn >= checkOut"
);
expectRejected(
  () => setStays(trip.id, [{ lodgingLocationId: "not-a-location", checkIn: "2026-06-24T15:00:00", checkOut: "2026-06-25T11:00:00" }]),
  "lodging not in trip"
);

fs.rmSync(dir, { recursive: true, force: true });
console.log("✓ lodging.test.ts passed");
