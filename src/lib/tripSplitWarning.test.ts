/**
 * `detectUncoveredSplit` tests. Standalone (no test runner): run with
 * `tsx src/lib/tripSplitWarning.test.ts`.
 */

import assert from "node:assert/strict";
import { detectUncoveredSplit } from "./tripSplitWarning";
import type { Activity, Lodging, TripWithDetails } from "@/types";

let n = 0;
const activity = (name: string, lat: number, lng: number, extra: Partial<Activity> = {}): Activity => ({
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
  ...extra,
});

const lodging = (name: string, lat: number, lng: number): Lodging => ({
  ...activity(name, lat, lng),
  kind: "lodging",
  checkInDate: "2026-09-01",
  checkOutDate: "2026-09-05",
});

const trip = (locations: TripWithDetails["locations"]): TripWithDetails => ({
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
  placements: [],
});

// Tokyo-ish cluster vs. an Osaka-ish cluster — ~400km apart, well past the 75km metro radius.
const TOKYO: [number, number] = [35.6812, 139.7671];
const OSAKA: [number, number] = [34.6937, 135.5023];

// ── a single metro, however wide, is not a split ──
{
  const t = trip([
    activity("Tokyo Tower", 35.6586, 139.7454),
    activity("Ueno Park", 35.7138, 139.7745),
    lodging("Hotel", ...TOKYO),
  ]);
  assert.equal(detectUncoveredSplit(t), null, "one cluster never warns, regardless of spread");
}

// ── two clusters, one with no covering lodging → warns, naming only the uncovered one ──
{
  const t = trip([
    activity("Tokyo Tower", ...TOKYO),
    activity("Osaka Castle", ...OSAKA, { address: "Osaka, 540-0002, Japan" }),
    lodging("Tokyo Hotel", ...TOKYO),
  ]);
  const result = detectUncoveredSplit(t);
  assert.ok(result);
  assert.equal(result!.length, 1, "only the uncovered cluster is reported");
  assert.equal(result![0].activityCount, 1);
}

// ── two clusters, both covered by a lodging → suppressed, a deliberate two-city trip is fine ──
{
  const t = trip([
    activity("Tokyo Tower", ...TOKYO),
    activity("Osaka Castle", ...OSAKA),
    lodging("Tokyo Hotel", ...TOKYO),
    lodging("Osaka Hotel", ...OSAKA),
  ]);
  assert.equal(detectUncoveredSplit(t), null, "every cluster explained by its own lodging → no warning");
}

// ── an excluded Activity never forms or breaks a cluster on its own ──
{
  const t = trip([
    activity("Tokyo Tower", ...TOKYO),
    activity("Osaka Castle", ...OSAKA, { excluded: true }),
    lodging("Tokyo Hotel", ...TOKYO),
  ]);
  assert.equal(detectUncoveredSplit(t), null, "an excluded Activity is not \"included\" — no second cluster to warn about");
}

// ── not yet geocoded → no cluster, no false split ──
{
  const t = trip([
    activity("Tokyo Tower", ...TOKYO),
    activity("Somewhere pending", 0, 0, { enrichmentStatus: "pending" }),
    lodging("Tokyo Hotel", ...TOKYO),
  ]);
  assert.equal(detectUncoveredSplit(t), null, "an ungeocoded Activity carries no geography to split on");
}

// ── no Activities at all → nothing to warn about ──
{
  assert.equal(detectUncoveredSplit(trip([lodging("Hotel", ...TOKYO)])), null);
}

console.log("✓ tripSplitWarning.test.ts passed");
