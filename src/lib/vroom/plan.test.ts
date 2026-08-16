/**
 * Plan-mode diagnostic tests (ADR-0023 §8, #155). Standalone (no test runner): run with
 * `tsx src/lib/vroom/plan.test.ts`.
 *
 * The response fixtures below are shaped after real replies from the running container
 * (docker-compose.yml, VROOM v1.15.0) — including the two details that drove this module's design:
 * a Day's overrun arrives as `delay` on the **`end`** step, and `skills`/`max_tasks` arrive with a
 * bare `cause` and no `duration`.
 */

import assert from "node:assert/strict";
import { buildVroomPlanRequest, diagnosisReason, parseVroomViolations, planProbeRounds, type PlanProbe } from "./plan";
import type { VroomPlanSolution, VroomRequest, VroomSolution } from "./wire";

const request: VroomRequest = {
  jobs: [
    { id: 0, location_index: 0, service: 3600, skills: [0] },
    { id: 1, location_index: 1, service: 3600, skills: [0] },
    { id: 2, location_index: 2, service: 3600, skills: [1] }, // a different metro
  ],
  vehicles: [
    { id: 1, time_window: [0, 28800], max_tasks: 2, skills: [0], profile: "trip" },
    { id: 2, time_window: [86400, 115200], max_tasks: 2, skills: [0], profile: "trip" },
    { id: 3, time_window: [172800, 201600], max_tasks: 2, skills: [1], profile: "trip" },
  ],
  matrices: { trip: { durations: [[0, 600, 900], [600, 0, 700], [900, 700, 0]] } },
};

/** Day 1 carries two Placements (at its cap); Day 2 carries one; Day 3 returned no route at all. */
const solution: VroomSolution = {
  code: 0,
  routes: [
    { vehicle: 1, steps: [{ type: "start" }, { type: "job", id: 0 }, { type: "job", id: 1 }, { type: "end" }] },
    { vehicle: 2, steps: [{ type: "start" }, { type: "job", id: 1 }, { type: "end" }] },
  ],
  unassigned: [{ id: 2, type: "job" }],
};

// ── probe assignment: one Day per probe, and the Day is chosen to be informative ──
{
  const rounds = planProbeRounds(request, solution, [2]);
  assert.equal(rounds.length, 1, "one dropped Activity needs one round");
  assert.deepEqual(rounds[0], [{ jobId: 2, vehicleId: 3 }], "probes the Day whose skills serve its metro");
}

{
  // Three probes, three Days → still a single round: each Day takes at most one.
  const rounds = planProbeRounds(request, solution, [0, 1, 2]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].length, 3);
  const vehicles = rounds[0].map((p) => p.vehicleId);
  assert.equal(new Set(vehicles).size, 3, "no Day carries two probes in one round");
}

{
  // Day 1 is at max_tasks and Day 2 is not, so a skills-0 probe prefers Day 2's headroom —
  // otherwise every answer would come back `day-full` and bury the real conflict.
  const rounds = planProbeRounds(request, solution, [0]);
  assert.deepEqual(rounds[0], [{ jobId: 0, vehicleId: 2 }], "prefers a serving Day with room over one at its cap");
}

{
  // More dropped Activities than Days → a second round rather than doubling up on a Day.
  const twoDays: VroomRequest = { ...request, vehicles: request.vehicles.slice(0, 2) };
  const many = planProbeRounds(twoDays, solution, [0, 1, 2]);
  assert.equal(many.length, 2, "three Activities over two Days take two rounds");
  assert.equal(many[0].length, 2);
  assert.equal(many[1].length, 1);
  const probed = many.flat().map((p) => p.jobId).sort();
  assert.deepEqual(probed, [0, 1, 2], "every dropped Activity is probed exactly once, across rounds");
}

{
  assert.deepEqual(planProbeRounds(request, solution, []), [], "nothing dropped, nothing probed");
  assert.deepEqual(planProbeRounds(request, solution, [99]), [], "an unknown job id is not probed");
}

