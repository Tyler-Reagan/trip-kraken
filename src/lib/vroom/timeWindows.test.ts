/**
 * `dayWindowsFor` tests (ADR-0023 §3). Standalone (no test runner): run with
 * `tsx src/lib/vroom/timeWindows.test.ts`. Expected epoch values are computed independently via
 * `Date.parse`/`Date.UTC`, not by calling the function under test.
 */

import assert from "node:assert/strict";
import { dayWindowsFor } from "./timeWindows";
import type { LocationInput } from "@/lib/solver";

const loc = (fields: Partial<LocationInput>): LocationInput => ({ id: "l1", lat: 35, lng: 139, kind: "activity", ...fields });

const dayStart = (date: string): number => Date.parse(date + "T00:00:00Z") / 1000;
const SEC_PER_DAY = 86400;

// 2026-06-01 is a Monday (weekday 1); 2026-06-02 is a Tuesday (weekday 2).
const MON = "2026-06-01";
const TUE = "2026-06-02";
const WED = "2026-06-03";

// ── Rule 5: no hours data at all → unconstrained (null) ──
{
  const windows = dayWindowsFor(loc({}), [MON, TUE]);
  assert.equal(windows, null, "no hoursJson and no openTime/closeTime → null, not []");
}

// ── No Trip dates to evaluate → unconstrained (null), not a false "closed every day" ──
{
  const windows = dayWindowsFor(loc({ openTime: "09:00", closeTime: "18:00" }), []);
  assert.equal(windows, null, "empty tripDates → null");
}

// ── Rule 1: absent weekday key → closed that day, no window emitted ──
{
  // hoursJson only has Monday; Tuesday is absent → closed, not "open all day" or an error.
  const windows = dayWindowsFor(loc({ hoursJson: { "1": { open: "09:00", close: "17:00" } } }), [MON, TUE]);
  assert.equal(windows!.length, 1, "only the Monday window is emitted");
  assert.deepEqual(windows![0], [dayStart(MON) + 9 * 3600, dayStart(MON) + 17 * 3600]);
}

// ── hoursJson present but yields no window on any requested date → [] (closed every day), ──
// ── distinguishable from the "no data at all" null case above ──
{
  const windows = dayWindowsFor(loc({ hoursJson: { "3": { open: "09:00", close: "17:00" } } }), [MON, TUE]); // Wed only, not requested
  assert.deepEqual(windows, [], "hours exist but never fall on a requested date → [], not null");
}

// ── Rule 2: close === null → open to day end ──
{
  const windows = dayWindowsFor(loc({ hoursJson: { "1": { open: "10:00", close: null } } }), [MON]);
  assert.deepEqual(windows, [[dayStart(MON) + 10 * 3600, dayStart(MON) + SEC_PER_DAY]]);
}

// ── Rule 3: close <= open clamps to day end (extractWeeklyHours flattens an overnight period) ──
{
  // 18:00 → 02:00 (an overnight period) stored as open=18:00, close=02:00 — backwards as a same-day
  // window, which VROOM would reject as an input error. Clamp to day end instead.
  const windows = dayWindowsFor(loc({ hoursJson: { "1": { open: "18:00", close: "02:00" } } }), [MON]);
  assert.deepEqual(windows, [[dayStart(MON) + 18 * 3600, dayStart(MON) + SEC_PER_DAY]]);
}

// ── Rule 4: no hoursJson but openTime/closeTime → applied to every requested date ──
{
  const windows = dayWindowsFor(loc({ openTime: "08:00", closeTime: "20:00" }), [MON, TUE, WED]);
  assert.equal(windows!.length, 3, "openTime/closeTime applies to every date, not just one");
  assert.deepEqual(windows![1], [dayStart(TUE) + 8 * 3600, dayStart(TUE) + 20 * 3600]);
}

// ── hoursJson takes priority over openTime/closeTime when both are present ──
{
  const windows = dayWindowsFor(
    loc({ hoursJson: { "1": { open: "09:00", close: "17:00" } }, openTime: "00:00", closeTime: "23:59" }),
    [MON]
  );
  assert.deepEqual(windows, [[dayStart(MON) + 9 * 3600, dayStart(MON) + 17 * 3600]], "hoursJson wins over openTime/closeTime");
}

console.log("✓ timeWindows.test.ts passed");
