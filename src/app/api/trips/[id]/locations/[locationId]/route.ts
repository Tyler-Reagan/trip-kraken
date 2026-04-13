import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SQLInputValue } from "node:sqlite";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: tripId, locationId } = await params;
  const body = await req.json();
  const { excluded, note, name, visitDuration, isAnchor } = body;

  // isAnchor is radio-style: setting it true clears all other anchors in the trip first
  if (isAnchor === true) {
    getDb().prepare("UPDATE Location SET isAnchor = 0 WHERE tripId = ?").run(tripId);
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (excluded    !== undefined) { setClauses.push("excluded = ?");     values.push(excluded ? 1 : 0); }
  if (note        !== undefined) { setClauses.push("note = ?");         values.push(note); }
  if (name        !== undefined) { setClauses.push("name = ?");         values.push(name); }
  if (visitDuration !== undefined) { setClauses.push("visitDuration = ?"); values.push(visitDuration); }
  if (isAnchor    !== undefined) { setClauses.push("isAnchor = ?");     values.push(isAnchor ? 1 : 0); }

  if (setClauses.length > 0) {
    values.push(locationId);
    getDb().prepare(`UPDATE Location SET ${setClauses.join(", ")} WHERE id = ?`).run(...(values as SQLInputValue[]));
  }

  const location = getDb().prepare("SELECT * FROM Location WHERE id = ?").get(locationId);
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