// ── request building: the probe rides last, only probed Days are sent, plan mode is on ──
{
  const round: PlanProbe[] = [{ jobId: 2, vehicleId: 1 }];
  const planRequest = buildVroomPlanRequest(request, solution, round);

  assert.equal(planRequest.options.c, true, "plan mode must be requested explicitly");
  assert.equal(planRequest.vehicles.length, 1, "only the probed Day is sent");
  assert.equal(planRequest.vehicles[0].id, 1);
  assert.deepEqual(
    planRequest.vehicles[0].steps,
    [{ type: "start" }, { type: "job", id: 0 }, { type: "job", id: 1 }, { type: "job", id: 2 }, { type: "end" }],
    "the Day's committed Placements keep their order and the probe is appended"
  );
  assert.equal(planRequest.vehicles[0].max_tasks, 2, "the Day's real constraints ride along unchanged");
  assert.deepEqual(planRequest.matrices, request.matrices);
}

{
  // A Day VROOM returned no route for is still probeable — it just has no Placements for context.
  const planRequest = buildVroomPlanRequest(request, solution, [{ jobId: 2, vehicleId: 3 }]);
  assert.deepEqual(planRequest.vehicles[0].steps, [{ type: "start" }, { type: "job", id: 2 }, { type: "end" }]);
}

// ── golden plan-mode response → domain findings ──
{
  // `delay` on the probe's own step: the Activity closes before we could get there.
  const planSolution: VroomPlanSolution = {
    code: 0,
    routes: [
      {
        vehicle: 1,
        steps: [
          { type: "start", violations: [] },
          { type: "job", id: 0, violations: [] },
          { type: "job", id: 2, violations: [{ duration: 1100, cause: "delay" }] },
          { type: "end", violations: [] },
        ],
      },
    ],
  };
  const found = parseVroomViolations(planSolution, [{ jobId: 2, vehicleId: 1 }]);
  assert.deepEqual(found.get(2), { cause: "after-closing", dayNumber: 1, seconds: 1100 });
}

{
  // `delay` on the `end` step is the Day running short of hours, not the Activity missing its own
  // — the distinction this module's one-probe-per-Day rule exists to keep attributable.
  const planSolution: VroomPlanSolution = {
    code: 0,
    routes: [
      {
        vehicle: 2,
        steps: [
          { type: "start", violations: [] },
          { type: "job", id: 1, violations: [] },
          { type: "job", id: 2, violations: [] },
          { type: "end", violations: [{ duration: 800, cause: "delay" }] },
        ],
      },
    ],
  };
  const found = parseVroomViolations(planSolution, [{ jobId: 2, vehicleId: 2 }]);
  assert.deepEqual(found.get(2), { cause: "day-too-short", dayNumber: 2, seconds: 800 });
}

{
  // The spill can land entirely on the `start` step — the route has to begin before the Day opens.
  // Taken from a real reply: reading only the `end` step returned no diagnosis at all here.
  const startSpill: VroomPlanSolution = {
    code: 0,
    routes: [
      {
        vehicle: 2,
        steps: [
          { type: "start", violations: [{ duration: 5948, cause: "lead_time" }] },
          { type: "job", id: 4, violations: [] },
          { type: "job", id: 2, violations: [] },
          { type: "end", violations: [] },
        ],
      },
    ],
  };
  assert.deepEqual(parseVroomViolations(startSpill, [{ jobId: 2, vehicleId: 2 }]).get(2), {
    cause: "day-too-short",
    dayNumber: 2,
    seconds: 5948,
  });
}

{
  // A packed Day spills at both ends at once; the shortfall is the sum, not whichever we read
  // first — that total is the hours the Day would actually have to grow by.
  const bothEnds: VroomPlanSolution = {
    code: 0,
    routes: [
      {
        vehicle: 1,
        steps: [
          { type: "start", violations: [{ duration: 1115, cause: "lead_time" }] },
          { type: "job", id: 2, violations: [] },
          { type: "end", violations: [{ duration: 11777, cause: "delay" }] },
        ],
      },
    ],
  };
  assert.deepEqual(parseVroomViolations(bothEnds, [{ jobId: 2, vehicleId: 1 }]).get(2), {
    cause: "day-too-short",
    dayNumber: 1,
    seconds: 12892,
  });
}

