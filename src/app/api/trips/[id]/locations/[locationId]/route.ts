import { NextRequest, NextResponse } from "next/server";
import { updateLocation, deleteLocation } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: tripId, locationId } = await params;
  const body = await req.json();
  const { excluded, note, name, visitDuration } = body;

  const location = updateLocation(tripId, locationId, { excluded, note, name, visitDuration });
  return NextResponse.json(location);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { locationId } = await params;
  deleteLocation(locationId);
  return new NextResponse(null, { status: 204 });
}
