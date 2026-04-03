import { NextRequest, NextResponse } from "next/server";
import { db, getTripWithDetails } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trip = getTripWithDetails(id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json(trip);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, numDays, startDate } = body;

  const setClauses: string[] = ["updatedAt = datetime('now')"];
  const values: unknown[] = [];

  if (name !== undefined) { setClauses.push("name = ?"); values.push(name); }
  if (numDays !== undefined) { setClauses.push("numDays = ?"); values.push(Number(numDays)); }
  if (startDate !== undefined) {
    setClauses.push("startDate = ?");
    values.push(startDate ? new Date(startDate).toISOString() : null);
  }

  values.push(id);
  db.prepare(`UPDATE Trip SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);

  const trip = getTripWithDetails(id);
  return NextResponse.json(trip);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.prepare("DELETE FROM Trip WHERE id = ?").run(id);
  return new NextResponse(null, { status: 204 });
}
