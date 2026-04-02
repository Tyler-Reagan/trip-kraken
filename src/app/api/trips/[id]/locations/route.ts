import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST — add a custom location to a trip
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { name, address, lat, lng } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const location = await db.location.create({
    data: {
      tripId,
      name,
      address: address ?? null,
      lat: lat ?? null,
      lng: lng ?? null,
    },
  });

  return NextResponse.json(location, { status: 201 });
}
