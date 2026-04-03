import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { name, address, lat, lng } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const id = newId();
  getDb().prepare(
    "INSERT INTO Location (id, tripId, name, address, lat, lng, placeId, excluded, note) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL)"
  ).run(id, tripId, name, address ?? null, lat ?? null, lng ?? null);

  const location = getDb().prepare("SELECT * FROM Location WHERE id = ?").get(id);
  return NextResponse.json(location, { status: 201 });
}