{
  // `skills` and `max_tasks` arrive with no duration — the finding must carry no `seconds` rather
  // than a fabricated zero.
  const skills: VroomPlanSolution = {
    code: 0,
    routes: [{ vehicle: 3, steps: [{ type: "start" }, { type: "job", id: 2, violations: [{ cause: "skills" }] }, { type: "end" }] }],
  };
  assert.deepEqual(parseVroomViolations(skills, [{ jobId: 2, vehicleId: 3 }]).get(2), {
    cause: "out-of-reach",
    dayNumber: 3,
  });

  const full: VroomPlanSolution = {
    code: 0,
    routes: [{ vehicle: 1, steps: [{ type: "start" }, { type: "job", id: 2, violations: [{ cause: "max_tasks" }] }, { type: "end" }] }],
  };
  assert.deepEqual(parseVroomViolations(full, [{ jobId: 2, vehicleId: 1 }]).get(2), { cause: "day-full", dayNumber: 1 });
}

{
  // The Activity's own conflict outranks the Day's: closing hours survive rearranging the Day.
  const both: VroomPlanSolution = {
    code: 0,
    routes: [
      {
        vehicle: 1,
        steps: [
          { type: "start", violations: [{ duration: 300, cause: "lead_time" }] },
          { type: "job", id: 2, violations: [{ duration: 600, cause: "delay" }] },
          { type: "end", violations: [{ duration: 900, cause: "delay" }] },
        ],
      },
    ],
  };
  assert.deepEqual(parseVroomViolations(both, [{ jobId: 2, vehicleId: 1 }]).get(2), {
    cause: "after-closing",
    dayNumber: 1,
    seconds: 600,
  });

  // `lead_time` on the Activity's own step is about the place, not the Day.
  const early: VroomPlanSolution = {
    code: 0,
    routes: [
      {
        vehicle: 1,
        steps: [
          { type: "start" },
          { type: "job", id: 2, violations: [{ duration: 1200, cause: "lead_time" }] },
          { type: "end" },
        ],
      },
    ],
  };
  assert.deepEqual(parseVroomViolations(early, [{ jobId: 2, vehicleId: 1 }]).get(2), {
    cause: "before-opening",
    dayNumber: 1,
    seconds: 1200,
  });
}

{
  // A clean probe diagnoses nothing rather than inventing a cause — and a cause we never provoke
  // (no capacity is ever sent) is left unmapped instead of guessed at.
  const clean: VroomPlanSolution = {
    code: 0,
    routes: [{ vehicle: 1, steps: [{ type: "start" }, { type: "job", id: 2, violations: [] }, { type: "end", violations: [] }] }],
  };
  assert.equal(parseVroomViolations(clean, [{ jobId: 2, vehicleId: 1 }]).size, 0);

  const unmapped: VroomPlanSolution = {
    code: 0,
    routes: [{ vehicle: 1, steps: [{ type: "start" }, { type: "job", id: 2, violations: [{ cause: "load" }] }, { type: "end" }] }],
  };
  assert.equal(parseVroomViolations(unmapped, [{ jobId: 2, vehicleId: 1 }]).size, 0);
}

{
  // A route for a Day this round never probed is ignored rather than misattributed.
  const stray: VroomPlanSolution = {
    code: 0,
    routes: [{ vehicle: 2, steps: [{ type: "start" }, { type: "job", id: 9, violations: [{ cause: "skills" }] }, { type: "end" }] }],
  };
  assert.equal(parseVroomViolations(stray, [{ jobId: 2, vehicleId: 1 }]).size, 0);
}

// ── the sentence a traveller reads ──
{
  assert.match(diagnosisReason({ cause: "after-closing", dayNumber: 3, seconds: 2400 }), /40 min after it closes on day 3/);
  assert.match(diagnosisReason({ cause: "before-opening", dayNumber: 3, seconds: 600 }), /10 min before it opens on day 3/);
  assert.match(diagnosisReason({ cause: "day-too-short", dayNumber: 2, seconds: 1800 }), /Day 2 would need 30 more min/);
  assert.match(diagnosisReason({ cause: "day-full", dayNumber: 1 }), /already full/);
  assert.match(diagnosisReason({ cause: "out-of-reach", dayNumber: 4 }), /near enough/);

  // Sub-minute lateness rounds up: "1 min late" is honest where "0 min late" would read as fine.
  assert.match(diagnosisReason({ cause: "after-closing", dayNumber: 1, seconds: 30 }), /1 min after it closes/);
  // No magnitude → a sentence that still reads, with no invented number in it.
  assert.match(diagnosisReason({ cause: "after-closing", dayNumber: 1 }), /before it closes on day 1/);
}

console.log("✓ plan.test.ts passed");
