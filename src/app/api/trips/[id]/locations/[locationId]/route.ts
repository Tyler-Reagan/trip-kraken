import { NextRequest, NextResponse } from "next/server";
import { updateLocation, deleteLocation, setLodgingDates, clearLodging, getLocation, LodgingValidationError } from "@/lib/db";

/**
 * Edit a Location. Plain fields (excluded/note/name/visitDuration) update in place. Booking dates
 * are the kind-elevating gesture (ADR-0015): `checkInDate`+`checkOutDate` make it a lodging;
 * `checkInDate: null` relegates it back to an activity. Returns the updated Location.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: tripId, locationId } = await params;
  const body = await req.json();
  const { excluded, note, name, visitDuration, checkInDate, checkOutDate } = body;

  try {
    if (checkInDate === null) {
      clearLodging(tripId, locationId);
    } else if (checkInDate !== undefined && checkOutDate !== undefined) {
      setLodgingDates(tripId, locationId, { checkInDate, checkOutDate });
    }
  } catch (err) {
    if (err instanceof LodgingValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  updateLocation(tripId, locationId, { excluded, note, name, visitDuration });
  return NextResponse.json(getLocation(locationId));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { locationId } = await params;
  deleteLocation(locationId);
  return new NextResponse(null, { status: 204 });
}
