import { NextRequest, NextResponse } from "next/server";
import { deleteStop, setStopLocked } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { id: tripId, stopId } = await params;
  const { locked } = await req.json();
  if (typeof locked !== "boolean") {
    return NextResponse.json({ error: "locked (boolean) is required" }, { status: 400 });
  }
  const updated = setStopLocked(tripId, stopId, locked);
  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { id: tripId, stopId } = await params;
  const keepLocation = new URL(req.url).searchParams.get("keepLocation") === "true";

  deleteStop(tripId, stopId, keepLocation);
  return new NextResponse(null, { status: 204 });
}
