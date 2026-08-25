import { NextRequest, NextResponse } from "next/server";
import { setLegModePin } from "@/lib/db";
import type { RoadProfile } from "@/types/path";

/**
 * Set or clear a Location pair's mode pin (issue #217) — a manual override of the Trip-wide
 * `roadProfile` default for one leg, consulted at matrix-build time (#218). A pin is addressed by
 * its Location pair, not by an id: Paths are never persisted and Placements are wholesale-replaced
 * by every re-optimize (ADR-0015), so neither is a safe key. Body:
 * { fromLocationId, toLocationId, mode: "walking" | "driving" | null }. `mode: null` clears the pin.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { fromLocationId, toLocationId, mode } = body;

  if (typeof fromLocationId !== "string" || typeof toLocationId !== "string") {
    return NextResponse.json(
      { error: "fromLocationId and toLocationId are required" },
      { status: 400 }
    );
  }
  if (mode !== null && mode !== "walking" && mode !== "driving") {
    return NextResponse.json(
      { error: "mode must be \"walking\", \"driving\", or null" },
      { status: 400 }
    );
  }

  const trip = setLegModePin(tripId, fromLocationId, toLocationId, mode as RoadProfile | null);
  return NextResponse.json(trip);
}
