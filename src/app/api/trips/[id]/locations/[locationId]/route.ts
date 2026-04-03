import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { locationId } = await params;
  const body = await req.json();
  const { excluded, note, name } = body;

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (excluded !== undefined) { setClauses.push("excluded = ?"); values.push(excluded ? 1 : 0); }
  if (note !== undefined) { setClauses.push("note = ?"); values.push(note); }
  if (name !== undefined) { setClauses.push("name = ?"); values.push(name); }

  if (setClauses.length > 0) {
    values.push(locationId);
    db.prepare(`UPDATE Location SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  }

  const location = db.prepare("SELECT * FROM Location WHERE id = ?").get(locationId);
  return NextResponse.json(location);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { locationId } = await params;
  db.prepare("DELETE FROM Location WHERE id = ?").run(locationId);
  return new NextResponse(null, { status: 204 });
}
