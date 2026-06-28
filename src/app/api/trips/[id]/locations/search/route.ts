import { NextRequest, NextResponse } from "next/server";
import { tripExists } from "@/lib/db";
import { searchText } from "@/lib/places";
import type { NearbyPlace } from "@/types";

/**
 * Unanchored Places text search (ADR-0009 / ADR-0010 blank-slate). Unlike the
 * anchored .../locations/[locationId]/nearby route, there is no reference
 * Location — results are seeded purely from the query.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;

  if (!tripExists(tripId)) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10));

  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  try {
    const places = await searchText(q, { limit });

    // Rank by rating quality + review depth (no anchor distance to weigh).
    function scorePlace(p: NearbyPlace): number {
      const ratingScore = p.rating !== null ? (p.rating / 5) * 60 : 0;
      const reviewBonus = p.reviewCount !== null ? Math.min(p.reviewCount / 1000, 1) * 20 : 0;
      return ratingScore + reviewBonus;
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
