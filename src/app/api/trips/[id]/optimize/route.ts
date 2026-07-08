import { NextRequest, NextResponse } from "next/server";
import { tripExists } from "@/lib/db";
import { optimizeTrip } from "@/lib/optimize";

/**
 * Re-optimize the trip's plan wholesale (ADR-0015). The day count and dates derive from the trip's
 * required date range — only the soft solver knobs come from the body. The plan is replaced, not
 * diffed; there is no locking to honor.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  if (!tripExists(tripId)) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { dayBudgetHours } = body ?? {};

  const { trip, feasibilityViolations } = await optimizeTrip(tripId, {
    ...(typeof dayBudgetHours === "number" && dayBudgetHours > 0 ? { dayBudgetHours } : {}),
  });
  // feasibilityViolations (ADR-0017) rides along on the response; no UI reads it yet.
  return NextResponse.json({ ...trip, feasibilityViolations });
}
