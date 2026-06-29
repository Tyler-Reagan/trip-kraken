import { NextRequest, NextResponse } from "next/server";
import { removePlacement } from "@/lib/db";

/** Unschedule an activity (ADR-0015): delete the placement; the Location stays a candidate. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; placementId: string }> }
) {
  const { id: tripId, placementId } = await params;
  removePlacement(tripId, placementId);
  return new NextResponse(null, { status: 204 });
}
