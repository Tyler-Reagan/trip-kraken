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
  if (!(await tripExists(tripId))) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { dayBudgetHours } = body ?? {};

  try {
    const { trip, unplaced, warnings } = await optimizeTrip(tripId, {
      ...(typeof dayBudgetHours === "number" && dayBudgetHours > 0 ? { dayBudgetHours } : {}),
    });
    // unplaced (ADR-0023 §7) and warnings (#152) ride along on the response — #120's Unassigned
    // tray reads unplaced to show why an Activity has no Placement; OptimizeModal reads warnings.
    return NextResponse.json({ ...trip, unplaced, warnings });
  } catch (err) {
    // A selected provider's error propagates by design (ADR-0018 §4) — e.g. a missing ingested
    // transit graph. Return it as a structured 500 so the client can surface a real message
    // instead of an opaque failure the UI would otherwise swallow.
    const message = err instanceof Error ? err.message : "Optimization failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
