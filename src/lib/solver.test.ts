/**
 * `solve()`/`optimizeTrip()` tests (ADR-0023) — replaces `optimizer.test.ts`. Two layers:
 *  - `solve()` against a mocked VROOM (`global.fetch`), asserting the pipeline wiring: pre-flight
 *    exclusions never reach the request, the matrix is fetched exactly once per run (#82's
 *    invariant, now structural rather than a shared-fetch trick), and an unconfigured/unreachable
 *    VROOM fails loudly rather than silently producing a straight-line plan.
 *  - `optimizeTrip` end-to-end over a temp DB — lodging dates → night anchoring, excluded
 *    activities never placed, the plan emitted as date-bucketed Placements, re-optimize replaces.
 * Standalone (no test runner): run with `tsx src/lib/solver.test.ts`.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/lib/db/schema";
import { solve } from "@/lib/solver";
import { optimizeTrip } from "@/lib/optimize";
import { createTripWithLocations, createLocation, setLodgingDates, setTripArrival, updateLocation, getTripWithDetails } from "@/lib/db";
import { isActivity } from "@/types";
import type { VroomRequest, VroomSolution, VroomStep } from "@/lib/vroom/wire";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const originals = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Round-robins every job onto the vehicles present in the captured request — a plausible, fully
 * general fake solver for tests that only care about *which* Activities got placed, not the exact
 * per-day arrangement (VROOM's own arrangement logic is exercised by `request.test.ts` instead). */
function fakeVroomSolve(body: VroomRequest): VroomSolution {
  const routes = body.vehicles.map((v) => ({ vehicle: v.id, steps: [{ type: "start" }, { type: "end" }] as VroomStep[] }));
  body.jobs.forEach((job, i) => {
    const route = routes[i % routes.length];
    route.steps.splice(route.steps.length - 1, 0, { type: "job", id: job.id, location_index: job.location_index, arrival: 0, waiting_time: 0 });
  });
  return { code: 0, routes, unassigned: [] };
}

