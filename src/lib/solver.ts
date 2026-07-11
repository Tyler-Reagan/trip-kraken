/**
 * The solver interface (ADR-0003): `solve(problem): Itinerary`, algorithm-agnostic — callers
 * assemble an `OptimizationProblem` from the domain model and never touch the algorithm directly.
 * Thin by design: this is the *default* solver (today's clustering+sequencing heuristic,
 * `optimizer.ts`) wrapped behind the interface, not a config-selectable registry — there is
 * exactly one implementation, so building a way to choose between solvers is speculative until a
 * second one actually exists (docs/optimizer-rebuild.md).
 *
 * Per ADR-0016/ADR-0017: `Itinerary` carries `feasibilityViolations` alongside the day plan —
 * which stop/day violated which rule, and by how much — rather than silently discarding that
 * information once the arrangement is built. This is plumbing only: no UI consumes it yet, and no
 * caller is required to act on it.
 *
 * `solve()` fetches the `costMatrix` once (#82) and passes it into `optimizeItinerary` as
 * `precomputedDist`, reusing the same lookup for the violation pass below — a real routing
 * provider is queried/billed once per optimize run, not twice.
 *
 * `mode` (ADR-0019 #86) is just threaded through to both fetches — `solve()` doesn't resolve a
 * Trip's allowed-mode set or select a provider itself; the orchestrator (`optimize.ts`) does both
 * before calling in, so `solve()` stays provider- and mode-agnostic (this file's `DEFAULT_MODE`
 * import is only a same-module fallback for callers, like tests, that don't pass one).
 */

import {
  optimizeItinerary,
  DEFAULT_MODE,
  type LocationInput,
  type StayPlan,
  type EdgeAnchors,
  type DayPlan,
} from "@/lib/optimizer";
import { windowPenaltyKm, dayBudgetPenaltyKm, DEFAULT_VISIT_MINS } from "@/lib/objective";
import {
  haversineProvider,
  buildDistanceLookup,
  hasValidCoords,
  type TravelCostProvider,
  type TravelMode,
} from "@/lib/travelCost";
import type { IsoDate } from "@/types";

export interface OptimizationProblem {
  locations: LocationInput[];
  numDays: number;
  stays?: StayPlan[];
  dayBudgetMinutes?: number;
  dayStartMins?: number;
  edges?: EdgeAnchors;
  /** Defaults to the straight-line haversine provider (ADR-0004). Explicit here — rather than
   * each of solve() and optimizeItinerary independently hardcoding the same import — so both
   * halves of one optimize run are guaranteed to score against the same cost model. */
  provider?: TravelCostProvider;
  /** The trip's first date (ADR-0018) — combined with dayStartMins into one representative
   * departure datetime, fetched once per optimize run for time-of-day-dependent providers.
   * Undefined skips time-of-day entirely (providers that ignore it, like haversine, don't need it). */
  startDate?: IsoDate;
  /** The resolved primary mode for this optimize run (ADR-0019 #86) — the orchestrator resolves a
   * Trip's allowed-mode set to one mode before calling in. Defaults to `DEFAULT_MODE` for callers
   * (tests, direct use) that don't need per-Trip mode resolution. */
  mode?: TravelMode;
}

/** A feasibility rule violated by the solved itinerary (ADR-0016's gate tier). `locationId` is
 * `null` for a day-level violation (day-budget) rather than a specific stop. */
export interface FeasibilityViolation {
  locationId: string | null;
  dayNumber: number;
  rule: "closed-hours" | "day-budget";
  /** Km-equivalent penalty magnitude (objective.ts's units) — how bad, not just that it happened. */
  magnitude: number;
}

export interface Itinerary {
  days: DayPlan[];
  feasibilityViolations: FeasibilityViolation[];
}

