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
 *                                                                          ↓
 *                                                                   diagnoseUnplaced
 *
 * The last step is a diagnostic, not a stage: it runs after the Plan is settled, only ever adds a
 * reason to an Activity that already failed to get one, and is allowed to fail without taking the
 * solve with it (ADR-0023 §8, amended 2026-08-16).
 *
 * Exclusions must be decided before the matrix is built, not after (ADR-0023 §7's 2026-08-12
 * amendment): a Location we can't place must never reach `buildTravelMatrix` at all, or every
 * registry provider — including metered ones — pays for a cell whose Location was never going
 * anywhere.
 */

import { addDaysIso, type IsoDate } from "@/types";
import type { PathKind, RoadProfile, TravelCost } from "@/types/path";
import { hasValidCoords } from "@/lib/geo";
import { buildTravelMatrix } from "@/lib/travelCostRegistry";
import { withLegModePin } from "@/lib/pathPairs";
import { preflight } from "@/lib/vroom/preflight";
import { buildVroomRequest } from "@/lib/vroom/request";
import { postVroom } from "@/lib/vroom/client";
import { parseVroomSolution } from "@/lib/vroom/response";
import { diagnoseUnplaced } from "@/lib/vroom/diagnose";

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
  /** Required — the candidate-pool split (below) and the trip-edge fields depend on it, and it is
   * always populated by `optimize.ts`'s `toInput`. */
  kind: "activity" | "transit" | "lodging";
  /** A trip-edge Transit Location's own constraint fields (ADR-0028), carried through so
   * `buildSolverInputDays` can compute Day 1 / the last Day's window honestly. Absent for
   * non-transit kinds. */
  arriveAt?: string | null;
  departAt?: string | null;
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

/** What the plan-mode pass found when it asked VROOM to evaluate an Unplaced Activity *as if* it
 * had been scheduled (ADR-0023 §8). Every cause here is a claim about one Day — "put it on day 4
 * and this breaks" — so `dayNumber` is part of the finding, not incidental to it.
 *
 * Causes are ours, not VROOM's (#155: "mapped to domain language, not passed through raw"):
 * - `day-full`       — the Day already carries its maximum Placements
 * - `out-of-reach`   — no Day serving this Location's area had room for it
 * - `after-closing`  — it would arrive `seconds` after the Location stops admitting visitors
 * - `before-opening` — it would have to be visited `seconds` before the Location opens
 * - `day-too-short`  — the Day would need `seconds` more hours than it has to absorb it
 */
export interface UnplacedDiagnosis {
  cause: "day-full" | "out-of-reach" | "after-closing" | "before-opening" | "day-too-short";
  /** Seconds past the limit. Only the two time-based causes carry one — VROOM reports `skills`
   * and `max_tasks` as a bare cause with no magnitude. */
  seconds?: number;
  dayNumber: number;
}

/** An Activity the optimizer could not place, with a reason (CONTEXT.md's "Unplaced" entry) — not
 * "excluded", which is the user's own `Location.excluded` flag and means something different. */
export interface Unplaced {
  locationId: string;
  code: "ungeocoded-pending" | "ungeocoded-failed" | "no-lodging-coverage" | "closed-all-days" | "solver";
  reason: string;
  /** Present only on a `code: "solver"` entry the plan-mode pass could diagnose (ADR-0023 §8).
   * The pre-flight codes already know their own reason and are never probed. Absent whenever the
   * diagnostic was skipped, failed, or found nothing — it is an enrichment of `reason`, never a
   * precondition for showing one. */
  diagnosis?: UnplacedDiagnosis;
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
  /** Whether the traveler holds a Japan Rail Pass (issue #211) — forwarded to `buildTravelMatrix`;
   * only the OSM-Japan provider acts on it. */
  hasJrPass?: boolean;
  /** The trip's edges (ADR-0028) — at most one arrival id, one departure id, resolved by the
   * caller from whichever Location(s) carry `arriveAt`/`departAt`. An id with no matching Location
   * in `locations`, or one that turns out ungeocoded, is simply not usable — `solve()` falls back
   * to the Lodging Anchor and warns, rather than failing. */
  edges?: { arrivalId?: string; departureId?: string };
  /** Manual per-leg road-mode overrides (issue #209/#217/#218) — a rider's Location-pair pin that
   * substitutes `mode` for the Trip's road kind on that one cell, instead of `roadProfile` applying
   * uniformly. Only meaningful for a pair present in `locations`; a pin whose Location(s) aren't in
   * this run (excluded, or dropped since) is silently a no-op — the pin persists regardless
   * (#217), stale-pin surfacing is #219's territory. */
  legModePins?: { locationAId: string; locationBId: string; mode: RoadProfile }[];
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

/**
 * Overrides the pinned cells of an already-built matrix in place (#218, corrected #223). Each
 * pinned pair gets re-composed as its own 2-point matrix through the same registry
 * (`buildTravelMatrix`), with `kinds` narrowed by `withLegModePin` to the pinned mode alone, and
 * only that cell's two directional entries are spliced back in. This keeps `composeTravelMatrix`'s
 * "one global `kinds` list per call" model untouched — no matrix API here supports a per-cell kind
 * argument in one request — while staying cheap: pins are rare (a rider overrides one leg at a
 * time), so this is at most a couple of extra 2-point provider calls, not a second full matrix.
 *
 * **Why the pinned kinds list drops `"rail"`/`"bus"` entirely, not just substitutes the road
 * element (#223's correction of this function's original shape):** `osm-japan`'s `"rail"`
 * capability never actually declines a cell within its geographic reach — it always answers,
 * worst case with its own walking estimate over the transit graph, indistinguishable from a real
 * road answer by `Path.kind` alone. Keeping `"rail"` alongside a pinned mode left the pin
 * permanently outranked; confirmed live, `["rail","walking"]` and `["rail","driving"]` returned
 * the identical `osm-japan` answer for the same pair. A pin is the rider's explicit override, so
 * this asks for the pinned mode alone.
 *
 * No-ops a pin whose mode already matches the Trip default (nothing would change) or whose
 * Location(s) aren't in this run's `matrixPoints` at all (excluded, or otherwise absent — #219's
 * stale-pin territory, not this function's).
 */
async function applyLegModePins(
  matrix: TravelCost[][],
  matrixPoints: LocationInput[],
  legModePins: NonNullable<OptimizationProblem["legModePins"]>,
  kinds: PathKind[],
  departureTime: Date | undefined,
  hasJrPass: boolean | undefined
): Promise<void> {
  if (legModePins.length === 0) return;

  const defaultRoadKind = kinds.find((k): k is RoadProfile => k === "walking" || k === "driving");
  const indexOf = new Map(matrixPoints.map((p, i) => [p.id, i]));

  for (const pin of legModePins) {
    if (pin.mode === defaultRoadKind) continue;
    const i = indexOf.get(pin.locationAId);
    const j = indexOf.get(pin.locationBId);
    if (i === undefined || j === undefined || i === j) continue;

    const subMatrix = await buildTravelMatrix([matrixPoints[i], matrixPoints[j]], {
      kinds: withLegModePin(kinds, pin),
      departureTime,
      hasJrPass,
    });
    matrix[i][j] = subMatrix[0][1];
    matrix[j][i] = subMatrix[1][0];
  }
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
    hasJrPass,
    edges,
    legModePins = [],
  } = problem;

