import { NextRequest, NextResponse } from "next/server";
import { getLocationCoords, getTripWithDetails } from "@/lib/db";
import { getDiscoveryProvider, modeForScope, scoreAndSort } from "@/lib/discovery";
import { computeRoutePolyline } from "@/lib/googleRoutesProvider";
import { describeJourney } from "@/lib/travelCostRegistry";
import { encodePolyline } from "@/lib/polyline";
import type { Path, PathKind } from "@/types/path";
import type { Point } from "@/lib/geo";

/**
 * Flattens a Journey's decomposed Paths (`describeJourney`) into one ordered coordinate list —
 * unlike the map's honest dashed rendering (ADR-0030 §9), this only biases a Places search, so a
 * gap between spans (or a walking Path, which never carries geometry) is bridged with a straight
 * line rather than left absent.
 */
function flattenPathGeometry(paths: Path[]): Point[] {
  const coords: Point[] = [];
  const push = (pt: Point) => {
    const last = coords[coords.length - 1];
    if (!last || last.lat !== pt.lat || last.lng !== pt.lng) coords.push(pt);
  };
  for (const path of paths) {
    if (path.geometry?.length) {
      for (const span of path.geometry) {
        for (const [lng, lat] of span.coordinates) push({ lat, lng });
      }
    } else {
      push(path.from);
      push(path.to);
    }
  }
  return coords;
}

/**
 * The OSM-Japan rail corridor (#106). `describeJourney` (`travelCostRegistry.ts`) already gates
 * on region + graph-file presence via the registry's `osm-japan` entry and falls through to
 * `haversine` (terminal) when it declines — so no `inJapan` check is duplicated here, just a
 * check of which provider actually answered. Requiring at least one real rail span (not just an
 * `osm-japan` answer) matters because a walk-only Journey (steps.length === 0) still answers
 * `osm-japan` with a single straight-line walking Path — no better a corridor than Google's own
 * fallback below, which at least follows real roads.
 */
async function japanRailCorridorPolyline(from: Point, to: Point): Promise<string | null> {
  const paths = await describeJourney(from, to, ["rail"]);
  if (!paths?.length || paths[0].travelCost.answeredBy !== "osm-japan") return null;
  if (!paths.some((p) => p.kind === "rail" && p.geometry?.length)) return null;
  const coords = flattenPathGeometry(paths);
  return coords.length >= 2 ? encodePolyline(coords) : null;
}

/**
 * The discovery corridor for a Path. Tries the OSM-Japan rail corridor first (#106); when that
 * doesn't apply (non-Japan, or a leg the graph can't route), falls back to the trip's actual
 * primary kind, then walking, then driving, taking the first kind Google returns a route for.
 *
 * Keeping the trip's kind first preserves a real transit corridor where Google provides one (the
 * US/EU). It notably does NOT in Japan — the Routes API has no Japan transit data at all, which is
 * exactly why this repo carries its own OSM-Japan transit graph (ADR-0019) for *routing*, and now
 * also for this corridor. ADR-0009 leaves polyline computation to the caller; this is that caller
 * policy. Returns null only when no kind yields a corridor.
 */
async function corridorPolyline(from: Point, to: Point, primary: PathKind): Promise<string | null> {
  const japan = await japanRailCorridorPolyline(from, to);
  if (japan) return japan;

  const seen = new Set<PathKind>();
  for (const kind of [primary, "walking", "driving"] as PathKind[]) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    const polyline = await computeRoutePolyline(from, to, kind);
    if (polyline) return polyline;
  }
  return null;
}

/**
 * Along-route Places discovery (#102, chunk 3): a free-text query scoped to the
 * corridor between two of the trip's Locations. Computes the Path's polyline via the
 * Routes API, then delegates to the discovery provider's route scope — the polyline
 * is a per-request derivation, not persisted (a caller searching several categories
 * on the same Path would reuse it client-side across calls, per #102).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const trip = await getTripWithDetails(tripId);
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

  const from = await getLocationCoords(tripId, fromId);
  const to = await getLocationCoords(tripId, toId);
  if (!from || !to) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }
  if (from.lat === null || from.lng === null || to.lat === null || to.lng === null) {
    return NextResponse.json({ error: "Both locations must have coordinates" }, { status: 400 });
  }

  const provider = getDiscoveryProvider("google");
  if (!provider?.modes.includes(modeForScope({ kind: "route", polyline: "", origin: { lat: 0, lng: 0 } }))) {
    return NextResponse.json({ error: "Along-route discovery unavailable" }, { status: 500 });
  }

  try {
    const polyline = await corridorPolyline(
      { lat: from.lat, lng: from.lng },
      { lat: to.lat, lng: to.lng },
      // Was resolvePrimaryPathKind(trip.allowedPathKinds) — that column is deleted (ADR-0024) and
      // always resolved to "rail" in practice anyway (no UI ever set it), so this is
      // behaviour-identical.
      "rail"
    );
    if (!polyline) {
      return NextResponse.json({ error: "No route between these stops" }, { status: 422 });
    }
    const places = await provider.search({
      query: q,
      scope: { kind: "route", polyline, origin: { lat: from.lat, lng: from.lng } },
      limit,
      openNow,
    });
    return NextResponse.json(scoreAndSort(places));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
