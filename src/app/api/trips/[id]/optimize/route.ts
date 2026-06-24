import { NextRequest, NextResponse } from "next/server";
import { getOptimizationInputs, rebuildItinerary } from "@/lib/db";
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

  // Schedulable locations with derived isLodging (null when the trip doesn't exist).
  const locations = getOptimizationInputs(tripId);
  if (!locations) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const dayBudgetMinutes =
    typeof dayBudgetHours === "number" && dayBudgetHours > 0
      ? dayBudgetHours * 60
      : undefined;

  const dayPlans = optimizeItinerary(
    locations.map((l) => ({
      id: l.id,
      lat: l.lat ?? 0,
      lng: l.lng ?? 0,
      ...(l.visitDuration != null ? { visitDuration: l.visitDuration } : {}),
      ...(l.openTime     != null ? { openTime:      l.openTime      } : {}),
      ...(l.closeTime    != null ? { closeTime:     l.closeTime     } : {}),
      ...(l.isLodging                                ? { isLodging: true }          : {}),
      ...(balanceCategories && l.categories != null ? { categories: l.categories } : {}),
    })),
    numDays,
    dayBudgetMinutes
  );

  const updated = rebuildItinerary(tripId, numDays, startDate ?? null, dayPlans);
  return NextResponse.json(updated);
}
