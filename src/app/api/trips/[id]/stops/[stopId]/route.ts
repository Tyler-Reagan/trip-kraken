import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { id: tripId, stopId } = await params;
  const keepLocation = new URL(req.url).searchParams.get("keepLocation") === "true";
  const db = getDb();

  const stop = db
    .prepare("SELECT locationId FROM ItineraryStop WHERE id = ?")
    .get(stopId) as { locationId: string } | undefined;

  db.prepare("DELETE FROM ItineraryStop WHERE id = ?").run(stopId);

  // Orphan-delete the location unless caller requested keepLocation (unschedule use-case).
  // Anchors are never orphan-deleted.
  if (!keepLocation && stop) {
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
