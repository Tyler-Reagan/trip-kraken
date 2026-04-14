import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { searchNearby } from "@/lib/places";
import { searchTabelog } from "@/lib/tabelog";
import type { NearbyPlace } from "@/types";

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
  const radius  = Math.max(1, parseInt(searchParams.get("radius")  ?? "1000", 10));
  const keyword = searchParams.get("keyword") ?? undefined;
  const type    = searchParams.get("type")    ?? undefined;
  const limit   = Math.max(1, parseInt(searchParams.get("limit")   ?? "20", 10));
  const openNow = searchParams.get("openNow") === "true";
  const dayId   = searchParams.get("dayId")   ?? undefined;
  const source  = searchParams.get("source") === "tabelog" ? "tabelog" : "google";

  try {
    const places: NearbyPlace[] = source === "tabelog"
      ? await searchTabelog(loc.lat, loc.lng, { keyword, limit })
      : await searchNearby(loc.lat, loc.lng, { radius, keyword, type, limit, openNow });

    // Build category set for the target day (used for diversity scoring)
    const dayCategorySet = new Set<string>();
    if (dayId) {
      type CatRow = { categories: string | null };
      const rows = getDb().prepare(`
        SELECT l.categories
        FROM ItineraryStop s
        JOIN Location l ON l.id = s.locationId
        WHERE s.dayId = ?
      `).all(dayId) as CatRow[];
      for (const row of rows) {
        if (row.categories) {
          for (const cat of JSON.parse(row.categories) as string[]) {
            dayCategorySet.add(cat);
          }
        }
      }
    }

    // Score and sort: rating quality + review depth + category diversity bonus
    function scorePlace(p: NearbyPlace): number {
      const ratingScore    = p.rating    !== null ? (p.rating / 5) * 60              : 0;
      const reviewBonus    = p.reviewCount !== null ? Math.min(p.reviewCount / 1000, 1) * 20 : 0;
      const diversityBonus = dayCategorySet.size > 0 && p.categories.some((c) => !dayCategorySet.has(c)) ? 20 : 0;
      return ratingScore + reviewBonus + diversityBonus;
    }

    const scored = places
      .map((p) => ({ p, score: scorePlace(p) }))
      .sort((a, b) => b.score - a.score)
      .map(({ p }) => p);

    return NextResponse.json(scored);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
