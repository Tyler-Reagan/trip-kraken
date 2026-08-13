/**
 * ADR-0023 §3 — the reason `hoursJson` finally becomes readable. The old objective.ts could
 * express one flat `openTime`/`closeTime` and nothing about which weekdays; a job's admissible
 * windows are the cross-product of the Trip's dates with the weekday hours already stored on the
 * Location, so a Tuesday-closed museum on a ten-day trip gets nine windows, none on a Tuesday.
 *
 * Pure domain module — no VROOM vocabulary here. `request.ts` is the only caller, and it assigns
 * this output to `job.time_windows` at the point our language crosses into the wire format.
 */

import type { IsoDate } from "@/types";
import type { LocationInput } from "@/lib/solver";

/** `[start, end)` in absolute Unix seconds, taken from each Trip date's own UTC midnight — the
 * same fiction `addDaysIso` already relies on (trip-local wall clock standing in for real
 * timezone-aware time), honest because no epoch value reaches a user. */
export type AbsoluteWindow = [number, number];

const SECONDS_PER_DAY = 86400;

function dayStartSeconds(date: IsoDate): number {
  return Date.parse(date + "T00:00:00Z") / 1000;
}

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes-since-midnight `[open, close|null]` for one date, or `null` if closed that day.
 * `hoursJson` (per-weekday) takes priority when present; `openTime`/`closeTime` is the fallback,
 * applied identically to every date. */
function ruleFor(loc: LocationInput, date: IsoDate): [number, number | null] | null {
  if (loc.hoursJson) {
    // hoursJson's keys are stringified weekday numbers, Sunday = 0 (places.ts's extractWeeklyHours)
    // — the same numbering getUTCDay() returns, so no offset is needed.
    const weekday = new Date(date + "T00:00:00Z").getUTCDay();
    const entry = loc.hoursJson[String(weekday)];
    if (!entry) return null; // absent weekday key → closed that day, emit no window
    return [timeToMins(entry.open), entry.close == null ? null : timeToMins(entry.close)];
  }
  if (loc.openTime != null) {
    return [timeToMins(loc.openTime), loc.closeTime == null ? null : timeToMins(loc.closeTime)];
  }
  return null;
}

/**
 * Absolute-second admissible windows for `loc` across `tripDates` (ADR-0023 §3's five rules, in
 * order):
 *   1. absent weekday key → emit no window for that day (closed)
 *   2. `close === null` → open to day end
 *   3. `close <= open` → clamp to day end — `extractWeeklyHours` flattens an overnight period
 *      (18:00→02:00) into a backwards window VROOM rejects as an input error
 *   4. no `hoursJson` but `openTime`/`closeTime` → apply that pair to every day
 *   5. neither → unconstrained
 *
 * Returns:
 * - `null` when there is nothing to constrain on — no hours data at all, or no Trip dates to
 *   evaluate against (a caller that hasn't resolved a start date yet, e.g. some direct/test
 *   callers of `solve()`). The request builder omits `time_windows` entirely for `null`, which is
 *   different from an empty array — VROOM would read `time_windows: []` as "never open".
 * - `[]` when hours data exists but yields no window on any Trip date — closed every day.
 *   `preflight.ts` turns this into the `closed-all-days` Unplaced reason before a job is ever built.
 * - Otherwise one window per open Trip date.
 */
export function dayWindowsFor(loc: LocationInput, tripDates: IsoDate[]): AbsoluteWindow[] | null {
  if (tripDates.length === 0) return null;
  if (!loc.hoursJson && loc.openTime == null && loc.closeTime == null) return null;

  const windows: AbsoluteWindow[] = [];
  for (const date of tripDates) {
    const rule = ruleFor(loc, date);
    if (!rule) continue;
    const [openMins, closeMins] = rule;
    const dayStart = dayStartSeconds(date);
    const open = dayStart + openMins * 60;
    const close = closeMins == null || closeMins <= openMins ? dayStart + SECONDS_PER_DAY : dayStart + closeMins * 60;
    windows.push([open, close]);
  }
  return windows;
}
