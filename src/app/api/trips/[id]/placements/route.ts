import { NextRequest, NextResponse } from "next/server";
import { addPlacement, movePlacement } from "@/lib/db";

/**
 * Manual plan edits (ADR-0015) — hand placements that persist until the next optimize. Body either
 * adds (`locationId` + `date`, optional `order`) or moves (`placementId` + `date` + `order`).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { placementId, locationId, date, order } = body;

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
  }

  try {
    if (locationId) {
      const trip = addPlacement(tripId, locationId, date, typeof order === "number" ? order : undefined);
      return NextResponse.json(trip, { status: 201 });
    }
    if (placementId && typeof order === "number") {
      const trip = movePlacement(tripId, placementId, date, order);
      return NextResponse.json(trip);
    }
    return NextResponse.json(
      { error: "Either locationId (add) or placementId + order (move) are required" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
