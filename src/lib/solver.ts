/**
 * The solver interface (ADR-0003): `solve(problem): Itinerary`, algorithm-agnostic — callers
 * assemble an `OptimizationProblem` from the domain model and never touch the algorithm directly.
 *
 * ADR-0023 replaces the default solver behind this seam with VROOM, a hosted vehicle-routing
 * service, and deletes the two-phase clustering+sequencing heuristic (`optimizer.ts`) and its
 * shared objective (`objective.ts`) rather than reimplementing them — VROOM's own comparator
 * (priority_sum, then assigned count, then travel cost, then vehicles used) replaces the km-
 * equivalent penalty scoring ADR-0016 built for lack of anything better. Feasibility stops being a
 * scored gate and becomes hard admission: `FeasibilityViolation` is deleted, not kept empty (§8) —
 * an assigned Placement *cannot* violate its hours under hard time windows, so the field would
 * always read empty. `Itinerary.unplaced` replaces it as the honest story: a Placement that never
 * happened, with a reason where we have one.
 *
 * `solver.ts` owns `LocationInput`/`StayPlan`/`DayPlan`/`Unplaced` (rehomed from `optimizer.ts`,
 * §9's Consequences) — this is the seam, so it defines the shapes rather than importing them from
 * the implementation behind it.
 *
 * The pipeline, in order (CONTEXT.md's "Solver wire vocabulary" entry names the boundary
 * `src/lib/vroom/wire.ts` enforces — nothing past this file speaks VROOM's vocabulary):
 *
 *   preflight → buildTravelMatrix → buildVroomRequest → postVroom → parseVroomSolution
 *
 * Exclusions must be decided before the matrix is built, not after (ADR-0023 §7's 2026-08-12
 * amendment): a Location we can't place must never reach `buildTravelMatrix` at all, or every
 * registry provider — including metered ones — pays for a cell whose Location was never going
 * anywhere.
 */

import { addDaysIso, type IsoDate } from "@/types";
import type { PathKind } from "@/types/path";
import { hasValidCoords } from "@/lib/geo";
import { buildTravelMatrix } from "@/lib/travelCostRegistry";
import { preflight } from "@/lib/vroom/preflight";
import { buildVroomRequest } from "@/lib/vroom/request";
import { postVroom } from "@/lib/vroom/client";
import { parseVroomSolution } from "@/lib/vroom/response";

/** A candidate Location as the solver sees it — id, coordinates, and the optimizer-relevant
 * fields projected off the full domain `Location` (`optimize.ts`'s `toInput`). `lat`/`lng` default
 * to `(0,0)` for a not-yet-geocoded Location (the same convention `hasValidCoords` tests for), so
 * they are plain numbers here, never `null`. */
export interface LocationInput {
  id: string;
  lat: number;
  lng: number;
  visitDuration?: number;
  openTime?: string;
  closeTime?: string;
  hoursJson?: Record<string, { open: string; close: string | null }> | null;
  /** #152: distinguishes "still being looked up" from "we couldn't find this place" — both read
   * as `!hasValidCoords`, but want different pre-flight reasons and different user actions. */
  enrichmentStatus?: "done" | "pending" | "failed";
  kind?: "activity" | "transit" | "lodging";
}

/** A lodging's booking dates, reduced to the integer night-range it covers (ADR-0015): a booking
 * checking in on day X and out on day Y covers nights X..Y-1, clamped to the Trip's [1, numDays]. */
export interface StayPlan {
  lodgingId: string;
  startNight: number;
  endNight: number;
}

/** Per-Placement arrival/waiting time, absolute Unix seconds and seconds respectively — free in
 * VROOM's response (ADR-0023 Consequences: re-deriving them later would mean re-solving). */
export interface PlacementTiming {
  arrival: number;
  waitingSeconds: number;
}

export interface DayPlan {
  dayNumber: number;
  locationIds: string[];
  /** Parallel to `locationIds` when present — one entry per Placement, in the same order. Absent
   * for an empty day. */
  timing?: PlacementTiming[];
}

/** An Activity the optimizer could not place, with a reason (CONTEXT.md's "Unplaced" entry) — not
 * "excluded", which is the user's own `Location.excluded` flag and means something different. */
export interface Unplaced {
  locationId: string;
  code: "ungeocoded-pending" | "ungeocoded-failed" | "no-lodging-coverage" | "closed-all-days" | "solver";
  reason: string;
}

/** The Path kinds this run wants sourced (ADR-0024 §3) when a caller doesn't resolve its own —
 * `optimize.ts` always passes an explicit Trip-derived set; this is only a same-module fallback
 * for direct/test callers. */
