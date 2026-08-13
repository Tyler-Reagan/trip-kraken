/**
 * Optimize orchestrator (ADR-0015) — the bridge between the solver interface (`solve()`,
 * ADR-0003) and the persisted model. It derives the solver's inputs from the trip's constraint
 * fields (lodging booking dates → integer night-ranges; day count from the required date range),
 * runs the solver, maps the day-indexed plan back onto calendar dates, and replaces the plan
 * wholesale via `setPlacements`. Re-optimize is total and explicit: no locks, no diff (ADR-0015 §5).
 */

import { getTripWithDetails, setPlacements } from "@/lib/db";
import { solve, type LocationInput, type StayPlan, type Unplaced } from "@/lib/solver";
import type { PathKind } from "@/types/path";
import { isActivity, isLodging, dayNumberOf, addDaysIso, numDaysOf, type Location, type TripWithDetails } from "@/types";

export type OptimizeOptions = {
  /** Per-day time budget in hours — the length of the day including travel and waiting, not just
   * visiting (ADR-0023's Consequences: this changes meaning from the pre-VROOM optimizer). */
  dayBudgetHours?: number;
};

export type OptimizeResult = {
  trip: TripWithDetails;
  /** Activities the optimizer could not place, with reasons (ADR-0023 §7) — the existing
   * Unassigned tray shows these already (no Placement = unassigned); #120 surfaces the `reason`. */
  unplaced: Unplaced[];
  /** Non-fatal conditions worth telling the user about, e.g. a lodging still enrichment-pending
   * (#152: warn, don't block). */
  warnings: string[];
};

function toInput(l: Location): LocationInput {
  return {
    id: l.id,
    lat: l.lat ?? 0,
    lng: l.lng ?? 0,
    kind: l.kind,
    enrichmentStatus: l.enrichmentStatus,
    ...(l.visitDuration != null ? { visitDuration: l.visitDuration } : {}),
    ...(l.openTime != null ? { openTime: l.openTime } : {}),
    ...(l.closeTime != null ? { closeTime: l.closeTime } : {}),
    ...(l.hoursJson != null ? { hoursJson: l.hoursJson } : {}),
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

  const inputLocations = [...activities, ...lodgings].map(toInput);
  const dayBudgetMinutes =
    typeof opts.dayBudgetHours === "number" && opts.dayBudgetHours > 0 ? opts.dayBudgetHours * 60 : undefined;

  // The kinds this run sources cells for (ADR-0024 §3): rail and bus are always in play, and
  // exactly one road kind — the Trip's own traveler-facing selector (CONTEXT.md's "kind (Path)"
  // entry: "the term returns only if a traveler-facing selector does").
  const kinds: PathKind[] = ["rail", "bus", trip.roadProfile];

  const itinerary = await solve({
    locations: inputLocations,
    numDays,
    stays,
    dayBudgetMinutes,
    startDate: trip.startDate,
    kinds,
  });

  // Map day numbers onto calendar dates and flatten to the stored Placement shape.
  const placements = itinerary.days.flatMap((p) =>
    p.locationIds.map((locationId, order) => ({
      locationId,
      date: addDaysIso(trip.startDate, p.dayNumber - 1),
      order,
    }))
  );

  return {
    trip: setPlacements(tripId, placements),
    unplaced: itinerary.unplaced,
    warnings: itinerary.warnings,
  };
}
