import { NextRequest, NextResponse } from "next/server";
import { tripExists } from "@/lib/db";
import { getDiscoveryProvider, scoreAndSort } from "@/lib/discovery";

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

  // Google is the canonical unanchored provider (ADR-0009).
  const provider = getDiscoveryProvider("google");
  if (!provider?.searchUnanchored) {
    return NextResponse.json({ error: "Unanchored discovery unavailable" }, { status: 500 });
  }

  try {
    const places = await provider.searchUnanchored({ query: q, limit });
    // Rank by rating + review depth (no anchor → no diversity bonus).
    return NextResponse.json(scoreAndSort(places));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
