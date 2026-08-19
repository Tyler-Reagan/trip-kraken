/**
 * visitDuration tests. Standalone: run with `tsx src/lib/visitDuration.test.ts`.
 */

import assert from "node:assert/strict";
import {
  DEFAULT_VISIT_MINUTES,
  VISIT_DURATION_LADDER,
  VISIT_DURATION_MAX_MINUTES,
  VISIT_DURATION_OPTIONS,
  VISIT_DURATION_STEP_MINUTES,
  clampVisitDuration,
  formatDuration,
  nearestVisitDurationIndex,
  nextVisitDuration,
  resolveVisitDuration,
} from "./visitDuration";

// ── resolve: null means "the user hasn't said", never a stored zero ──
assert.equal(resolveVisitDuration(null), DEFAULT_VISIT_MINUTES, "null resolves to the default");
assert.equal(resolveVisitDuration(undefined), DEFAULT_VISIT_MINUTES, "undefined resolves to the default");
assert.equal(resolveVisitDuration(90), 90, "an explicit value passes through");

// ── format ──
assert.equal(formatDuration(15), "15m");
assert.equal(formatDuration(60), "1h");
assert.equal(formatDuration(90), "1h 30m");
assert.equal(formatDuration(720), "12h");

// ── clamp ──
assert.equal(clampVisitDuration(0), VISIT_DURATION_STEP_MINUTES, "clamps up to the floor");
assert.equal(clampVisitDuration(-99), VISIT_DURATION_STEP_MINUTES, "negatives clamp to the floor");
assert.equal(clampVisitDuration(9999), VISIT_DURATION_MAX_MINUTES, "clamps down to the ceiling");
assert.equal(clampVisitDuration(45), 45, "an in-range value is untouched");

// ── the ladder: step grows with the value ──
assert.equal(nextVisitDuration(30, 1), 45, "below 1h steps by 15");
assert.equal(nextVisitDuration(45, 1), 60, "below 1h steps by 15 up to the boundary");
assert.equal(nextVisitDuration(60, 1), 90, "at 1h steps by 30");
assert.equal(nextVisitDuration(90, 1), 120, "below 2h steps by 30");
assert.equal(nextVisitDuration(120, 1), 180, "at 2h steps by 60");

// The headline claim: the 30m default reaches a 3h visit in 5 clicks, not 10.
{
  let mins = DEFAULT_VISIT_MINUTES;
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) { mins = nextVisitDuration(mins, 1); seen.push(mins); }
  assert.deepEqual(seen, [45, 60, 90, 120, 180], "the ladder from 30m to 3h");
  assert.equal(mins, 180, "30m reaches 3h in exactly 5 steps");
}

// Reversibility — the reason the ladder is a sequence of stops rather than a step added to the
// current value. Every + is undone by a −, so a user who overshoots can always get back.
for (const start of VISIT_DURATION_LADDER) {
  const up = nextVisitDuration(start, 1);
  if (up === start) continue; // at the ceiling
  assert.equal(nextVisitDuration(up, -1), start, `stepping up from ${start} then down returns to ${start}`);
  const down = nextVisitDuration(start, -1);
  if (down === start) continue; // at the floor
  assert.equal(nextVisitDuration(down, 1), start, `stepping down from ${start} then up returns to ${start}`);
}

// An off-ladder value (the roller offers every 15 minutes; the ladder doesn't stop at all of them)
// snaps onto the ladder rather than drifting further off it — the bug the sequence form fixes.
assert.equal(nextVisitDuration(105, 1), 120, "105m steps up to the next ladder stop, not 105+30");
assert.equal(nextVisitDuration(105, -1), 90, "105m steps down to the previous ladder stop");
assert.ok(VISIT_DURATION_LADDER.includes(nextVisitDuration(105, 1)), "stepping always lands on the ladder");

// A stored value above the ceiling (the API allows up to 1440) is pulled into range by either button
// rather than being stepped further out.
assert.equal(nextVisitDuration(900, 1), VISIT_DURATION_MAX_MINUTES, "above the ceiling, + clamps down");
assert.equal(nextVisitDuration(900, -1), VISIT_DURATION_MAX_MINUTES, "above the ceiling, − lands on the ceiling");

assert.equal(nextVisitDuration(VISIT_DURATION_STEP_MINUTES, -1), VISIT_DURATION_STEP_MINUTES, "the floor holds");
assert.equal(nextVisitDuration(VISIT_DURATION_MAX_MINUTES, 1), VISIT_DURATION_MAX_MINUTES, "the ceiling holds");

// ── roller options ──
assert.equal(VISIT_DURATION_OPTIONS[0], VISIT_DURATION_STEP_MINUTES, "the list starts at the floor");
assert.equal(VISIT_DURATION_OPTIONS.at(-1), VISIT_DURATION_MAX_MINUTES, "the list ends at the ceiling");
assert.ok(
  VISIT_DURATION_OPTIONS.every((m) => m % VISIT_DURATION_STEP_MINUTES === 0),
  "every option sits on the step grid",
);
assert.ok(!VISIT_DURATION_OPTIONS.includes(0), "zero is not representable — an invalid duration has no row");

// ── nearest index: a stored value off the grid still opens the picker somewhere sensible ──
assert.equal(nearestVisitDurationIndex(15), 0, "the floor is the first row");
assert.equal(nearestVisitDurationIndex(30), 1, "the default is the second row");
assert.equal(nearestVisitDurationIndex(180), 11, "3h is the twelfth row");
assert.equal(VISIT_DURATION_OPTIONS[nearestVisitDurationIndex(20)], 15, "20m (off-grid, API-reachable) snaps to 15m");
assert.equal(VISIT_DURATION_OPTIONS[nearestVisitDurationIndex(38)], 45, "38m snaps to the nearer 45m");
assert.equal(VISIT_DURATION_OPTIONS[nearestVisitDurationIndex(1440)], VISIT_DURATION_MAX_MINUTES,
  "a value above the ceiling (the API allows up to 1440) clamps to the last row rather than the first");
assert.equal(nearestVisitDurationIndex(0), 0, "zero clamps to the first row, never a negative index");

console.log("✓ visitDuration.test.ts passed");
