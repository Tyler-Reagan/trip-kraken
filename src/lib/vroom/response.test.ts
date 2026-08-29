/**
 * `parseVroomSolution` tests. Standalone (no test runner): run with
 * `tsx src/lib/vroom/response.test.ts`.
 */

import assert from "node:assert/strict";
import { parseVroomSolution } from "./response";
import type { LocationInput } from "@/lib/solver";
import type { VroomSolution } from "./wire";

const loc = (id: string): LocationInput => ({
  id,
  lat: 0,
  lng: 0,
  kind: "activity",
});
const matrixPoints: LocationInput[] = [loc("a1"), loc("a2"), loc("lodge")];

// ── routes → days: job steps in order become locationIds; start/end steps are not Placements ──
{
  const solution: VroomSolution = {
    code: 0,
    routes: [
      {
        vehicle: 1,
        steps: [
          { type: "start", location_index: 2 },
          {
            type: "job",
            id: 0,
            location_index: 0,
            arrival: 1000,
            waiting_time: 0,
          },
          {
            type: "job",
            id: 1,
            location_index: 1,
            arrival: 1200,
            waiting_time: 30,
          },
          { type: "end", location_index: 2 },
        ],
      },
    ],
    unassigned: [],
  };
  const { days, unplaced } = parseVroomSolution(solution, matrixPoints);
  assert.equal(days.length, 1);
  assert.equal(days[0].dayNumber, 1, "route.vehicle becomes the Day number");
  assert.deepEqual(
    days[0].locationIds,
    ["a1", "a2"],
    "only job steps become Placements, in order",
  );
  assert.deepEqual(days[0].timing, [
    { arrival: 1000, waitingSeconds: 0 },
    { arrival: 1200, waitingSeconds: 30 },
  ]);
  assert.deepEqual(unplaced, []);
}

// ── unassigned[] → honest 'solver' Unplaced, no fabricated cause ──
{
  const solution: VroomSolution = {
    code: 0,
    routes: [],
    unassigned: [{ id: 0, type: "job" }],
  };
  const { unplaced } = parseVroomSolution(solution, matrixPoints);
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].locationId, "a1");
  assert.equal(unplaced[0].code, "solver");
  assert.equal(unplaced[0].reason, "Couldn't fit this into any day.");
}

// ── An empty route (no job steps) carries no timing array ──
{
  const solution: VroomSolution = {
    code: 0,
    routes: [{ vehicle: 2, steps: [{ type: "start" }, { type: "end" }] }],
    unassigned: [],
  };
  const { days } = parseVroomSolution(solution, matrixPoints);
  assert.deepEqual(days[0].locationIds, []);
  assert.equal(days[0].timing, undefined);
}

console.log("✓ response.test.ts passed");
