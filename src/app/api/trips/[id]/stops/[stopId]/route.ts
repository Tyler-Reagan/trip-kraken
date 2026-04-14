import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { id: tripId, stopId } = await params;
  const db = getDb();

  // Capture locationId before deleting so we can orphan-check below.
  const stop = db
    .prepare("SELECT locationId FROM ItineraryStop WHERE id = ?")
    .get(stopId) as { locationId: string } | undefined;

  db.prepare("DELETE FROM ItineraryStop WHERE id = ?").run(stopId);

  // After removing the stop, delete the Location if it is now orphaned
  // (no remaining itinerary stops anywhere in the trip) and is not an anchor.
  // Anchors are prepended to every day and intentionally have no persistent stop
  // record outside of the optimized itinerary — we never orphan-delete them.
  if (stop) {
    const { remaining } = db
      .prepare("SELECT COUNT(*) as remaining FROM ItineraryStop WHERE locationId = ?")
      .get(stop.locationId) as { remaining: number };

    if (remaining === 0) {
      const loc = db
        .prepare("SELECT isAnchor FROM Location WHERE id = ? AND tripId = ?")
        .get(stop.locationId, tripId) as { isAnchor: number } | undefined;

      if (loc && !loc.isAnchor) {
        db.prepare("DELETE FROM Location WHERE id = ?").run(stop.locationId);
      }
    }
  }

  return new NextResponse(null, { status: 204 });
}
