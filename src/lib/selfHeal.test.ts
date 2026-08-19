/**
 * `findHealablePair` tests (ADR-0026, #171). Standalone (no test runner): run with
 * `tsx src/lib/selfHeal.test.ts`.
 */

import assert from "node:assert/strict";
import { findHealablePair, healKinds } from "./selfHeal";
import type { Activity, Lodging, Placement, TripWithDetails } from "@/types";

let n = 0;
const activity = (name: string, lat: number | null = 35 + n, lng: number | null = 139 + n): Activity => ({
  id: `a${n++}`,
  tripId: "t1",
  name,
  address: null,
  lat,
  lng,
  placeId: null,
  excluded: false,
  note: null,
  rating: null,
  reviewCount: null,
  categories: null,
  visitDuration: null,
  openTime: null,
  closeTime: null,
  hoursJson: null,
  phone: null,
  enrichmentStatus: "done",
  enrichmentError: null,
  kind: "activity",
});

const lodging = (): Lodging => ({ ...activity("Hotel"), kind: "lodging", checkInDate: "2026-09-01", checkOutDate: "2026-09-05" });

const place = (id: string, date: string, order: number): Placement => ({ id, tripId: "t1", locationId: id, date, order });

const trip = (locations: TripWithDetails["locations"], placements: Placement[]): TripWithDetails => ({
  id: "t1",
  name: "Test",
  sourceUrl: null,
  startDate: "2026-09-01",
  endDate: "2026-09-05",
  dayLabels: null,
  roadProfile: "walking",
  transitCaveatDismissed: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  locations,
  placements,
});

// Three activities in the middle of a Day: a1(0) a2(1) a3(2) — removing a2 heals a1↔a3.
{
  const [a1, a2, a3] = [activity("A1"), activity("A2"), activity("A3")];
  const t = trip([a1, a2, a3], [place(a1.id, "2026-09-01", 0), place(a2.id, "2026-09-01", 1), place(a3.id, "2026-09-01", 2)]);
  const pair = findHealablePair(t, a2.id);
  assert.ok(pair);
  assert.equal(pair!.from.locationId, a1.id);
  assert.equal(pair!.to.locationId, a3.id);
  assert.equal(pair!.date, "2026-09-01");
}

// Removing the first Placement in its Day: the new neighbor is the start Anchor, not a Placement —
// out of scope (ADR-0026 §4), null.
{
  const [a1, a2] = [activity("A1"), activity("A2")];
  const t = trip([a1, a2], [place(a1.id, "2026-09-01", 0), place(a2.id, "2026-09-01", 1)]);
  assert.equal(findHealablePair(t, a1.id), null, "no predecessor → nothing to heal");
}

// Removing the last Placement: same reasoning, the other direction.
{
  const [a1, a2] = [activity("A1"), activity("A2")];
  const t = trip([a1, a2], [place(a1.id, "2026-09-01", 0), place(a2.id, "2026-09-01", 1)]);
  assert.equal(findHealablePair(t, a2.id), null, "no successor → nothing to heal");
}

// The only Placement on its Day: neither a predecessor nor a successor.
{
  const a1 = activity("A1");
  const t = trip([a1], [place(a1.id, "2026-09-01", 0)]);
  assert.equal(findHealablePair(t, a1.id), null);
}

// order gaps from a PRIOR removal (ADR-0026 §1: removePlacement never renumbers) are navigated
// correctly — orders 0, 2, 5 here, not the contiguous 0/1/2 the other cases use.
{
  const [a1, a2, a3] = [activity("A1"), activity("A2"), activity("A3")];
  const t = trip([a1, a2, a3], [place(a1.id, "2026-09-01", 0), place(a2.id, "2026-09-01", 2), place(a3.id, "2026-09-01", 5)]);
  const pair = findHealablePair(t, a2.id);
  assert.equal(pair?.from.locationId, a1.id);
  assert.equal(pair?.to.locationId, a3.id);
}

// A lodging Placement (hypothetical — nothing in the app creates one, but the API layer doesn't
// forbid it either) never heals: ADR-0026 §4 scopes self-heal to activities only.
{
  const lodge = lodging();
  const a1 = activity("A1");
  const t = trip([lodge, a1], [place(lodge.id, "2026-09-01", 0), place(a1.id, "2026-09-01", 1)]);
  assert.equal(findHealablePair(t, lodge.id), null);
}

// Removing a Placement whose neighbor has no coordinates yet: nothing to look a route up between.
{
  const [a1, a2, a3] = [activity("A1", null, null), activity("A2"), activity("A3")];
  const t = trip([a1, a2, a3], [place(a1.id, "2026-09-01", 0), place(a2.id, "2026-09-01", 1), place(a3.id, "2026-09-01", 2)]);
  assert.equal(findHealablePair(t, a2.id), null, "ungeocoded neighbor → nothing to look up");
}

// A removal on one Day never reaches across to another Day's Placements.
{
  const [a1, a2, a3] = [activity("A1"), activity("A2"), activity("A3")];
  const t = trip(
    [a1, a2, a3],
    [place(a1.id, "2026-09-01", 0), place(a2.id, "2026-09-01", 1), place(a3.id, "2026-09-02", 0)]
  );
  assert.equal(findHealablePair(t, a2.id), null, "a2's only same-Day predecessor has no successor");
}

// A placement id that doesn't exist (already removed, or a stale client) → null, not a throw.
{
  const t = trip([], []);
  assert.equal(findHealablePair(t, "nope"), null);
}

// healKinds mirrors optimize.ts's own selection exactly — rail/bus always, the Trip's road profile.
{
  const t = trip([], []);
  assert.deepEqual(healKinds({ ...t, roadProfile: "driving" }), ["rail", "bus", "driving"]);
  assert.deepEqual(healKinds({ ...t, roadProfile: "walking" }), ["rail", "bus", "walking"]);
}

console.log("✓ selfHeal.test.ts passed");
