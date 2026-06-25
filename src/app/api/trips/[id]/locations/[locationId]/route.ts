import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: tripId, locationId } = await params;
  const body = await req.json();
  const { excluded, note, name, visitDuration, isLodging } = body;

  const db = getDb();

  db.exec("BEGIN");
  try {
    if (isLodging === true) {
      // Lodging is a Stay (ADR-0005). Single-Stay, transitional: one lodging per trip,
      // so replace any existing Stay (radio-style). Multi-Stay timeline is a later branch.
      const trip = db.prepare("SELECT numDays FROM Trip WHERE id = ?").get(tripId) as
        | { numDays: number | null }
        | undefined;
      db.prepare("DELETE FROM Stay WHERE tripId = ?").run(tripId);
      db.prepare(
        "INSERT INTO Stay (id, tripId, lodgingLocationId, ord, startNight, endNight) VALUES (?, ?, ?, 0, 1, ?)"
      ).run(newId(), tripId, locationId, trip?.numDays ?? 1);

      // Propagate to all days: remove any existing stop for this location, then
      // prepend it as ord=0 on every day in the trip
      const days = db.prepare(
        "SELECT id FROM ItineraryDay WHERE tripId = ? ORDER BY dayNumber ASC"
      ).all(tripId) as { id: string }[];

      db.prepare(
        "DELETE FROM ItineraryStop WHERE locationId = ? AND dayId IN (SELECT id FROM ItineraryDay WHERE tripId = ?)"
      ).run(locationId, tripId);

      for (const day of days) {
        db.prepare("UPDATE ItineraryStop SET ord = ord + 1 WHERE dayId = ?").run(day.id);
        db.prepare(
          "INSERT INTO ItineraryStop (id, dayId, locationId, ord, notes) VALUES (?, ?, ?, 0, NULL)"
        ).run(newId(), day.id, locationId);
      }
    }

    if (isLodging === false) {
      // Relegate: dissolve the Stay, then remove the auto-prepended lodging stops.
      db.prepare("DELETE FROM Stay WHERE tripId = ? AND lodgingLocationId = ?").run(tripId, locationId);
      db.prepare(
        "DELETE FROM ItineraryStop WHERE locationId = ? AND dayId IN (SELECT id FROM ItineraryDay WHERE tripId = ?)"
      ).run(locationId, tripId);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (excluded      !== undefined) { setClauses.push("excluded = ?");      values.push(excluded ? 1 : 0); }
    if (note          !== undefined) { setClauses.push("note = ?");           values.push(note); }
    if (name          !== undefined) { setClauses.push("name = ?");           values.push(name); }
    if (visitDuration !== undefined) { setClauses.push("visitDuration = ?");  values.push(visitDuration); }

    if (setClauses.length > 0) {
      values.push(locationId);
      db.prepare(`UPDATE Location SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const location = db.prepare("SELECT * FROM Location WHERE id = ?").get(locationId);
  return NextResponse.json(location);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { locationId } = await params;
  const db = getDb();

  // The lodging FK is ON DELETE RESTRICT, so a Location serving as a Stay's lodging
  // can't be deleted directly. Relegate first (dissolve any referencing Stay), then
  // delete — Stops cascade away with the Location.
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM Stay WHERE lodgingLocationId = ?").run(locationId);
    db.prepare("DELETE FROM Location WHERE id = ?").run(locationId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return new NextResponse(null, { status: 204 });
}
