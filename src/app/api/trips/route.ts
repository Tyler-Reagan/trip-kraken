import { NextRequest, NextResponse } from "next/server";
import { listTrips, createTripWithLocations } from "@/lib/db";

export async function GET() {
  return NextResponse.json(listTrips());
}

/** Create a blank-slate trip (ADR-0010): no source map, no locations yet. */
export async function POST(req: NextRequest) {
  let body: { name?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty/invalid body is fine — a name is optional.
  }

  const name = body.name?.trim() || `Trip – ${new Date().toLocaleDateString()}`;
  const trip = createTripWithLocations({ name, sourceUrl: null, locations: [] });
  return NextResponse.json(trip, { status: 201 });
}
