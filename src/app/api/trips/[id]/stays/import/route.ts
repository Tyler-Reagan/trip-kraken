import { NextRequest, NextResponse } from "next/server";
import { importBookingStay, StayValidationError } from "@/lib/db";
import { parseBookingConfirmation } from "@/lib/bookingImport";

/**
 * Import a pasted booking confirmation as a Stay (ADR-0013 Phase 2 / ADR-0010, #57). Body: { text }.
 * Parses the confirmation, then resolves/creates the lodging Location and appends the Stay.
 * Malformed input and invariant violations return 400 with a message — never a silent drop.
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
    const trip = importBookingStay(tripId, parsed.booking);
    return NextResponse.json(trip);
  } catch (err) {
    if (err instanceof StayValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
