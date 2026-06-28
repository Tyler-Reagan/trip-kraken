import { NextRequest, NextResponse } from "next/server";
import { listTrips, createTripWithLocations } from "@/lib/db";

export async function GET() {
  return NextResponse.json(listTrips());
}

const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Create a blank-slate trip (ADR-0010). Per ADR-0015 §3 every trip has a required date range, so
 *  the create form forces start/end dates; we 400 if they're missing or malformed. */
export async function POST(req: NextRequest) {
  let body: { name?: string; startDate?: string; endDate?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty/invalid body — fall through to the date validation below.
  }

  const { startDate, endDate } = body;
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return NextResponse.json({ error: "startDate and endDate (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate must be on or before endDate" }, { status: 400 });
  }

  const name = body.name?.trim() || `Trip – ${new Date().toLocaleDateString()}`;
  const trip = createTripWithLocations({ name, sourceUrl: null, startDate, endDate, locations: [] });
  return NextResponse.json(trip, { status: 201 });
}
