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

const loc = (
  fields: Partial<LocationInput> & { id: string },
): LocationInput => ({ lat: 0, lng: 0, kind: "activity", ...fields });

/** A dense fake matrix, cell (i,j) = 100 + i*10 + j seconds, with a fractional cell injected at
 * (0, n-1) to exercise integer rounding. */
function fakeMatrix(n: number) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const seconds = i === 0 && j === n - 1 ? 100.6 : 100 + i * 10 + j;
      return makeTravelCost(1000, seconds, "straightLine", "haversine");
    }),
  );
}

function jobById(req: VroomRequest, id: number) {
  return req.jobs.find((j) => j.id === id)!;
}
function vehicleById(req: VroomRequest, id: number) {
  return req.vehicles.find((v) => v.id === id)!;
}

// ── max_tasks is never sent (ADR-0023 §6, amended 2026-08-18): rung 1 is removed now that
//    real service durations make the Day's time_window load-bearing on its own ──
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
  for (const v of req.vehicles)
    assert.equal(v.max_tasks, undefined, "no per-day task cap is ever sent");
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
  assert.equal(
    day1.start_index,
    undefined,
    "day 1 has no prior-night lodging to wake at",
  );
  assert.equal(day1.end_index, 1, "day 1 sleeps at la (matrix index 1)");
  assert.equal(
    day2.start_index,
    1,
    "day 2 wakes at la — the travel day's start anchor",
  );
  assert.equal(
    day2.end_index,
    2,
    "day 2 sleeps at lb — differs from start_index on a travel day",
  );
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
  assert.equal(
    day2.end_index,
    undefined,
    "day 2 sleeps at the same L — no forced return",
  );
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
  const { placeable, metroOf, lodgingMetros } = preflight(
    activities,
    lodgings,
    [],
  );
  assert.equal(
    placeable.length,
    4,
    "both metros are covered — nothing dropped in pre-flight",
  );

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

  assert.deepEqual(
    jobById(
      req,
      matrixPoints.findIndex((p) => p.id === "t1"),
    ).skills,
    [tokyoOrd],
  );
  assert.deepEqual(
    jobById(
      req,
      matrixPoints.findIndex((p) => p.id === "o1"),
    ).skills,
    [osakaOrd],
  );

  assert.deepEqual(
    vehicleById(req, 1).skills,
    [tokyoOrd],
    "day 1 (pure Tokyo) reaches only Tokyo",
  );
  assert.deepEqual(
    vehicleById(req, 3).skills,
    [tokyoOrd],
    "day 3 (still Tokyo, wake=sleep) reaches only Tokyo",
  );
  assert.deepEqual(
    [...vehicleById(req, 4).skills!].sort(),
    [tokyoOrd, osakaOrd].sort(),
    "day 4 (the travel day, wake Tokyo / sleep Osaka) reaches both",
  );
  assert.deepEqual(
    vehicleById(req, 6).skills,
    [osakaOrd],
    "day 6 (pure Osaka) reaches only Osaka",
  );
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

// ── service = resolveVisitDuration(visitDuration), in seconds ──
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
  assert.equal(
    jobById(req, 0).service,
    90 * 60,
    "visitDuration converts to seconds",
  );
  assert.equal(
    jobById(req, 1).service,
    30 * 60,
    "an unset visitDuration resolves to DEFAULT_VISIT_MINUTES (ADR-0023 §9, amended 2026-08-18)",
  );
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
  assert.ok(
    "trip" in req.matrices,
    'the matrix is keyed "trip", not "car" — our matrix is not a claim about mode',
  );
  assert.equal(vehicleById(req, 1).profile, "trip");
  assert.equal(
    req.matrices.trip.durations[0][1],
    101,
    "100.6 seconds rounds to 101, an integer",
  );
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

// ── #156 acceptance criterion: a trip with an edge arrival emits a day 1 start_index that is not
// the day 1 lodging (ADR-0028) ──
{
  const a1 = loc({ id: "a1" });
  const hotel = loc({ id: "hotel", lat: 35, lng: 139 });
  const airport = loc({
    id: "airport",
    lat: 35.5,
    lng: 139.5,
    kind: "transit",
  });
  const matrixPoints = [a1, hotel, airport];
  const stays: StayPlan[] = [
    { lodgingId: "hotel", startNight: 1, endNight: 1 },
  ];
  const req = buildVroomRequest({
    placeable: [a1],
    stays,
    matrixPoints,
    matrix: fakeMatrix(3),
    tripDates: ["2026-06-01"],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
    edges: { arrivalId: "airport", arriveAt: "2026-06-01T14:00" },
  });
  const day1 = vehicleById(req, 1);
  const airportIndex = matrixPoints.findIndex((p) => p.id === "airport");
  const hotelIndex = matrixPoints.findIndex((p) => p.id === "hotel");
  assert.equal(
    day1.start_index,
    airportIndex,
    "day 1 starts at the designated arrival",
  );
  assert.notEqual(
    day1.start_index,
    hotelIndex,
    "not at the day 1 lodging — the issue's own acceptance criterion",
  );
}

