/**
 * Optimize orchestrator (ADR-0015) — the bridge between the solver interface (`solve()`,
 * ADR-0003) and the persisted model. It derives the solver's inputs from the trip's constraint
 * fields (lodging booking dates → integer night-ranges; day count from the required date range),
 * runs the solver, maps the day-indexed plan back onto calendar dates, and replaces the plan
 * wholesale via `setPlacements`. Re-optimize is total and explicit: no locks, no diff (ADR-0015 §5).
 */

import { getTripWithDetails, setPlacements } from "@/lib/db";
import { solve, type FeasibilityViolation } from "@/lib/solver";
import type { LocationInput, StayPlan } from "@/lib/optimizer";
import { isActivity, isLodging, dayNumberOf, addDaysIso, numDaysOf, type Location, type TripWithDetails } from "@/types";

export type OptimizeOptions = {
  /** Soft per-day time budget in hours; over-budget days are gently penalized during clustering. */
  dayBudgetHours?: number;
};

export type OptimizeResult = {
  trip: TripWithDetails;
  /** ADR-0017: which stops/days the solved itinerary still violates, if any. Plumbing only —
   * nothing acts on this yet; it exists so a caller (the API route, eventually a UI) can. */
  feasibilityViolations: FeasibilityViolation[];
};

function toInput(l: Location): LocationInput {
  return {
    id: l.id,
    lat: l.lat ?? 0,
    lng: l.lng ?? 0,
    ...(l.visitDuration != null ? { visitDuration: l.visitDuration } : {}),
    ...(l.openTime != null ? { openTime: l.openTime } : {}),
    ...(l.closeTime != null ? { closeTime: l.closeTime } : {}),
  };
}

export async function optimizeTrip(tripId: string, opts: OptimizeOptions = {}): Promise<OptimizeResult> {
  const trip = getTripWithDetails(tripId);
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const numDays = numDaysOf(trip.startDate, trip.endDate);
  const lodgings = trip.locations.filter(isLodging);
  const activities = trip.locations.filter((l) => isActivity(l) && !l.excluded);

  // Lodging dates → integer night-ranges (ADR-0015): a booking checking in on day X and out on day
  // Y covers nights X..Y-1, clamped to the trip's [1, numDays]. Empty ranges (outside the trip) drop.
  const stays: StayPlan[] = [];
  for (const l of lodgings) {
    const startNight = Math.max(1, dayNumberOf(trip.startDate, l.checkInDate));
    const endNight = Math.min(numDays, dayNumberOf(trip.startDate, l.checkOutDate) - 1);
    if (startNight <= endNight) stays.push({ lodgingId: l.id, startNight, endNight });
  }

  // The solver needs lodging coordinates (for clustering tethers) alongside the placeable activities;
  // it holds the lodgings out of the pool itself. Edges derive from transit, which is parked — none fed.
  const inputLocations = [...activities, ...lodgings].map((l) => toInput(l));
  const dayBudgetMinutes =
    typeof opts.dayBudgetHours === "number" && opts.dayBudgetHours > 0 ? opts.dayBudgetHours * 60 : undefined;

  const itinerary = await solve({ locations: inputLocations, numDays, stays, dayBudgetMinutes, startDate: trip.startDate });

  // Map day numbers onto calendar dates and flatten to the stored Placement shape.
  const placements = itinerary.days.flatMap((p) =>
    p.locationIds.map((locationId, order) => ({
      locationId,
      date: addDaysIso(trip.startDate, p.dayNumber - 1),
      order,
    }))
  );

  return { trip: setPlacements(tripId, placements), feasibilityViolations: itinerary.feasibilityViolations };
}
