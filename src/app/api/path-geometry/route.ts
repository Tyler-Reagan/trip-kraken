import { NextRequest, NextResponse } from "next/server";
import { parsePairs, MAX_PAIRS } from "@/lib/pathGeometryRequest";
import { resolvePathGeometryBatch } from "@/lib/resolvePathGeometryBatch";
import type { RoadProfile } from "@/types/path";
import type { JourneyRoadKind } from "@/types";

/**
 * ADR-0043: a trip-less sibling of `/api/trips/[id]/path-geometry`. The Swift client's trips live
 * entirely in local SwiftData (ADR-0040) and are never rows in this server's database, so the
 * trip-scoped route's `getTripWithDetails` lookup has nothing to find for them and hard-404s. This
 * route needs only the two fields that route actually reads off the Trip —
 * `roadProfile`/`journeyRoadKinds` — supplied directly in the body instead of looked up. Everything
 * else (registry dispatch, the `["rail", roadProfile]` kinds list, the retry-index contract) is
 * identical, via the shared `resolvePathGeometryBatch`.
 *
 * Not authenticated any differently than the trip-scoped route — this reveals no Trip data of its
 * own, only whatever road/rail geometry the caller's own coordinates resolve to.
 */

function parseRoadProfile(value: unknown): RoadProfile | null {
  return value === "walking" || value === "driving" ? value : null;
}

function parseJourneyRoadKinds(value: unknown): JourneyRoadKind[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const kinds: JourneyRoadKind[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const { id, tripId, locationAId, locationBId, kind } = entry as Record<
      string,
      unknown
    >;
    if (
      typeof id !== "string" ||
      typeof tripId !== "string" ||
      typeof locationAId !== "string" ||
      typeof locationBId !== "string" ||
      (kind !== "walking" && kind !== "driving")
    ) {
      return null;
    }
    kinds.push({ id, tripId, locationAId, locationBId, kind });
  }
  return kinds;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const {
    pairs: pairsInput,
    roadProfile: roadProfileInput,
    journeyRoadKinds: kindsInput,
  } = (body ?? {}) as {
    pairs?: unknown;
    roadProfile?: unknown;
    journeyRoadKinds?: unknown;
  };

  const pairs = parsePairs(pairsInput);
  if (!pairs)
    return NextResponse.json(
      { error: "pairs must be an array of {from,to} coordinates" },
      { status: 400 },
    );
  if (pairs.length > MAX_PAIRS)
    return NextResponse.json(
      { error: `pairs exceeds the ${MAX_PAIRS} maximum` },
      { status: 400 },
    );

  const roadProfile = parseRoadProfile(roadProfileInput);
  if (!roadProfile)
    return NextResponse.json(
      { error: 'roadProfile must be "walking" or "driving"' },
      { status: 400 },
    );

  const journeyRoadKinds = parseJourneyRoadKinds(kindsInput);
  if (!journeyRoadKinds)
    return NextResponse.json(
      { error: "journeyRoadKinds must be an array of JourneyRoadKind" },
      { status: 400 },
    );

  const { results, retry } = await resolvePathGeometryBatch(
    pairs,
    roadProfile,
    journeyRoadKinds,
  );
  return NextResponse.json({ results, retry });
}
