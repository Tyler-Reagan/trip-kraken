import { NextRequest, NextResponse } from "next/server";
import { moveStop, addStopToDay } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { stopId, locationId, targetDayId, targetOrder } = body;

  if (!targetDayId) {
    return NextResponse.json({ error: "targetDayId is required" }, { status: 400 });
  }

  // Create a new stop from a location
  if (locationId) {
    try {
      const updated = addStopToDay(tripId, locationId, targetDayId);
      return NextResponse.json(updated, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 404 });
    }
  }

  // Move an existing stop
  if (!stopId || targetOrder === undefined) {
    return NextResponse.json(
      { error: "Either locationId (create) or stopId + targetOrder (move) are required" },
      { status: 400 }
    );
  }

  try {
    const updated = moveStop(tripId, stopId, targetDayId, targetOrder);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
