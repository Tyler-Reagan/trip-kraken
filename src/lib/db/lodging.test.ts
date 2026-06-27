/**
 * Integration test for date bookings → derived day-anchors / optimizer night-ranges (ADR-0014).
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

// ── Happy path: A covers 06-24→06-26, B covers 06-26→06-27 (adjacent — a same-day switch) ──
setStays(trip.id, [
  { lodgingLocationId: A, checkInDate: "2026-06-24", checkOutDate: "2026-06-26" },
  { lodgingLocationId: B, checkInDate: "2026-06-26", checkOutDate: "2026-06-27" },
]);

const details = getTripWithDetails(trip.id)!;
const [d1, d2, d3] = details.days;
// Day 1 is a check-in/arrival day: no origin (no prior night), A is the overnight/end.
assert.equal(d1.startLodging, null, "day1 has no origin (arrival day)");
assert.equal(d1.endLodging?.id, A, "day1 overnights at A");
// Day 2 is a round-trip day at A: woke there, sleep there → shown once as the start anchor.
assert.equal(d2.startLodging?.id, A, "day2 starts at A (woke there)");
assert.equal(d2.endLodging, null, "day2 round-trips at A → no separate end");
// Day 3 is the travel day: woke at A, sleep at B.
assert.equal(d3.startLodging?.id, A, "day3 starts at A (travel day)");
assert.equal(d3.endLodging?.id, B, "day3 ends at B (travel day)");

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
      { lodgingLocationId: A, checkInDate: "2026-06-24", checkOutDate: "2026-06-26" },
      { lodgingLocationId: B, checkInDate: "2026-06-25", checkOutDate: "2026-06-27" },
    ]),
  "overlapping bookings"
);
expectRejected(
  () => setStays(trip.id, [{ lodgingLocationId: A, checkInDate: "2026-06-26", checkOutDate: "2026-06-24" }]),
  "checkInDate >= checkOutDate"
);
expectRejected(
  () => setStays(trip.id, [{ lodgingLocationId: "not-a-location", checkInDate: "2026-06-24", checkOutDate: "2026-06-25" }]),
  "lodging not in trip"
);

fs.rmSync(dir, { recursive: true, force: true });
console.log("✓ lodging.test.ts passed");
