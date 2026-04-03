import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { name, address, lat, lng, placeId, rating, reviewCount, categories } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (placeId) {
    const existing = getDb()
      .prepare("SELECT id FROM Location WHERE tripId = ? AND placeId = ?")
      .get(tripId, placeId);
    if (existing) {
      return NextResponse.json({ error: "Already in trip" }, { status: 409 });
    }
  }

  const id = newId();
  getDb().prepare(
    "INSERT INTO Location (id, tripId, name, address, lat, lng, placeId, excluded, note, rating, reviewCount, categories) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)"
  ).run(
    id, tripId, name, address ?? null, lat ?? null, lng ?? null, placeId ?? null,
    rating ?? null, reviewCount ?? null,
    categories ? JSON.stringify(categories) : null
  );

  const location = getDb().prepare("SELECT * FROM Location WHERE id = ?").get(id);
  return NextResponse.json(location, { status: 201 });
}