export const DEFAULT_KINDS: PathKind[] = ["walking"];

/** Load-bearing (ADR-0023 Consequences): `optimizeTrip(tripId)` with no options is a real call
 * path, and VROOM's own default vehicle window is `[0, 2^32-1]` — an unbounded day lets the
 * comparator's fourth tier (fewest vehicles used) cram the whole Trip onto day 1. There is no "no
 * budget" option any more. */
export const DEFAULT_DAY_BUDGET_MINUTES = 480; // 8h, matching OptimizeModal's default

export interface OptimizationProblem {
  locations: LocationInput[];
  numDays: number;
  stays?: StayPlan[];
  dayBudgetMinutes?: number;
  dayStartMins?: number;
  /** The Trip's first date (ADR-0018) — combined with `dayStartMins` into each Day's absolute-
   * second window, and the basis for `job.time_windows`. Undefined skips date-scoped hours
   * entirely (a caller, e.g. a test, that hasn't resolved a start date yet). */
  startDate?: IsoDate;
  /** The Path kinds this run wants sourced (ADR-0024 §3) — a static declaration of what's being
   * asked for. Defaults to `DEFAULT_KINDS` for callers that don't need per-Trip resolution. */
  kinds?: PathKind[];
}

export interface Itinerary {
  days: DayPlan[];
  /** Activities the optimizer could not place, with reasons (ADR-0023 §7 pre-flight exclusions,
   * plus §7's honest-but-reasonless VROOM `unassigned[]` case). */
  unplaced: Unplaced[];
  /** Non-fatal conditions worth telling the user about that aren't a reason any one Activity was
   * left out — e.g. a lodging still enrichment-pending, so its Day has no anchor (#152: warn,
   * don't block). */
  warnings: string[];
}

export async function solve(problem: OptimizationProblem): Promise<Itinerary> {
  const {
    locations,
    numDays,
    stays = [],
    dayBudgetMinutes = DEFAULT_DAY_BUDGET_MINUTES,
    dayStartMins = 9 * 60,
    startDate,
    kinds = DEFAULT_KINDS,
  } = problem;

  if (locations.length === 0) return { days: [], unplaced: [], warnings: [] };

  const days = numDays > 0 ? numDays : 1;
  const emptyDays = (): DayPlan[] => Array.from({ length: days }, (_, i) => ({ dayNumber: i + 1, locationIds: [] }));

  // Anchors (lodgings, from stays) are held out of the candidate pool — never emitted as a
  // Placement, only ever a Day's start/end (ADR-0005). Everything else is a placement candidate.
  const lodgingIds = new Set(stays.map((s) => s.lodgingId));
  const lodgings = locations.filter((l) => lodgingIds.has(l.id));
  const activities = locations.filter((l) => !lodgingIds.has(l.id));

  const tripDates: IsoDate[] = startDate ? Array.from({ length: days }, (_, i) => addDaysIso(startDate, i)) : [];

  const { placeable, unplaced, warnings, metroOf, lodgingMetros } = preflight(activities, lodgings, tripDates);

  if (placeable.length === 0) return { days: emptyDays(), unplaced, warnings };

  // Matrix points: every placeable Activity plus every geocoded lodging (Anchors) — one bijection
  // (index in this array) reused for `location_index`/`start_index`/`end_index`/`job.id`, so there
  // is no second id↔index map to keep in sync.
  const matrixPoints = [...placeable, ...lodgings.filter(hasValidCoords)];
  const departureTime = startDate ? new Date(Date.parse(startDate + "T00:00:00Z") + dayStartMins * 60000) : undefined;
  const matrix = await buildTravelMatrix(matrixPoints, { kinds, departureTime });

  const request = buildVroomRequest({
    placeable,
    stays,
    matrixPoints,
    matrix,
    tripDates,
    numDays: days,
    dayStartMins,
    dayBudgetMinutes,
    metroOf,
    lodgingMetros,
  });
  const solution = await postVroom(request);
  const { days: solvedDays, unplaced: solverUnplaced } = parseVroomSolution(solution, matrixPoints);

  // Every Day 1..numDays appears in the result, even one VROOM's response omitted for carrying no
  // Placements — an empty Day is still a Day, not a gap in the array.
  const byDayNumber = new Map(solvedDays.map((d) => [d.dayNumber, d]));
  const resolvedDays = Array.from({ length: days }, (_, i) => byDayNumber.get(i + 1) ?? { dayNumber: i + 1, locationIds: [] });

  return { days: resolvedDays, unplaced: [...unplaced, ...solverUnplaced], warnings };
}