function mockFetch(handlers: { vroom?: (body: VroomRequest) => VroomSolution; osrmTable?: () => unknown }, calls: { vroom: number; osrm: number }) {
  global.fetch = (async (url: string, init?: RequestInit) => {
    if (url === process.env.VROOM_URL) {
      calls.vroom++;
      const body = JSON.parse(init!.body as string) as VroomRequest;
      const solution = handlers.vroom ? handlers.vroom(body) : fakeVroomSolve(body);
      return { ok: true, status: 200, json: async () => solution } as Response;
    }
    if (url.includes("/table/")) {
      calls.osrm++;
      return { ok: true, status: 200, json: async () => handlers.osrmTable!() } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

async function main() {

// ── Empty locations → empty plan, no network at all ──
{
  const calls = { vroom: 0, osrm: 0 };
  mockFetch({}, calls);
  const itinerary = await solve({ locations: [], numDays: 3 });
  assert.deepEqual(itinerary, { days: [], unplaced: [], warnings: [] });
  assert.equal(calls.vroom, 0, "no VROOM call for an empty run");
}

// ── VROOM_URL unset → loud failure, not a silent straight-line plan (ADR-0023 Consequences) ──
await withEnv({ VROOM_URL: undefined }, async () => {
  await assert.rejects(
    () => solve({ locations: [{ id: "a", lat: 35, lng: 139, kind: "activity" }], numDays: 1 }),
    /VROOM_URL is not set/
  );
});

// ── VROOM unreachable (HTTP error) also fails loudly ──
await withEnv({ VROOM_URL: "http://localhost:8080" }, async () => {
  global.fetch = (async () => ({ ok: false, status: 503, text: async () => "down" }) as Response) as typeof fetch;
  await assert.rejects(
    () => solve({ locations: [{ id: "a", lat: 35, lng: 139, kind: "activity" }], numDays: 1 }),
    /vroomClient: HTTP 503/
  );
});

// ── Happy path: two placeable Activities round-trip through the mocked VROOM ──
await withEnv({ VROOM_URL: "http://localhost:8080" }, async () => {
  const calls = { vroom: 0, osrm: 0 };
  mockFetch({}, calls);
  const itinerary = await solve({
    locations: [
      { id: "a1", lat: 35.0, lng: 139.0, kind: "activity" },
      { id: "a2", lat: 35.01, lng: 139.01, kind: "activity" },
    ],
    numDays: 1,
  });
  assert.equal(calls.vroom, 1, "exactly one VROOM call for the whole run");
  assert.equal(itinerary.days.length, 1);
  assert.deepEqual(itinerary.days[0].locationIds.slice().sort(), ["a1", "a2"]);
  assert.deepEqual(itinerary.unplaced, []);
  assert.deepEqual(itinerary.warnings, []);
});

// ── Pre-flight exclusions never reach the VROOM request, and surface as Unplaced ──
await withEnv({ VROOM_URL: "http://localhost:8080" }, async () => {
  const calls = { vroom: 0, osrm: 0 };
  let capturedJobCount = -1;
  mockFetch(
    {
      vroom: (body) => {
        capturedJobCount = body.jobs.length;
        return fakeVroomSolve(body);
      },
    },
    calls
  );
  const itinerary = await solve({
    locations: [
      { id: "placeable", lat: 35.0, lng: 139.0, kind: "activity" },
      { id: "pending", lat: 0, lng: 0, kind: "activity", enrichmentStatus: "pending" },
    ],
    numDays: 1,
  });
  assert.equal(capturedJobCount, 1, "the ungeocoded Activity never became a job");
  assert.deepEqual(itinerary.unplaced.map((u) => u.locationId), ["pending"]);
  assert.equal(itinerary.unplaced[0].code, "ungeocoded-pending");
});

// ── The matrix is fetched exactly once per run (#82's invariant) — observed via a real OSRM call ──
await withEnv(
  { VROOM_URL: "http://localhost:8080", OSRM_FOOT_URL: "http://localhost:5002", OSRM_CAR_URL: "http://localhost:5010" },
  async () => {
    const calls = { vroom: 0, osrm: 0 };
    mockFetch(
      {
        osrmTable: () => ({
          code: "Ok",
          durations: [
            [0, 100],
            [100, 0],
          ],
          distances: [
            [0, 1000],
            [1000, 0],
          ],
          sources: [{ location: [139.0, 35.0], distance: 0.5 }, { location: [139.01, 35.01], distance: 0.5 }],
          destinations: [{ location: [139.0, 35.0], distance: 0.5 }, { location: [139.01, 35.01], distance: 0.5 }],
        }),
      },
      calls
    );
    await solve({
      locations: [
        { id: "a1", lat: 35.0, lng: 139.0, kind: "activity" },
        { id: "a2", lat: 35.01, lng: 139.01, kind: "activity" },
      ],
      numDays: 1,
      kinds: ["walking"],
    });
    assert.equal(calls.osrm, 1, "the travel matrix is fetched exactly once per solve() call");
    assert.equal(calls.vroom, 1);
  }
);

// ── optimizeTrip orchestrator (over a temp DB) ────────────────────────────────

const dir = fs.mkdtempSync(path.join(tmpdir(), "tk-opt-"));
const sqlite = new Database(path.join(dir, "test.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
(globalThis as unknown as { _drizzle?: typeof db })._drizzle = db;

await withEnv({ VROOM_URL: "http://localhost:8080", OSRM_FOOT_URL: undefined, OSRM_CAR_URL: undefined }, async () => {
  const calls = { vroom: 0, osrm: 0 };
  mockFetch({}, calls); // no OSRM configured — falls to the haversine terminal, no OSRM fetch

  // 3-day trip; lodging H across all nights; three activities with coords, close enough to
  // single-link into one metro cluster H covers; one excluded.
  const trip = createTripWithLocations({
    name: "Opt trip",
    sourceUrl: "",
    startDate: "2026-06-24",
    endDate: "2026-06-26",
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
  assert.ok(!placed.has(id("H")), "the lodging is an Anchor, never placed");
  assert.ok(!placed.has(W), "the excluded activity is not placed");
  assert.deepEqual([...placed].sort(), [id("X"), id("Y"), id("Z")].sort(), "all three activities are placed");

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
});

// ── A trip-edge Transit Location is an Anchor, never a Placement (ADR-0028 §4) — the #156
// acceptance criterion at the optimizeTrip layer, not just request.test.ts's unit level ──
await withEnv({ VROOM_URL: "http://localhost:8080", OSRM_FOOT_URL: undefined, OSRM_CAR_URL: undefined }, async () => {
  const calls = { vroom: 0, osrm: 0 };
  let capturedJobCount = -1;
  mockFetch(
    { vroom: (body) => { capturedJobCount = body.jobs.length; return fakeVroomSolve(body); } },
    calls
  );

  const trip = createTripWithLocations({
    name: "Edge trip",
    sourceUrl: "",
    startDate: "2026-06-24",
    endDate: "2026-06-26",
    locations: [
      { name: "H", lat: 35.0, lng: 139.0 },
      { name: "Airport", lat: 35.6, lng: 140.4 },
      { name: "X", lat: 35.01, lng: 139.01 },
    ],
  });
  const id = (n: string) => trip.locations.find((l) => l.name === n)!.id;
  setLodgingDates(trip.id, id("H"), { checkInDate: "2026-06-24", checkOutDate: "2026-06-27" });
  setTripArrival(trip.id, id("Airport"), "14:00");

  const after = await optimizeTrip(trip.id);
  const placed = new Set(after.trip.placements.map((p) => p.locationId));
  assert.ok(!placed.has(id("Airport")), "the arrival is an Anchor, never a Placement");
  assert.equal(capturedJobCount, 1, "only the real Activity became a VROOM job — the airport never did");
});

fs.rmSync(dir, { recursive: true, force: true });

console.log("✓ solver.test.ts passed");
}
