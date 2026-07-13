import { NextRequest, NextResponse } from "next/server";
import { getLocationCoords, getDayCategories } from "@/lib/db";
import { getDiscoveryProvider, modeForScope, scoreAndSort } from "@/lib/discovery";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: tripId, locationId } = await params;

  const loc = getLocationCoords(tripId, locationId);

  if (!loc) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  if (loc.lat === null || loc.lng === null) {
    return NextResponse.json({ error: "Location has no coordinates" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const radius  = Math.max(1, parseInt(searchParams.get("radius")  ?? "1000", 10));
  const keyword = searchParams.get("keyword") ?? undefined;
  const limit   = Math.max(1, parseInt(searchParams.get("limit")   ?? "20", 10));
  const openNow = searchParams.get("openNow") === "true";
  const date    = searchParams.get("date")    ?? undefined;
  const source  = searchParams.get("source") ?? "google";

  const scope = { kind: "anchor", lat: loc.lat, lng: loc.lng, radius } as const;

  const provider = getDiscoveryProvider(source);
  if (!provider || !provider.modes.includes(modeForScope(scope))) {
    return NextResponse.json({ error: `Unknown discovery source: ${source}` }, { status: 400 });
  }
  // A regional provider that doesn't serve this anchor → no results.
  if (!provider.applies(scope)) {
    return NextResponse.json([]);
  }

  try {
    const places = await provider.search({ query: keyword, scope, limit, openNow });

    // Category set for the target day (diversity bonus in the ranking).
    const dayCategories = new Set<string>(date ? getDayCategories(tripId, date) : []);
    return NextResponse.json(scoreAndSort(places, dayCategories));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
