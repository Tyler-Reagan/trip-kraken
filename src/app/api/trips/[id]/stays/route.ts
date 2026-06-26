import { NextRequest, NextResponse } from "next/server";
import { setStays, StayValidationError, type StayInput } from "@/lib/db";

/**
 * Replace the trip's Stay timeline (ADR-0013). Body: { stays: StayInput[] }.
 * Each stay = { lodgingLocationId, checkIn, checkOut } (ISO datetimes); setStays validates.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const stays: StayInput[] = Array.isArray(body?.stays) ? body.stays : [];

  try {
    const trip = setStays(tripId, stays);
    return NextResponse.json(trip);
  } catch (err) {
    if (err instanceof StayValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
