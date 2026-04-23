import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";
import { SQLInputValue } from "node:sqlite";

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
      // Radio-style: clear any existing lodging flag in the trip
      db.prepare("UPDATE Location SET isLodging = 0 WHERE tripId = ?").run(tripId);

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
      // Remove from all days — it was there only as lodging, not as a user-placed stop
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
    if (isLodging     !== undefined) { setClauses.push("isLodging = ?");      values.push(isLodging ? 1 : 0); }

    if (setClauses.length > 0) {
      values.push(locationId);
      db.prepare(`UPDATE Location SET ${setClauses.join(", ")} WHERE id = ?`).run(...(values as SQLInputValue[]));
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
  getDb().prepare("DELETE FROM Location WHERE id = ?").run(locationId);
  return new NextResponse(null, { status: 204 });
}
