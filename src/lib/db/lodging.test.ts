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
  createLocation,
  updateTrip,
  setStays,
  setTripEndpoints,
  getTripWithDetails,
  getOptimizationInputs,
  StayValidationError,
  newId,
} from "@/lib/db";
import { optimizeItinerary } from "@/lib/optimizer";

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
assert.equal(d1.startAnchor, null, "day1 has no origin (arrival day)");
assert.equal(d1.endAnchor?.id, A, "day1 overnights at A");
// Day 2 is a round-trip day at A: woke there, sleep there → shown once as the start anchor.
assert.equal(d2.startAnchor?.id, A, "day2 starts at A (woke there)");
assert.equal(d2.endAnchor, null, "day2 round-trips at A → no separate end");
// Day 3 is the travel day: woke at A, sleep at B.
assert.equal(d3.startAnchor?.id, A, "day3 starts at A (travel day)");
assert.equal(d3.endAnchor?.id, B, "day3 ends at B (travel day)");
// Check-in waypoint (ADR-0013 Phase 2): a lodging you sleep at but didn't wake at is dropped into
// the route mid-day to leave bags, then reappears as the overnight end anchor (visited twice).
assert.equal(d1.checkInWaypoint?.id, A, "day1 checks into A on arrival");
assert.equal(d2.checkInWaypoint, null, "day2 round-trips at A → no check-in");
assert.equal(d3.checkInWaypoint?.id, B, "day3 checks into B mid-route");
assert.equal(d3.checkInWaypoint?.id, d3.endAnchor?.id, "day3 check-in and overnight are the same B");

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

// ── Trip-edge anchors (ADR-0005, #54): arrival on Day 1, departure on the last Day ──
const AP = createLocation(trip.id, { name: "Airport In", lat: 35.0, lng: 139.0 }).id;
const DP = createLocation(trip.id, { name: "Airport Out", lat: 35.9, lng: 139.9 }).id;
// One Stay at A across all nights, so days 2/3 are plain round-trips at A (no travel-day noise).
setStays(trip.id, [{ lodgingLocationId: A, checkInDate: "2026-06-24", checkOutDate: "2026-06-27" }]);
setTripEndpoints(trip.id, { arrivalLocationId: AP, departureLocationId: DP });

const e = getTripWithDetails(trip.id)!;
assert.equal(e.arrivalLocationId, AP, "trip records arrival");
assert.equal(e.departureLocationId, DP, "trip records departure");
const [e1, e2, e3] = e.days;
assert.equal(e1.startAnchor?.id, AP, "day1 starts at the arrival anchor");
assert.deepEqual(e1.startAnchor?.roles, ["arrival"], "arrival Location derives the arrival role");
assert.equal(e1.endAnchor?.id, A, "day1 still overnights at A");
assert.equal(e1.checkInWaypoint?.id, A, "day1 checks into A even though it arrives via transport");
assert.equal(e3.checkInWaypoint, null, "departure day has no lodging check-in");
assert.equal(e2.startAnchor?.id, A, "middle day is a plain round-trip at A");
assert.equal(e2.endAnchor, null, "middle day round-trips → no separate end");
assert.equal(e3.endAnchor?.id, DP, "last day ends at the departure anchor");
assert.deepEqual(e3.endAnchor?.roles, ["departure"], "departure Location derives the departure role");
// Endpoints surface to the optimizer; arrival/departure are non-excluded so the inputs carry them.
const eopt = getOptimizationInputs(trip.id)!;
assert.equal(eopt.arrivalLocationId, AP);
assert.equal(eopt.departureLocationId, DP);

// Fallback: clearing the endpoints restores the pure lodging bookends.
setTripEndpoints(trip.id, { arrivalLocationId: null, departureLocationId: null });
const f = getTripWithDetails(trip.id)!;
assert.equal(f.days[0].startAnchor, null, "no arrival → day1 has no origin again");
assert.equal(f.days[2].endAnchor, null, "no departure → last day round-trips at A");

expectRejected(
  () => setTripEndpoints(trip.id, { arrivalLocationId: "nope", departureLocationId: null }),
  "endpoint not in trip"
);

// ── Optimizer: Day 1 routes from arrival, the last Day to departure; anchors are never stops ──
const optPlan = optimizeItinerary(
  [
    { id: "ap", lat: 35.0, lng: 139.0 },   // arrival (one end)
    { id: "dp", lat: 35.9, lng: 139.9 },   // departure (other end)
    { id: "lo", lat: 35.5, lng: 139.5 },   // lodging (anchor, not a stop)
    { id: "s1", lat: 35.2, lng: 139.2 },   // nearer arrival
    { id: "s2", lat: 35.7, lng: 139.7 },   // nearer departure
  ],
  1,
  [{ lodgingId: "lo", startNight: 1, endNight: 1 }],
  undefined,
  undefined,
  [],
  { arrivalId: "ap", departureId: "dp" }
);
const day1Ids = optPlan[0].locationIds;
assert.ok(!["ap", "dp", "lo"].some((id) => day1Ids.includes(id)), "anchors are not emitted as stops");
assert.deepEqual(day1Ids, ["s1", "s2"], "stops ordered arrival → … → departure");

// ── Optimizer travel-day routing (ADR-0005, #55): a hotel-change day routes woke(A) → … → sleep(B) ──
// Stay LA night 1, Stay LB night 2 (far-apart cities). One activity near A clusters to Day 1; two
// between A and B cluster to Day 2 — the travel day, which must route from A toward B.
const travelPlan = optimizeItinerary(
  [
    { id: "la", lat: 35.0, lng: 139.0 },  // lodging A (night 1)
    { id: "lb", lat: 35.0, lng: 140.0 },  // lodging B (night 2)
    { id: "a1", lat: 35.0, lng: 139.05 }, // near A → Day 1
    { id: "m1", lat: 35.0, lng: 139.6 },  // nearer A's side of the leg → earlier on Day 2
    { id: "m2", lat: 35.0, lng: 139.8 },  // nearer B's side → later on Day 2
  ],
  2,
  [
    { lodgingId: "la", startNight: 1, endNight: 1 },
    { lodgingId: "lb", startNight: 2, endNight: 2 },
  ]
);
const travelDay = travelPlan.find((p) => p.dayNumber === 2)!.locationIds;
assert.ok(!["la", "lb"].some((id) => travelDay.includes(id)), "lodgings are not stops on the travel day");
assert.deepEqual(travelDay, ["m1", "m2"], "travel day routes woke A → … → sleep B");

fs.rmSync(dir, { recursive: true, force: true });
console.log("✓ lodging.test.ts passed");
