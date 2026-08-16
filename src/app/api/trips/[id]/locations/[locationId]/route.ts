import { NextRequest, NextResponse } from "next/server";
import {
  updateLocation,
  deleteLocation,
  setLodgingDates,
  clearLodging,
  setTripArrival,
  setTripDeparture,
  clearTripEdge,
  getLocation,
  LodgingValidationError,
  TransitValidationError,
} from "@/lib/db";

/**
 * Edit a Location. Plain fields (excluded/note/name/visitDuration) update in place. Booking dates
 * are the kind-elevating gesture for lodging (ADR-0015): `checkInDate`+`checkOutDate` make it a
 * lodging; `checkInDate: null` relegates it back to an activity. `arriveAt`/`departAt` are the
 * mirror gesture for a trip edge (ADR-0028): a string designates the Location as that edge (`""`
 * for a known edge with no known time, `"HH:MM"` for a known time — the date component is always
 * the trip's own start/end date, never accepted from the client); `null` releases the edge, which
 * relegates the Location back to an activity if it was the last of the two set. Returns the
 * updated Location.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: tripId, locationId } = await params;
  const body = await req.json();
  const { excluded, note, name, visitDuration, checkInDate, checkOutDate, arriveAt, departAt } = body;

  try {
    if (checkInDate === null) {
      clearLodging(tripId, locationId);
    } else if (checkInDate !== undefined && checkOutDate !== undefined) {
      setLodgingDates(tripId, locationId, { checkInDate, checkOutDate });
    }
    if (arriveAt === null) {
      clearTripEdge(tripId, locationId, "arrival");
    } else if (arriveAt !== undefined) {
      setTripArrival(tripId, locationId, arriveAt === "" ? null : arriveAt);
    }
    if (departAt === null) {
      clearTripEdge(tripId, locationId, "departure");
    } else if (departAt !== undefined) {
      setTripDeparture(tripId, locationId, departAt === "" ? null : departAt);
    }
  } catch (err) {
    if (err instanceof LodgingValidationError || err instanceof TransitValidationError) {
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