  if (locations.length === 0) return { days: [], unplaced: [], warnings: [] };

  const days = numDays > 0 ? numDays : 1;
  const emptyDays = (): DayPlan[] => Array.from({ length: days }, (_, i) => ({ dayNumber: i + 1, locationIds: [] }));

  // Only an Activity is ever *placed* (CONTEXT.md: "the only kind the optimizer places"). Lodging
  // and trip-edge Transit are both Anchors — held out of the candidate pool, never emitted as a
  // Placement, only ever a Day's start/end (ADR-0005, ADR-0028).
  const activities = locations.filter((l) => l.kind === "activity");
  const lodgings = locations.filter((l) => l.kind === "lodging");
  const transitEdges = locations.filter((l) => l.kind === "transit");

  const arrivalLoc = edges?.arrivalId ? transitEdges.find((l) => l.id === edges.arrivalId) : undefined;
  const departureLoc = edges?.departureId ? transitEdges.find((l) => l.id === edges.departureId) : undefined;

  const tripDates: IsoDate[] = startDate ? Array.from({ length: days }, (_, i) => addDaysIso(startDate, i)) : [];

  const { placeable, unplaced, warnings, metroOf, lodgingMetros } = preflight(activities, lodgings, tripDates, {
    arrival: arrivalLoc,
    departure: departureLoc,
  });

  if (placeable.length === 0) return { days: emptyDays(), unplaced, warnings };

  // An edge with no valid coordinates falls back to the Lodging Anchor rather than anchoring a Day
  // on an unroutable point (ADR-0028 §4) — `preflight` already warned about it above.
  const arrivalUsable = arrivalLoc != null && hasValidCoords(arrivalLoc);
  const departureUsable = departureLoc != null && hasValidCoords(departureLoc);

  // Matrix points: every placeable Activity, every geocoded lodging, and either usable edge
  // Transit Location (Anchors) — one bijection (index in this array) reused for
  // `location_index`/`start_index`/`end_index`/`job.id`, so there is no second id↔index map to
  // keep in sync.
  const matrixPoints = [...placeable, ...lodgings.filter(hasValidCoords), ...transitEdges.filter(hasValidCoords)];
  const departureTime = startDate ? new Date(Date.parse(startDate + "T00:00:00Z") + dayStartMins * 60000) : undefined;
  const matrix = await buildTravelMatrix(matrixPoints, { kinds, departureTime, hasJrPass });
  await applyLegModePins(matrix, matrixPoints, legModePins, kinds, departureTime, hasJrPass);

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
    edges: {
      arrivalId: arrivalUsable ? arrivalLoc!.id : undefined,
      departureId: departureUsable ? departureLoc!.id : undefined,
      arriveAt: arrivalLoc?.arriveAt,
      departAt: departureLoc?.departAt,
    },
  });
  const solution = await postVroom(request);
  const { days: solvedDays, unplaced: solverUnplaced } = parseVroomSolution(solution, matrixPoints);

  // Every Day 1..numDays appears in the result, even one VROOM's response omitted for carrying no
  // Placements — an empty Day is still a Day, not a gap in the array.
  const byDayNumber = new Map(solvedDays.map((d) => [d.dayNumber, d]));
  const resolvedDays = Array.from({ length: days }, (_, i) => byDayNumber.get(i + 1) ?? { dayNumber: i + 1, locationIds: [] });

  // The plan-mode pass (ADR-0023 §8) — diagnosis only, and strictly after the Plan is settled.
  // It asks what would break if a dropped Activity were scheduled anyway; its answer enriches an
  // `Unplaced` reason and can never become a Placement. Best-effort by construction: it returns
  // `solverUnplaced` unchanged rather than throwing, so a solve that succeeded stays succeeded.
  const diagnosed = await diagnoseUnplaced(request, solution, solverUnplaced, matrixPoints);

  return { days: resolvedDays, unplaced: [...unplaced, ...diagnosed], warnings };
}
