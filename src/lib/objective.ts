/**
 * The optimization objective (ADR-0001), extracted behind the named module ADR-0003 calls for.
 * Feasibility (time-window compliance, day-budget) is checked here as km-equivalent penalties a
 * solver scores candidates through, rather than re-encoding the rule itself.
 *
 * Category/variety balance is deliberately NOT here: it's an unverifiable preference (there's no
 * ground truth for "the right" category mix), unlike feasibility and travel which are objectively
 * checkable. It's deferred to a later, advisory suggestions feature — not part of the authoritative
 * objective (ADR-0001 amendment pending).
 *
 * Travel time is an *input* here, not something this module computes (ADR-0004 owns that) — hence
 * `routeWindowPenalty` takes a `travelMins` callback rather than a distance provider.
 */

export interface WindowedLocation {
  visitDuration?: number;
  openTime?: string;   // "HH:MM" 24-hour
  closeTime?: string;  // "HH:MM" 24-hour
}

// Penalty scale factors (km-equivalent per minute of violation).
// LATE is 10x EARLY: arriving after close is far worse than arriving before open (ADR-0001 #1).
export const WINDOW_EARLY_KM_PER_MIN = 0.5;
export const WINDOW_LATE_KM_PER_MIN = 5;

// Assumed visit time when visitDuration is not set (used only for arrival simulation).
export const DEFAULT_VISIT_MINS = 60;

// Feasibility penalty scale (ADR-0001 #1): km-equivalent per hour a day runs over its budget.
export const DAY_BUDGET_KM_PER_HOUR = 2;

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Feasibility penalty (ADR-0001 #1): a km-equivalent cost for visiting `loc` when the simulated
 * clock reads `arrivalMins` minutes from midnight. Never a hard block — always a soft steer.
 *
 * Two cases penalised:
 *   1. Arriving before open  -> waiting cost (mild)
 *   2. Visit runs past close -> missed/overrun window (severe). Arriving after close is always
 *      a special case of this (vd >= 0, so arrivalMins > close implies arrivalMins + vd > close
 *      too) — charged once here rather than twice for the same lateness.
 */
export function windowPenaltyKm(arrivalMins: number, loc: WindowedLocation): number {
  const vd = loc.visitDuration ?? DEFAULT_VISIT_MINS;
  const open = loc.openTime ? timeToMins(loc.openTime) : null;
  const close = loc.closeTime ? timeToMins(loc.closeTime) : null;
  let penalty = 0;
  if (open !== null && arrivalMins < open) penalty += (open - arrivalMins) * WINDOW_EARLY_KM_PER_MIN;
  if (close !== null && arrivalMins + vd > close) penalty += (arrivalMins + vd - close) * WINDOW_LATE_KM_PER_MIN;
  return penalty;
}

/**
 * Sums feasibility penalties across a route, simulating arrival times from `dayStartMins` via the
 * caller-supplied `travelMins` between consecutive stops.
 */
export function routeWindowPenalty<L extends WindowedLocation>(
  route: L[],
  dayStartMins: number,
  travelMins: (a: L, b: L) => number
): number {
  let t = dayStartMins;
  let p = 0;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) t += travelMins(route[i - 1], route[i]);
    p += windowPenaltyKm(t, route[i]);
    t += route[i].visitDuration ?? DEFAULT_VISIT_MINS;
  }
  return p;
}

/** Feasibility penalty (ADR-0001 #1): km-equivalent cost for a day whose projected duration exceeds budget. */
export function dayBudgetPenaltyKm(projectedMinutes: number, budgetMinutes: number): number {
  const excess = Math.max(0, projectedMinutes - budgetMinutes);
  return (excess / 60) * DAY_BUDGET_KM_PER_HOUR;
}
