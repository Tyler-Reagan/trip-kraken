import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { searchNearby } from "@/lib/places";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: tripId, locationId } = await params;

  type LocRow = { lat: number | null; lng: number | null };
  const loc = getDb()
    .prepare("SELECT lat, lng FROM Location WHERE id = ? AND tripId = ?")
    .get(locationId, tripId) as LocRow | undefined;

  if (!loc) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  if (loc.lat === null || loc.lng === null) {
    return NextResponse.json({ error: "Location has no coordinates" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const radius = Math.max(1, parseInt(searchParams.get("radius") ?? "1000", 10));
  const keyword = searchParams.get("keyword") ?? undefined;
  const type = searchParams.get("type") ?? undefined;
  const limit = Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10));

  try {
    const places = await searchNearby(loc.lat, loc.lng, { radius, keyword, type, limit });
    return NextResponse.json(places);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
