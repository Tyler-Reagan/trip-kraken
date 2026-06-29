import { NextRequest, NextResponse } from "next/server";
import { importBookingLodging, LodgingValidationError } from "@/lib/db";
import { parseBookingConfirmation } from "@/lib/bookingImport";

/**
 * Import a pasted booking confirmation as a lodging (ADR-0010, #57). Body: { text }. Parses the
 * confirmation, then resolves/creates the property Location and attaches its dates (elevating it to
 * kind=lodging). Malformed input and invariant violations return 400 — never a silent drop.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const text = typeof body?.text === "string" ? body.text : "";

  const parsed = parseBookingConfirmation(text);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const trip = importBookingLodging(tripId, parsed.booking);
    return NextResponse.json(trip);
  } catch (err) {
    if (err instanceof LodgingValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
