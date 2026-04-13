import { NextRequest, NextResponse } from "next/server";
import { getDb, rebuildItinerary } from "@/lib/db";
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

  type LocationRow = {
    id: string; lat: number | null; lng: number | null; excluded: number;
    visitDuration: number | null; openTime: string | null; closeTime: string | null;
    isAnchor: number; categories: string | null;
  };
  const locations = getDb().prepare(
    "SELECT id, lat, lng, excluded, visitDuration, openTime, closeTime, isAnchor, categories FROM Location WHERE tripId = ? AND excluded = 0"
  ).all(tripId) as LocationRow[];

  const tripExists = getDb().prepare("SELECT id FROM Trip WHERE id = ?").get(tripId);
  if (!tripExists) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

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
      ...(l.isAnchor                                   ? { isAnchor: true }                                       : {}),
      ...(balanceCategories && l.categories != null ? { categories: JSON.parse(l.categories) as string[] } : {}),
    })),
    numDays,
    dayBudgetMinutes
  );

  const updated = rebuildItinerary(tripId, numDays, startDate ?? null, dayPlans);
  return NextResponse.json(updated);
}
