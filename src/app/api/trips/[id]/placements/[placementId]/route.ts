import { NextRequest, NextResponse } from "next/server";
import { getTripWithDetails, removePlacement } from "@/lib/db";
import { describeJourney } from "@/lib/travelCostRegistry";
import { findHealablePair, healKinds } from "@/lib/selfHeal";
import type { HealedPair } from "@/types/path";

/**
 * Unschedule an activity (ADR-0015): delete the placement; the Location stays a candidate.
 *
 * Self-heals the gap (ADR-0026, #171): when removal makes two activity Placements newly adjacent,
 * their travel cost is fetched with one on-demand `describeJourney` lookup and returned alongside
 * the removal — never a re-sequence of the Day, never a retained matrix (§1/§2). Read `before` the
 * delete: `removePlacement` never renumbers the Placements it leaves behind, so the removed row's
 * own `date`/`order` — gone the instant it's deleted — is the only way to know which two remaining
 * Placements it stood between.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; placementId: string }> }
) {
  const { id: tripId, placementId } = await params;

  const before = getTripWithDetails(tripId);
  const pair = before ? findHealablePair(before, placementId) : null;

  removePlacement(tripId, placementId);

  if (!pair || !before) return NextResponse.json({ healedPair: null });

  // §3: `google` declines a cell it cannot answer rather than throwing (ADR-0018's 2026-08-12
  // amendment) — self-heal runs immediately after the user's own corrective action, so a throw
  // here would be worse than one during optimize. The registry's decline chain guarantees a
  // haversine answer at worst, visibly stamped `basisOfCost: straightLine` — nothing here needs
  // its own try/catch.
  const paths = await describeJourney(pair.from, pair.to, healKinds(before), {
    departureTime: new Date(`${pair.date}T09:00:00`),
  });
  const travelCost = paths?.[0]?.travelCost;

  const healedPair: HealedPair | null = travelCost
    ? { fromLocationId: pair.from.locationId, toLocationId: pair.to.locationId, travelCost }
    : null;

  return NextResponse.json({ healedPair });
}
