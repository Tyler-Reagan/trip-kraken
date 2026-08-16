/**
 * The same boundary `request.ts` crosses, the other way. Wire vocabulary dies here: a `route`
 * becomes a Day, and its `type: "job"` steps in order become that Day's `locationIds` — Placements,
 * in our language, because VROOM answering is exactly what turns a candidate Activity into a
 * commitment. Nothing downstream of this module ever sees a route, a job, or a vehicle.
 */

import type { DayPlan, LocationInput, PlacementTiming, Unplaced } from "@/lib/solver";
import type { VroomSolution } from "@/lib/vroom/wire";

export interface ParsedSolution {
  days: DayPlan[];
  unplaced: Unplaced[];
}

/**
 * `matrixPoints` is the same positionally-indexed array `request.ts` built the request's
 * `location_index`/`job.id` bijection over — the only way to read a wire index back into a
 * `LocationInput`.
 */
export function parseVroomSolution(solution: VroomSolution, matrixPoints: LocationInput[]): ParsedSolution {
  const days: DayPlan[] = solution.routes.map((route) => {
    const locationIds: string[] = [];
    const timing: PlacementTiming[] = [];
    for (const step of route.steps) {
      if (step.type !== "job" || step.location_index == null) continue;
      const point = matrixPoints[step.location_index];
      if (!point) continue;
      locationIds.push(point.id);
      timing.push({ arrival: step.arrival ?? 0, waitingSeconds: step.waiting_time ?? 0 });
    }
    return { dayNumber: route.vehicle, locationIds, ...(timing.length > 0 ? { timing } : {}) };
  });

  // VROOM's unassigned[] carries {id, type} and never says why — an honest "couldn't fit" rather
  // than inventing a cause. `diagnose.ts` may replace this sentence with a real one afterwards
  // (ADR-0023 §8's second pass); this stays the truthful fallback for when it can't.
  const unplaced: Unplaced[] = solution.unassigned.map((u) => ({
    locationId: matrixPoints[u.id]?.id ?? String(u.id),
    code: "solver",
    reason: "Couldn't fit this into any day.",
  }));

  return { days, unplaced };
}
