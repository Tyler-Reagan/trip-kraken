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
 * Known simplification (flagged for the next pass, not fixed here): evaluating violations
 * re-fetches a `costMatrix` that `optimizeItinerary` already fetched internally for sequencing —
 * two round trips instead of one. Harmless for the default haversine provider; worth collapsing to
 * one fetch before/if a real routing-API provider makes that duplication actually costly.
 */

import {
  optimizeItinerary,
  DEFAULT_MODE,
  type LocationInput,
  type StayPlan,
  type EdgeAnchors,
  type DayPlan,
} from "@/lib/optimizer";
import { windowPenaltyKm, dayBudgetPenaltyKm } from "@/lib/objective";
import { haversineProvider, buildDistanceLookup, hasValidCoords } from "@/lib/travelCost";

export interface OptimizationProblem {
  locations: LocationInput[];
  numDays: number;
  stays?: StayPlan[];
  dayBudgetMinutes?: number;
  dayStartMins?: number;
  edges?: EdgeAnchors;
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
  } = problem;

  const days = await optimizeItinerary(locations, numDays, stays, dayBudgetMinutes, dayStartMins, edges);

  const byId = new Map(locations.map((l) => [l.id, l]));
  const validForDist = locations.filter(hasValidCoords);
  const dist = await buildDistanceLookup(haversineProvider, validForDist, DEFAULT_MODE);

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

  let t = dayStartMins;
  let totalDuration = 0;
  // Locations without real coordinates (not yet geocoded) were never routed through the distance
  // lookup — optimizer.ts places them without sequencing or distance-considering them at all — so
  // they're excluded here the same way: no travel-time cost, and they never anchor the next real
  // stop's travel time either (travelMins has no entry for their id, per solve()'s validForDist).
  let lastWithCoords: LocationInput | null = null;
  stops.forEach((stop) => {
    if (hasValidCoords(stop) && lastWithCoords) t += travelMins(lastWithCoords.id, stop.id);
    const penalty = windowPenaltyKm(t, stop);
    if (penalty > 0) {
      violations.push({ locationId: stop.id, dayNumber: day.dayNumber, rule: "closed-hours", magnitude: penalty });
    }
    t += stop.visitDuration ?? 0;
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
