import { NextRequest, NextResponse } from "next/server";
import { setTripEndpoints, StayValidationError } from "@/lib/db";

/**
 * Set the trip's arrival/departure edge anchors (ADR-0005). Body:
 * { arrivalLocationId: string | null, departureLocationId: string | null }.
 * Each must reference a Location in the trip, or be null to clear; setTripEndpoints validates.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const arrivalLocationId = typeof body?.arrivalLocationId === "string" ? body.arrivalLocationId : null;
  const departureLocationId = typeof body?.departureLocationId === "string" ? body.departureLocationId : null;

  try {
    const trip = setTripEndpoints(tripId, { arrivalLocationId, departureLocationId });
    return NextResponse.json(trip);
  } catch (err) {
    if (err instanceof StayValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
