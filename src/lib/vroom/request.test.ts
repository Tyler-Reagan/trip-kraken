/**
 * `buildVroomRequest` tests (ADR-0023 §1/§6/§9) — the highest-value file in this module: assert
 * the emitted request body directly, mirroring `osrmProvider.test.ts`'s defence against a silent
 * lat/lng swap. Standalone (no test runner): run with `tsx src/lib/vroom/request.test.ts`.
 */

import assert from "node:assert/strict";
import { buildVroomRequest } from "./request";
import { preflight } from "./preflight";
import { makeTravelCost } from "@/types/path";
import type { LocationInput, StayPlan } from "@/lib/solver";
import type { VroomRequest } from "./wire";

const loc = (fields: Partial<LocationInput> & { id: string }): LocationInput => ({ lat: 0, lng: 0, ...fields });

/** A dense fake matrix, cell (i,j) = 100 + i*10 + j seconds, with a fractional cell injected at
 * (0, n-1) to exercise integer rounding. */
function fakeMatrix(n: number) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const seconds = i === 0 && j === n - 1 ? 100.6 : 100 + i * 10 + j;
      return makeTravelCost(1000, seconds, "straightLine", "haversine");
    })
  );
}

function jobById(req: VroomRequest, id: number) {
  return req.jobs.find((j) => j.id === id)!;
}
function vehicleById(req: VroomRequest, id: number) {
  return req.vehicles.find((v) => v.id === id)!;
}

// ── max_tasks: slack 0, Math.ceil(placeable/numDays) ──
{
  const placeable = [loc({ id: "a1" }), loc({ id: "a2" }), loc({ id: "a3" })];
  const matrixPoints = placeable;
  const req = buildVroomRequest({
    placeable,
    stays: [],
    matrixPoints,
    matrix: fakeMatrix(3),
    tripDates: [],
    numDays: 2,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });
  assert.equal(req.vehicles.length, 2);
  for (const v of req.vehicles) assert.equal(v.max_tasks, Math.ceil(3 / 2), "max_tasks is ceil(placeable/days) with no cushion");
}

// ── Per-day start_index/end_index, differing on a travel day; same-lodging days omit end_index ──
{
  const a1 = loc({ id: "a1", lat: 35, lng: 139 });
  const la = loc({ id: "la", lat: 35.0, lng: 139.0 });
  const lb = loc({ id: "lb", lat: 35.0, lng: 140.0 });
  const matrixPoints = [a1, la, lb]; // placeable, then geocoded lodgings — solver.ts's own ordering
  const stays: StayPlan[] = [
    { lodgingId: "la", startNight: 1, endNight: 1 },
    { lodgingId: "lb", startNight: 2, endNight: 2 },
  ];
  const req = buildVroomRequest({
    placeable: [a1],
    stays,
    matrixPoints,
    matrix: fakeMatrix(3),
    tripDates: [],
    numDays: 2,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });

  const day1 = vehicleById(req, 1);
  const day2 = vehicleById(req, 2);
  assert.equal(day1.start_index, undefined, "day 1 has no prior-night lodging to wake at");
  assert.equal(day1.end_index, 1, "day 1 sleeps at la (matrix index 1)");
  assert.equal(day2.start_index, 1, "day 2 wakes at la — the travel day's start anchor");
  assert.equal(day2.end_index, 2, "day 2 sleeps at lb — differs from start_index on a travel day");
}

// ── A round-trip day (wake and sleep at the same lodging) omits end_index — no forced return ──
{
  const a1 = loc({ id: "a1" });
  const L = loc({ id: "L", lat: 35, lng: 139 });
  const matrixPoints = [a1, L];
  const stays: StayPlan[] = [{ lodgingId: "L", startNight: 1, endNight: 2 }];
  const req = buildVroomRequest({
    placeable: [a1],
    stays,
    matrixPoints,
    matrix: fakeMatrix(2),
    tripDates: [],
    numDays: 2,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });
  const day2 = vehicleById(req, 2);
  assert.equal(day2.start_index, 1, "day 2 wakes at L");
  assert.equal(day2.end_index, undefined, "day 2 sleeps at the same L — no forced return");
}

