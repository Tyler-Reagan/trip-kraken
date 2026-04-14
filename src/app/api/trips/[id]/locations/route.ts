import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";
import { findPlaceFromText } from "@/lib/places";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { name, address, lat, lng, placeId, rating, reviewCount, categories, hintLat, hintLng } = body;

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

  // Tabelog locations arrive without coordinates. Attempt a Text Search geocode
  // using the anchor's coordinates as a geographic bias (hintLat/hintLng) so
  // common restaurant names resolve to the right area. Falls back silently —
  // the location is created with null coords if geocoding fails; the Enrich
  // button handles the full enrichment pass later.
  let resolvedLat: number | null = lat ?? null;
  let resolvedLng: number | null = lng ?? null;
  if (typeof placeId === "string" && placeId.startsWith("tabelog:") && (resolvedLat === null || resolvedLng === null)) {
    const hint = typeof hintLat === "number" && typeof hintLng === "number"
      ? { lat: hintLat as number, lng: hintLng as number }
      : null;
    // Use a 5 km bias radius — the anchor is a hotel, not the restaurant itself,
    // so a tight radius (100 m) would miss most results in the same neighbourhood.
    const found = await findPlaceFromText(name, hint?.lat ?? null, hint?.lng ?? null, 5000);
    if (found) {
      resolvedLat = found.lat;
      resolvedLng = found.lng;
    }
  }

  const id = newId();
  getDb().prepare(
    "INSERT INTO Location (id, tripId, name, address, lat, lng, placeId, excluded, note, rating, reviewCount, categories) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)"
  ).run(
    id, tripId, name, address ?? null, resolvedLat, resolvedLng, placeId ?? null,
    rating ?? null, reviewCount ?? null,
    categories ? JSON.stringify(categories) : null
  );

  const location = getDb().prepare("SELECT * FROM Location WHERE id = ?").get(id);
  return NextResponse.json(location, { status: 201 });
}
