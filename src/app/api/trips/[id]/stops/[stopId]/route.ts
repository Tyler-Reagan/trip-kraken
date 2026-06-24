import { NextRequest, NextResponse } from "next/server";
import { deleteStop } from "@/lib/db";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { id: tripId, stopId } = await params;
  const keepLocation = new URL(req.url).searchParams.get("keepLocation") === "true";

  deleteStop(tripId, stopId, keepLocation);
  return new NextResponse(null, { status: 204 });
}