// ── Metro skills: jobs carry their metro ordinal, vehicles carry the union reachable from their
// Anchors, and a travel day's skills include both metros (ports the multi-lodging mask test). ──
{
  const activities = [
    loc({ id: "t1", lat: 35.68, lng: 139.66 }),
    loc({ id: "t2", lat: 35.67, lng: 139.64 }),
    loc({ id: "o1", lat: 34.7, lng: 135.51 }),
    loc({ id: "o2", lat: 34.69, lng: 135.5 }),
  ];
  const hotelTokyo = loc({ id: "hotelTokyo", lat: 35.6762, lng: 139.6503 });
  const hotelOsaka = loc({ id: "hotelOsaka", lat: 34.6937, lng: 135.5023 });
  const lodgings = [hotelTokyo, hotelOsaka];
  const { placeable, metroOf, lodgingMetros } = preflight(activities, lodgings, []);
  assert.equal(placeable.length, 4, "both metros are covered — nothing dropped in pre-flight");

  const tokyoOrd = metroOf.get("t1")!;
  const osakaOrd = metroOf.get("o1")!;
  assert.notEqual(tokyoOrd, osakaOrd);

  const matrixPoints = [...placeable, ...lodgings];
  const stays: StayPlan[] = [
    { lodgingId: "hotelTokyo", startNight: 1, endNight: 3 },
    { lodgingId: "hotelOsaka", startNight: 4, endNight: 6 },
  ];
  const req = buildVroomRequest({
    placeable,
    stays,
    matrixPoints,
    matrix: fakeMatrix(matrixPoints.length),
    tripDates: [],
    numDays: 6,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf,
    lodgingMetros,
  });

  assert.deepEqual(jobById(req, matrixPoints.findIndex((p) => p.id === "t1")).skills, [tokyoOrd]);
  assert.deepEqual(jobById(req, matrixPoints.findIndex((p) => p.id === "o1")).skills, [osakaOrd]);

  assert.deepEqual(vehicleById(req, 1).skills, [tokyoOrd], "day 1 (pure Tokyo) reaches only Tokyo");
  assert.deepEqual(vehicleById(req, 3).skills, [tokyoOrd], "day 3 (still Tokyo, wake=sleep) reaches only Tokyo");
  assert.deepEqual(
    [...vehicleById(req, 4).skills!].sort(),
    [tokyoOrd, osakaOrd].sort(),
    "day 4 (the travel day, wake Tokyo / sleep Osaka) reaches both"
  );
  assert.deepEqual(vehicleById(req, 6).skills, [osakaOrd], "day 6 (pure Osaka) reaches only Osaka");
}

// ── No metro clustering active (no geocoded lodging) → skills omitted everywhere ──
{
  const a1 = loc({ id: "a1", lat: 35, lng: 139 });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1],
    matrix: fakeMatrix(1),
    tripDates: [],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });
  assert.equal(jobById(req, 0).skills, undefined);
  assert.equal(vehicleById(req, 1).skills, undefined);
}

// ── service = visitDuration ?? 0, in seconds ──
{
  const a1 = loc({ id: "a1", visitDuration: 90 });
  const a2 = loc({ id: "a2" }); // no visitDuration
  const req = buildVroomRequest({
    placeable: [a1, a2],
    stays: [],
    matrixPoints: [a1, a2],
    matrix: fakeMatrix(2),
    tripDates: [],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });
  assert.equal(jobById(req, 0).service, 90 * 60, "visitDuration converts to seconds");
  assert.equal(jobById(req, 1).service, 0, "an unset visitDuration is 0 service, not the deleted DEFAULT_VISIT_MINS");
}

// ── The matrix profile key is "trip", matching every vehicle's profile, and durations are integers ──
{
  const a1 = loc({ id: "a1" });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1, a1], // 2x2, cell (0,1) is the fractional one fakeMatrix injects at (0, n-1)
    matrix: fakeMatrix(2),
    tripDates: [],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });
  assert.ok("trip" in req.matrices, 'the matrix is keyed "trip", not "car" — our matrix is not a claim about mode');
  assert.equal(vehicleById(req, 1).profile, "trip");
  assert.equal(req.matrices.trip.durations[0][1], 101, "100.6 seconds rounds to 101, an integer");
  assert.ok(Number.isInteger(req.matrices.trip.durations[0][0]));
}

// ── priority and costs.fixed are never emitted (§5/§6 scope decisions) ──
{
  const a1 = loc({ id: "a1" });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1],
    matrix: fakeMatrix(1),
    tripDates: [],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });
  assert.ok(!("priority" in req.jobs[0]));
  assert.ok(!("costs" in req.vehicles[0]));
}

console.log("✓ request.test.ts passed");
