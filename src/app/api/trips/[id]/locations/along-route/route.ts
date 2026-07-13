import { NextRequest, NextResponse } from "next/server";
import { getLocationCoords, getTripWithDetails } from "@/lib/db";
import { getDiscoveryProvider, modeForScope, scoreAndSort } from "@/lib/discovery";
import { computeRoutePolyline } from "@/lib/googleRoutesProvider";
import { resolvePrimaryMode } from "@/lib/travelMode";

/**
 * Along-route Places discovery (#102, chunk 3): a free-text query scoped to the
 * corridor between two of the trip's Locations. Computes the leg's polyline via the
 * Routes API, then delegates to the discovery provider's route scope — the polyline
 * is a per-request derivation, not persisted (a caller searching several categories
 * on the same leg would reuse it client-side across calls, per #102).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const trip = getTripWithDetails(tripId);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const fromId = searchParams.get("from");
  const toId = searchParams.get("to");
  const limit = Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10));
  const openNow = searchParams.get("openNow") === "true";

  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  if (!fromId || !toId) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  const from = getLocationCoords(tripId, fromId);
  const to = getLocationCoords(tripId, toId);
  if (!from || !to) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }
  if (from.lat === null || from.lng === null || to.lat === null || to.lng === null) {
    return NextResponse.json({ error: "Both locations must have coordinates" }, { status: 400 });
  }

  const provider = getDiscoveryProvider("google");
  if (!provider?.modes.includes(modeForScope({ kind: "route", polyline: "" }))) {
    return NextResponse.json({ error: "Along-route discovery unavailable" }, { status: 500 });
  }

  try {
    const mode = resolvePrimaryMode(trip.allowedModes);
    const polyline = await computeRoutePolyline(
      { lat: from.lat, lng: from.lng },
      { lat: to.lat, lng: to.lng },
      mode
    );
    const places = await provider.search({ query: q, scope: { kind: "route", polyline }, limit, openNow });
    return NextResponse.json(scoreAndSort(places));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