export async function solve(problem: OptimizationProblem): Promise<Itinerary> {
  const {
    locations,
    numDays,
    stays = [],
    dayBudgetMinutes,
    dayStartMins = 9 * 60,
    edges = {},
    provider = haversineProvider,
    startDate,
    mode = DEFAULT_MODE,
  } = problem;

  // One representative departure datetime for the whole run (ADR-0018): the trip's first date at
  // dayStartMins. Both optimizeItinerary's and this function's own costMatrix fetch use the same
  // value, so sequencing and violation-evaluation score against the same time-of-day snapshot.
  const departureTime = startDate ? new Date(Date.parse(startDate + "T00:00:00Z") + dayStartMins * 60000) : undefined;

  // One costMatrix fetch for the whole run (#82), shared between sequencing and the feasibility
  // pass below — passed into optimizeItinerary as precomputedDist so it doesn't fetch its own.
  const validForDist = locations.filter(hasValidCoords);
  const dist = await buildDistanceLookup(provider, validForDist, mode, { departureTime });

  const days = await optimizeItinerary(
    locations,
    numDays,
    stays,
    dayBudgetMinutes,
    dayStartMins,
    edges,
    provider,
    mode,
    departureTime,
    dist
  );

  const byId = new Map(locations.map((l) => [l.id, l]));

  const feasibilityViolations = days.flatMap((d) =>
    evaluateDayFeasibility(d, byId, dist.mins, dayStartMins, dayBudgetMinutes)
  );

  return { days, feasibilityViolations };
}

function evaluateDayFeasibility(
  day: DayPlan,
  byId: Map<string, LocationInput>,
  travelMins: (aId: string, bId: string) => number,
  dayStartMins: number,
  dayBudgetMinutes: number | undefined
): FeasibilityViolation[] {
  const violations: FeasibilityViolation[] = [];
  const stops = day.locationIds.map((id) => byId.get(id)).filter((l): l is LocationInput => l != null);

  // Seed the clock from the day's actual start anchor (travel + its own visit time), matching
  // nearestNeighborOrder's model (optimizer.ts) — the same anchor sequencing actually routed from
  // — instead of assuming arrival at dayStartMins with no travel cost from wherever the day began.
  const anchor = day.startAnchor && hasValidCoords(day.startAnchor) ? day.startAnchor : null;
  let t = dayStartMins + (anchor ? anchor.visitDuration ?? DEFAULT_VISIT_MINS : 0);
  let totalDuration = 0;
  // Locations without real coordinates (not yet geocoded) were never routed through the distance
  // lookup — optimizer.ts places them without sequencing or distance-considering them at all — so
  // they're excluded here the same way: no travel-time cost, and they never anchor the next real
  // stop's travel time either (travelMins has no entry for their id, per solve()'s validForDist).
  let lastWithCoords: LocationInput | null = anchor;
  stops.forEach((stop) => {
    if (hasValidCoords(stop) && lastWithCoords) t += travelMins(lastWithCoords.id, stop.id);
    const penalty = windowPenaltyKm(t, stop);
    if (penalty > 0) {
      violations.push({ locationId: stop.id, dayNumber: day.dayNumber, rule: "closed-hours", magnitude: penalty });
    }
    // Arrival-clock advance uses DEFAULT_VISIT_MINS (matches every other arrival simulation in the
    // codebase); the day-budget total below deliberately doesn't — kMeans's dayDurations uses
    // `?? 0`, i.e. an unset visitDuration isn't assumed to count against the day's time budget.
    t += stop.visitDuration ?? DEFAULT_VISIT_MINS;
    totalDuration += stop.visitDuration ?? 0;
    if (hasValidCoords(stop)) lastWithCoords = stop;
  });

  if (dayBudgetMinutes != null) {
    const penalty = dayBudgetPenaltyKm(totalDuration, dayBudgetMinutes);
    if (penalty > 0) {
      violations.push({ locationId: null, dayNumber: day.dayNumber, rule: "day-budget", magnitude: penalty });
    }
  }

  return violations;
}
