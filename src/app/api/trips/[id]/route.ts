import { NextRequest, NextResponse } from "next/server";
import { getTripWithDetails, updateTrip, deleteTrip } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trip = getTripWithDetails(id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json(trip);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, startDate, endDate, dayLabels, transitCaveatDismissed } = body;

  const trip = updateTrip(id, {
    ...(name !== undefined ? { name } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
    ...(dayLabels !== undefined ? { dayLabels } : {}),
    ...(transitCaveatDismissed !== undefined ? { transitCaveatDismissed } : {}),
  });
  return NextResponse.json(trip);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteTrip(id);
  return new NextResponse(null, { status: 204 });
}
