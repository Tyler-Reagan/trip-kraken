import { NextRequest, NextResponse } from "next/server";
import { getLocationCoords, getDayCategories } from "@/lib/db";
import { getDiscoveryProvider, scoreAndSort } from "@/lib/discovery";

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
  const type    = searchParams.get("type")    ?? undefined;
  const limit   = Math.max(1, parseInt(searchParams.get("limit")   ?? "20", 10));
  const openNow = searchParams.get("openNow") === "true";
  const date    = searchParams.get("date")    ?? undefined;
  const enrichAddresses = searchParams.get("enrichAddresses") === "true";
  const source  = searchParams.get("source") ?? "google";

  const provider = getDiscoveryProvider(source);
  if (!provider || !provider.modes.includes("anchored") || !provider.searchAnchored) {
    return NextResponse.json({ error: `Unknown discovery source: ${source}` }, { status: 400 });
  }
  // Regional providers (e.g. Tabelog outside Japan) don't serve this anchor → no results.
  if (!provider.appliesAt(loc.lat, loc.lng)) {
    return NextResponse.json([]);
  }

  try {
    const places = await provider.searchAnchored({
      lat: loc.lat, lng: loc.lng, radius, keyword, type, limit, openNow, enrichAddresses,
    });

    // Category set for the target day (diversity bonus in the ranking).
    const dayCategories = new Set<string>(date ? getDayCategories(tripId, date) : []);
    return NextResponse.json(scoreAndSort(places, dayCategories));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
