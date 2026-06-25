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
  // Lodging is never orphan-deleted.
  if (!keepLocation && stop) {
    const { remaining } = db
      .prepare("SELECT COUNT(*) as remaining FROM ItineraryStop WHERE locationId = ?")
      .get(stop.locationId) as { remaining: number };

    if (remaining === 0) {
      // Lodging (a Location referenced by a Stay) is never orphan-deleted.
      const isLodging = db
        .prepare("SELECT 1 AS x FROM Stay WHERE tripId = ? AND lodgingLocationId = ? LIMIT 1")
        .get(tripId, stop.locationId) !== undefined;

      if (!isLodging) {
        db.prepare("DELETE FROM Location WHERE id = ?").run(stop.locationId);
      }
    }
  }

  return new NextResponse(null, { status: 204 });
}
