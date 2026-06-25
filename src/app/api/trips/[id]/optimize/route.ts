import { NextRequest, NextResponse } from "next/server";
import { getOptimizationInputs, getLockedStops, reconcileItinerary } from "@/lib/db";
import { optimizeItinerary } from "@/lib/optimizer";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { numDays, startDate, dayBudgetHours, balanceCategories } = body;

  if (!numDays || typeof numDays !== "number" || numDays < 1) {
    return NextResponse.json({ error: "numDays must be a positive integer" }, { status: 400 });
  }

  // Schedulable locations + the Stay timeline (null when the trip doesn't exist).
  const inputs = getOptimizationInputs(tripId);
  if (!inputs) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const dayBudgetMinutes =
    typeof dayBudgetHours === "number" && dayBudgetHours > 0
      ? dayBudgetHours * 60
      : undefined;

  const stays = inputs.stays.map((s) => ({
    lodgingId: s.lodgingLocationId,
    startNight: s.startNight,
    endNight: s.endNight,
  }));

  // Locks the solver must honor (ADR-0006). Locks pinned past the new day count are dropped
  // here — they can't be placed; the reconciling writer surfaces them as orphans.
  const locked = getLockedStops(tripId).filter((l) => l.dayNumber <= numDays);

  const dayPlans = optimizeItinerary(
    inputs.locations.map((l) => ({
      id: l.id,
      lat: l.lat ?? 0,
      lng: l.lng ?? 0,
      ...(l.visitDuration != null ? { visitDuration: l.visitDuration } : {}),
      ...(l.openTime     != null ? { openTime:      l.openTime      } : {}),
      ...(l.closeTime    != null ? { closeTime:     l.closeTime     } : {}),
      ...(balanceCategories && l.categories != null ? { categories: l.categories } : {}),
    })),
    numDays,
    stays,
    dayBudgetMinutes,
    undefined,
    locked
  );

  // Reconcile in place (ADR-0006/0008): preserves Stop identity, notes, and locks rather
  // than wiping the itinerary. Returns warnings (e.g. locks orphaned by a day-count cut).
  const { trip, warnings } = reconcileItinerary(tripId, numDays, startDate ?? null, dayPlans);
  return NextResponse.json({ ...trip, warnings });
}
