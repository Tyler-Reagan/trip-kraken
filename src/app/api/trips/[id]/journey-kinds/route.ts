import { NextRequest, NextResponse } from "next/server";
import { setJourneyRoadKind } from "@/lib/db";
import type { RoadProfile } from "@/types/path";

/**
 * Set or clear a Journey's chosen road kind (issue #217, renamed from `/leg-pins` #223 — see
 * `schema.ts`'s `journeyRoadKind` for why "pin"/"leg" are wrong here) — a rider's choice that
 * overrides the Trip-wide `roadProfile` default for one Journey, consulted at matrix-build time
 * (#218). A Journey is addressed by its Location pair, not by an id: Paths are never persisted and
 * Placements are wholesale-replaced by every re-optimize (ADR-0015), so neither is a safe key.
 * Body: { fromLocationId, toLocationId, kind: "walking" | "driving" | null }. `kind: null` clears
 * the choice, returning the Journey to the Trip default.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { fromLocationId, toLocationId, kind } = body;

  if (typeof fromLocationId !== "string" || typeof toLocationId !== "string") {
    return NextResponse.json(
      { error: "fromLocationId and toLocationId are required" },
      { status: 400 },
    );
  }
  if (kind !== null && kind !== "walking" && kind !== "driving") {
    return NextResponse.json(
      { error: 'kind must be "walking", "driving", or null' },
      { status: 400 },
    );
  }

  const trip = await setJourneyRoadKind(
    tripId,
    fromLocationId,
    toLocationId,
    kind as RoadProfile | null,
  );
  return NextResponse.json(trip);
}
