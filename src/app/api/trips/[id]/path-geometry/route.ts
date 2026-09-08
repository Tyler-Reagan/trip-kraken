import { NextRequest, NextResponse } from "next/server";
import { getTripWithDetails } from "@/lib/db";
import { parsePairs, MAX_PAIRS } from "@/lib/pathGeometryRequest";
import { resolvePathGeometryBatch } from "@/lib/resolvePathGeometryBatch";

/**
 * Real Path geometry for the map canvas, trip-addressed. The registry-dispatch narrative (which
 * provider answers what, and why the `kinds` list is `["rail", trip.roadProfile]`) lives in
 * `resolvePathGeometryBatch` (`src/lib/resolvePathGeometryBatch.ts`) — this route's own job is
 * just: look the Trip up, pull `roadProfile`/`journeyRoadKinds` off it, and hand the rest to the
 * shared resolver. `src/app/api/path-geometry/route.ts` is the trip-less sibling (ADR-0043), for a
 * client whose trips aren't rows in this database at all.
 *
 * POST rather than GET because the pair list does not fit comfortably in a URL; it reads state and
 * changes none.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tripId } = await params;

  const trip = await getTripWithDetails(tripId);
  if (!trip)
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const pairs = parsePairs((body as { pairs?: unknown })?.pairs);
  if (!pairs)
    return NextResponse.json(
      { error: "pairs must be an array of {from,to} coordinates" },
      { status: 400 },
    );
  if (pairs.length > MAX_PAIRS) {
    return NextResponse.json(
      { error: `pairs exceeds the ${MAX_PAIRS} maximum` },
      { status: 400 },
    );
  }

  const { results, retry } = await resolvePathGeometryBatch(
    pairs,
    trip.roadProfile,
    trip.journeyRoadKinds,
  );
  return NextResponse.json({ results, retry });
}
