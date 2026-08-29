/**
 * `types/index.ts` derivation-helper tests (ADR-0028). Standalone (no test runner): run with
 * `tsx src/types/index.test.ts`.
 */

import assert from "node:assert/strict";
import { tripEdgesOf } from "./index";
import type { Transit, TripWithDetails } from "./index";

const transit = (
  id: string,
  arriveAt: string | null,
  departAt: string | null,
): Transit =>
  ({
    id,
    tripId: "t1",
    name: id,
    address: null,
    lat: null,
    lng: null,
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
    kind: "transit",
    authored: true,
    arriveAt,
    departAt,
  }) as unknown as Transit;

const trip = (locations: TripWithDetails["locations"]): TripWithDetails => ({
  id: "t1",
  name: "Trip",
  sourceUrl: null,
  startDate: "2026-09-01",
  endDate: "2026-09-05",
  dayLabels: null,
  roadProfile: "walking",
  transitCaveatDismissed: false,
  hasJrPass: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  locations,
  placements: [],
  journeyRoadKinds: [],
});

// ── tripEdgesOf: the one place "the Trip's two edges" is looked up (ADR-0028) ───────────────────

{
  const arrival = transit("airport-in", "2026-09-01T10:00:00", null);
  const departure = transit("airport-out", null, "2026-09-05T18:00:00");
  const edges = tripEdgesOf(trip([arrival, departure]));
  assert.equal(edges.arrival?.id, "airport-in");
  assert.equal(edges.departure?.id, "airport-out");
}

{
  // The round-trip-through-one-airport case: one Location carries both arriveAt and departAt.
  const airport = transit(
    "airport",
    "2026-09-01T10:00:00",
    "2026-09-05T18:00:00",
  );
  const edges = tripEdgesOf(trip([airport]));
  assert.equal(edges.arrival?.id, "airport");
  assert.equal(edges.departure?.id, "airport");
  assert.equal(
    edges.arrival,
    edges.departure,
    "the same Location answers both when it carries both",
  );
}

{
  const edges = tripEdgesOf(trip([]));
  assert.equal(edges.arrival, null, "no arrival designated");
  assert.equal(edges.departure, null, "no departure designated");
}

console.log("types/index.test.ts: all assertions passed");
