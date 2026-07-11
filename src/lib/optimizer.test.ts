/**
 * Optimizer tests (ADR-0015). Two layers:
 *  - the pure solver `optimizeItinerary` — clustering, travel-day routing, trip-edge routing, and
 *    the invariant that anchors (lodgings/edges) are never emitted as stops;
 *  - the `optimizeTrip` orchestrator end-to-end over a temp DB — lodging dates → night anchoring,
 *    excluded/lodging places left unplaced, and the plan emitted as date-bucketed Placements.
 * Standalone (no test runner): run with `tsx src/lib/optimizer.test.ts`.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { optimizeItinerary } from "@/lib/optimizer";
import { solve } from "@/lib/solver";
import { optimizeTrip } from "@/lib/optimize";
import { haversineProvider, type TravelCostProvider } from "@/lib/travelCost";
import { createTripWithLocations, createLocation, setLodgingDates, updateLocation, getTripWithDetails } from "@/lib/db";
import { isActivity } from "@/types";

// optimizeItinerary/optimizeTrip are async (O2, ADR-0004); tsx compiles this file to CJS (no
// "type": "module" in package.json), which doesn't support top-level await, hence the wrapper —
// and the explicit exit-1 on failure, since an uncaught rejection here would otherwise be silent.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {

// ── Pure solver ──────────────────────────────────────────────────────────────

// Empty input → empty plan.
assert.deepEqual(await optimizeItinerary([], 3), [], "no locations → no plan");

// Trip-edge routing: Day 1 runs arrival → … → departure; anchors (lodging + edges) are never stops.
const edgePlan = await optimizeItinerary(
  [
    { id: "ap", lat: 35.0, lng: 139.0 }, // arrival (one end)
    { id: "dp", lat: 35.9, lng: 139.9 }, // departure (other end)
    { id: "lo", lat: 35.5, lng: 139.5 }, // lodging (anchor, not a stop)
    { id: "s1", lat: 35.2, lng: 139.2 }, // nearer arrival
    { id: "s2", lat: 35.7, lng: 139.7 }, // nearer departure
  ],
  1,
  [{ lodgingId: "lo", startNight: 1, endNight: 1 }],
  undefined,
  undefined,
  { arrivalId: "ap", departureId: "dp" }
);
const day1 = edgePlan[0].locationIds;
assert.ok(!["ap", "dp", "lo"].some((id) => day1.includes(id)), "anchors are not emitted as stops");
assert.deepEqual(day1, ["s1", "s2"], "stops ordered arrival → … → departure");

// Travel-day routing (ADR-0005): a hotel-change day routes from where you woke (A) toward where you
// sleep (B). Lodging A night 1, lodging B night 2 (far apart); two stops on the leg between them.
const travelPlan = await optimizeItinerary(
  [
    { id: "la", lat: 35.0, lng: 139.0 }, // lodging A (night 1)
    { id: "lb", lat: 35.0, lng: 140.0 }, // lodging B (night 2)
    { id: "a1", lat: 35.0, lng: 139.05 }, // near A → Day 1
    { id: "m1", lat: 35.0, lng: 139.6 }, // A's side of the leg → earlier on Day 2
    { id: "m2", lat: 35.0, lng: 139.8 }, // B's side → later on Day 2
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

// Clustering: two tight clusters far apart over 2 days land on different days.
const clusterPlan = await optimizeItinerary(
  [
    { id: "w1", lat: 35.0, lng: 139.0 },
    { id: "w2", lat: 35.01, lng: 139.01 },
    { id: "e1", lat: 35.0, lng: 141.0 },
    { id: "e2", lat: 35.01, lng: 141.01 },
  ],
  2
);
const dayOf = (id: string) => clusterPlan.find((p) => p.locationIds.includes(id))!.dayNumber;
assert.equal(dayOf("w1"), dayOf("w2"), "the west pair shares a day");
assert.equal(dayOf("e1"), dayOf("e2"), "the east pair shares a day");
assert.notEqual(dayOf("w1"), dayOf("e1"), "the two clusters are on different days");

// ── solve() / ADR-0017 feasibility violations ─────────────────────────────────

// A single stop whose window can't be hit at all (closes before the day even starts) must be
// reported, not silently absorbed into the arrangement.
const impossible = await solve({
  locations: [{ id: "late", lat: 35.0, lng: 139.0, openTime: "06:00", closeTime: "07:00" }],
  numDays: 1,
  dayStartMins: 9 * 60,
});
assert.equal(impossible.feasibilityViolations.length, 1, "an unreachable window is reported");
assert.equal(impossible.feasibilityViolations[0].rule, "closed-hours");
assert.equal(impossible.feasibilityViolations[0].locationId, "late");

// A day comfortably within budget and hours reports no violations.
const clean = await solve({
  locations: [{ id: "ok", lat: 35.0, lng: 139.0, visitDuration: 60, openTime: "09:00", closeTime: "18:00" }],
  numDays: 1,
  dayBudgetMinutes: 8 * 60,
  dayStartMins: 9 * 60,
});
assert.deepEqual(clean.feasibilityViolations, [], "a feasible day reports no violations");

// Regression (arrival-simulation fix, review finding): evaluateDayFeasibility must seed its clock
// from the day's actual start anchor (travel time from the lodging, plus the lodging's own
// assumed visit time), not assume arrival at dayStartMins with zero travel cost — otherwise a stop
// only reachable late because of a long transfer from the lodging is missed entirely. Lodging
// covers night 1 only, so Day 2's start anchor is that lodging (~90km / ~4.5h walking from the
// far stop); Day 2's stop closes well before that travel time would land you there.
const anchorTravel = await solve({
  locations: [
    { id: "lo", lat: 35.0, lng: 139.0 },
    { id: "s_near", lat: 35.0, lng: 139.01 }, // Day 1, no window — never a source of violations
    { id: "s_far", lat: 35.0, lng: 140.0, openTime: "09:00", closeTime: "11:00" }, // Day 2
  ],
  numDays: 2,
  stays: [{ lodgingId: "lo", startNight: 1, endNight: 1 }],
  dayStartMins: 9 * 60,
});
assert.equal(
  anchorTravel.feasibilityViolations.length,
  1,
  "a stop only reachable late once the start anchor's travel time is counted is reported"
);
assert.equal(anchorTravel.feasibilityViolations[0].locationId, "s_far");

// Regression (crash-bug fix, review finding): a not-yet-geocoded lodging (lat/lng default to
// (0,0)) must never be handed to sequencing as an anchor — it's excluded from the distance
// lookup, so using it as a dist.km/mins key would throw. Falls back to no anchor instead.
const ungeocodedLodgingPlan = await optimizeItinerary(
  [
    { id: "lo", lat: 0, lng: 0 }, // lodging, not yet geocoded
    { id: "s1", lat: 35.0, lng: 139.0 },
    { id: "s2", lat: 35.01, lng: 139.01 },
  ],
  1,
  [{ lodgingId: "lo", startNight: 1, endNight: 1 }]
);
assert.deepEqual(
  ungeocodedLodgingPlan[0].locationIds.slice().sort(),
  ["s1", "s2"],
  "both stops placed despite an ungeocoded lodging anchor"
);

// Regression (crash-bug fix, review finding): a not-yet-geocoded activity sharing a day with
// geocoded stops must not crash solve()'s feasibility pass — it's excluded from travel-time
// scoring the same way optimizer.ts excludes it from sequencing (no distance to/from it exists).
const withUngeocodedActivity = await solve({
  locations: [
    { id: "g1", lat: 35.0, lng: 139.0, visitDuration: 60 },
    { id: "g2", lat: 35.01, lng: 139.01, visitDuration: 60 },
    { id: "noloc", lat: 0, lng: 0, visitDuration: 30 },
  ],
  numDays: 1,
});
assert.equal(
  withUngeocodedActivity.days[0].locationIds.length,
  3,
  "all three stops are placed, including the ungeocoded one"
);

// Regression (#82): solve() must fetch the costMatrix once and reuse it for both sequencing and
// the feasibility-violation pass — not once per phase (Seam 3, docs/optimizer-rebuild.md).
let costMatrixCalls = 0;
const countingProvider: TravelCostProvider = {
  async costMatrix(points, mode, opts) {
    costMatrixCalls++;
    return haversineProvider.costMatrix(points, mode, opts);
  },
  describeLeg: haversineProvider.describeLeg,
};
await solve({
  locations: [
    { id: "c1", lat: 35.0, lng: 139.0, visitDuration: 60 },
    { id: "c2", lat: 35.01, lng: 139.01, visitDuration: 60 },
  ],
  numDays: 1,
  dayBudgetMinutes: 8 * 60,
  provider: countingProvider,
});
assert.equal(costMatrixCalls, 1, "solve() fetches costMatrix exactly once per call");

// ── optimizeTrip orchestrator (over a temp DB) ────────────────────────────────

const dir = fs.mkdtempSync(path.join(tmpdir(), "tk-opt-"));
const sqlite = new Database(path.join(dir, "test.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
(globalThis as unknown as { _drizzle?: typeof db })._drizzle = db;

// 3-day trip; lodging H across all nights; three activities with coords; one excluded. Pinned to
// walking (ADR-0019 #86): this test is about placement/DB mechanics, not provider selection, and
// its Tokyo-area coordinates would otherwise resolve to the OSM-Japan transit provider by default
// (transit is the default primary mode) — which requires a real ingested `db/transit-japan.db`
// this test environment doesn't have.
const trip = createTripWithLocations({
  name: "Opt trip",
  sourceUrl: "",
  startDate: "2026-06-24",
  endDate: "2026-06-26",
  allowedModes: ["walking"],
  locations: [
    { name: "H", lat: 35.0, lng: 139.0 },
    { name: "X", lat: 35.01, lng: 139.01 },
    { name: "Y", lat: 35.5, lng: 139.5 },
    { name: "Z", lat: 35.9, lng: 139.9 },
  ],
});
const id = (n: string) => trip.locations.find((l) => l.name === n)!.id;
setLodgingDates(trip.id, id("H"), { checkInDate: "2026-06-24", checkOutDate: "2026-06-27" });
const W = createLocation(trip.id, { name: "W (excluded)", lat: 35.2, lng: 139.2 }).id;
updateLocation(trip.id, W, { excluded: true });

const after = await optimizeTrip(trip.id);
const placed = new Set(after.trip.placements.map((p) => p.locationId));
assert.ok(!placed.has(id("H")), "the lodging is an anchor, never placed");
assert.ok(!placed.has(W), "the excluded activity is not placed");
assert.deepEqual([...placed].sort(), [id("X"), id("Y"), id("Z")].sort(), "all three activities are placed");
assert.ok(Array.isArray(after.feasibilityViolations), "optimizeTrip surfaces a feasibilityViolations list (ADR-0017)");

// Placements sit on real trip dates and only on activities.
const tripDateSet = new Set(["2026-06-24", "2026-06-25", "2026-06-26"]);
for (const p of after.trip.placements) {
  assert.ok(tripDateSet.has(p.date), `placement date ${p.date} is within the trip`);
  assert.ok(isActivity(after.trip.locations.find((l) => l.id === p.locationId)!), "only activities are placed");
}

// Re-optimize is wholesale: the count stays put, not appended.
const again = await optimizeTrip(trip.id);
assert.equal(again.trip.placements.length, after.trip.placements.length, "re-optimize replaces, never appends");
assert.equal(getTripWithDetails(trip.id)!.placements.length, 3, "exactly the three activities remain placed");

fs.rmSync(dir, { recursive: true, force: true });
console.log("✓ optimizer.test.ts passed");

}