// ── A dated-but-timeless edge still anchors the geography without constraining the clock ──
{
  const a1 = loc({ id: "a1" });
  const airport = loc({
    id: "airport",
    lat: 35.5,
    lng: 139.5,
    kind: "transit",
  });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1, airport],
    matrix: fakeMatrix(2),
    tripDates: ["2026-06-01"],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
    edges: { arrivalId: "airport", arriveAt: "2026-06-01" }, // bare date, no time known
  });
  const day1 = vehicleById(req, 1);
  const defaultOpen = Date.parse("2026-06-01T00:00:00Z") / 1000 + 9 * 3600;
  assert.equal(
    day1.start_index,
    1,
    "the edge still anchors the route with no time known",
  );
  assert.equal(
    day1.time_window![0],
    defaultOpen,
    "but a bare date does not move the window's open time",
  );
}

// ── A known arrival time makes day 1's window open later, honestly shorter rather than shifted
// (ADR-0028 §5) — the close time is untouched, so a 14:00 landing leaves only 3 hours, not a full
// budget starting late ──
{
  const a1 = loc({ id: "a1" });
  const airport = loc({
    id: "airport",
    lat: 35.5,
    lng: 139.5,
    kind: "transit",
  });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1, airport],
    matrix: fakeMatrix(2),
    tripDates: ["2026-06-01"],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480, // 8h — default window would be [09:00, 17:00]
    metroOf: new Map(),
    lodgingMetros: new Map(),
    edges: { arrivalId: "airport", arriveAt: "2026-06-01T14:00" },
  });
  const [opensAt, closesAt] = vehicleById(req, 1).time_window!;
  const dayStart = Date.parse("2026-06-01T00:00:00Z") / 1000;
  assert.equal(
    opensAt,
    dayStart + 14 * 3600,
    "opens at the arrival time, not the default 09:00",
  );
  assert.equal(
    closesAt,
    dayStart + 17 * 3600,
    "closes at the untouched default — the day got shorter, not later",
  );
}

// ── A known departure time makes the last day's window close earlier, symmetric to arrival ──
{
  const a1 = loc({ id: "a1" });
  const airport = loc({
    id: "airport",
    lat: 35.5,
    lng: 139.5,
    kind: "transit",
  });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1, airport],
    matrix: fakeMatrix(2),
    tripDates: ["2026-06-01"],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
    edges: { departureId: "airport", departAt: "2026-06-01T11:30" },
  });
  const [opensAt, closesAt] = vehicleById(req, 1).time_window!;
  const dayStart = Date.parse("2026-06-01T00:00:00Z") / 1000;
  assert.equal(
    opensAt,
    dayStart + 9 * 3600,
    "the open time is untouched by a departure constraint",
  );
  assert.equal(
    closesAt,
    dayStart + 11.5 * 3600,
    "closes at the departure — must reach the airport by then",
  );
}

// ── A very late arrival that would fall after the default close clamps rather than emits a
// backwards window (the same defence dayWindowsFor applies to overnight opening hours) ──
{
  const a1 = loc({ id: "a1" });
  const airport = loc({
    id: "airport",
    lat: 35.5,
    lng: 139.5,
    kind: "transit",
  });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1, airport],
    matrix: fakeMatrix(2),
    tripDates: ["2026-06-01"],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480, // default close would be 17:00
    metroOf: new Map(),
    lodgingMetros: new Map(),
    edges: { arrivalId: "airport", arriveAt: "2026-06-01T22:00" },
  });
  const [opensAt, closesAt] = vehicleById(req, 1).time_window!;
  assert.ok(opensAt <= closesAt, "the window is never backwards");
  assert.equal(
    opensAt,
    closesAt,
    "a 22:00 landing past the default close clamps to a zero-length window, not negative",
  );
}

// ── No edges at all: today's behaviour is bit-for-bit unchanged ──
{
  const a1 = loc({ id: "a1" });
  const req = buildVroomRequest({
    placeable: [a1],
    stays: [],
    matrixPoints: [a1],
    matrix: fakeMatrix(1),
    tripDates: ["2026-06-01"],
    numDays: 1,
    dayStartMins: 9 * 60,
    dayBudgetMinutes: 480,
    metroOf: new Map(),
    lodgingMetros: new Map(),
  });
  const day1 = vehicleById(req, 1);
  const dayStart = Date.parse("2026-06-01T00:00:00Z") / 1000;
  assert.equal(day1.start_index, undefined);
  assert.deepEqual(day1.time_window, [
    dayStart + 9 * 3600,
    dayStart + 9 * 3600 + 480 * 60,
  ]);
}

console.log("✓ request.test.ts passed");
