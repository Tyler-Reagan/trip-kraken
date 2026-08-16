/**
 * `diagnoseUnplaced` tests — #155's "optional and failure-tolerant" criterion, which is the one
 * property of this pass that cannot be checked by a pure test over a golden response. Mocks
 * global.fetch; no live VROOM container. Standalone (no test runner): run with
 * `tsx src/lib/vroom/diagnose.test.ts`.
 *
 * The claim under test is narrow and load-bearing: a diagnostic that fails, for any reason, must
 * hand back exactly the `Unplaced[]` it was given. A solve that already succeeded is never allowed
 * to degrade because the second call didn't land.
 */

import assert from "node:assert/strict";
import { diagnoseUnplaced } from "./diagnose";
import type { LocationInput, Unplaced } from "@/lib/solver";
import type { VroomRequest, VroomSolution } from "./wire";

const realFetch = global.fetch;
process.env.VROOM_URL = "http://vroom.test";

const matrixPoints: LocationInput[] = [
  { id: "a1", lat: 0, lng: 0, kind: "activity" },
  { id: "a2", lat: 0, lng: 0, kind: "activity" },
  { id: "lodge", lat: 0, lng: 0, kind: "lodging" },
];

const request: VroomRequest = {
  jobs: [
    { id: 0, location_index: 0, service: 3600 },
    { id: 1, location_index: 1, service: 3600 },
  ],
  vehicles: [{ id: 1, start_index: 2, time_window: [0, 28800], max_tasks: 2, profile: "trip" }],
  matrices: { trip: { durations: [[0, 600, 900], [600, 0, 700], [900, 700, 0]] } },
};

const solution: VroomSolution = {
  code: 0,
  routes: [{ vehicle: 1, steps: [{ type: "start" }, { type: "job", id: 0 }, { type: "end" }] }],
  unassigned: [{ id: 1, type: "job" }],
};

const unplaced: Unplaced[] = [
  { locationId: "a2", code: "solver", reason: "Couldn't fit this into any day." },
  { locationId: "a1", code: "no-lodging-coverage", reason: "No lodging covers this area of the trip." },
];

async function main() {
  // ── the diagnostic succeeds: the solver entry gains a cause, the pre-flight entry is untouched ──
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      routes: [
        {
          vehicle: 1,
          steps: [
            { type: "start", violations: [] },
            { type: "job", id: 0, violations: [] },
            { type: "job", id: 1, violations: [] },
            { type: "end", violations: [{ duration: 1800, cause: "delay" }] },
          ],
        },
      ],
    }),
  })) as unknown as typeof fetch;
  {
    const out = await diagnoseUnplaced(request, solution, unplaced, matrixPoints);
    assert.deepEqual(out[0].diagnosis, { cause: "day-too-short", dayNumber: 1, seconds: 1800 });
    assert.match(out[0].reason, /Day 1 would need 30 more min/);
    assert.deepEqual(out[1], unplaced[1], "a pre-flight reason already knows why — never probed, never rewritten");
  }

  // ── every failure mode returns the input unchanged ──
  const failures: Array<[string, typeof fetch]> = [
    ["transport error", (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch],
    ["HTTP 500", (async () => ({ ok: false, status: 500, text: async () => "boom" })) as unknown as typeof fetch],
    // The glpk-less build (ADR-0023's 2026-08-07 amendment): VROOM answers, and refuses plan mode.
    ["VROOM error code", (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 2, error: "VROOM compiled without libglpk installed.", routes: [] }),
    })) as unknown as typeof fetch],
    ["malformed body", (async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } })) as unknown as typeof fetch],
  ];
  for (const [label, stub] of failures) {
    global.fetch = stub;
    const out = await diagnoseUnplaced(request, solution, unplaced, matrixPoints);
    assert.deepEqual(out, unplaced, `${label}: the Unplaced list survives untouched`);
    assert.equal(out.every((u) => u.diagnosis === undefined), true, `${label}: no fabricated diagnosis`);
  }

  // ── an unconfigured machine skips the pass rather than throwing ──
  {
    const saved = process.env.VROOM_URL;
    delete process.env.VROOM_URL;
    global.fetch = (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch;
    assert.deepEqual(await diagnoseUnplaced(request, solution, unplaced, matrixPoints), unplaced);
    process.env.VROOM_URL = saved;
  }

  // ── nothing the solver dropped → no call at all ──
  {
    let called = false;
    global.fetch = (async () => { called = true; throw new Error("unreachable"); }) as unknown as typeof fetch;
    const preflightOnly = [unplaced[1]];
    assert.deepEqual(await diagnoseUnplaced(request, solution, preflightOnly, matrixPoints), preflightOnly);
    assert.equal(called, false, "a Trip with nothing solver-dropped never pays for the second call");
  }

  global.fetch = realFetch;
  console.log("✓ diagnose.test.ts passed");
}

main().catch((err) => {
  global.fetch = realFetch;
  console.error(err);
  process.exit(1);
});
