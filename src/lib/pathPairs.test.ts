/**
 * `pathPairs` tests (ADR-0029, #182). Standalone (no test runner): run with
 * `tsx src/lib/pathPairs.test.ts`.
 */

import assert from "node:assert/strict";
import { pairsOfDay, pairKey, uniquePairsOfDays, dayChainEntries, dayChainPairs, legModePinFor, withLegModePin } from "./pathPairs";
import type { PathPair } from "./pathPairs";
import type { Activity, DerivedDay, LegModePin, Lodging, Location, Placement, ScheduledStop } from "@/types";

const activity = (id: string, lat: number | null, lng: number | null): Activity => ({
  id,
  tripId: "t1",
  name: id,
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

const lodging = (id: string, lat: number, lng: number): Lodging => ({
  ...activity(id, lat, lng),
  kind: "lodging",
  checkIn: "2026-09-01",
  checkOut: "2026-09-03",
} as unknown as Lodging);

const placement = (locationId: string, order: number): Placement => ({
  id: `p-${locationId}`,
  tripId: "t1",
  locationId,
  date: "2026-09-01",
  order,
});

const stop = (loc: Activity, order: number): ScheduledStop => ({ placement: placement(loc.id, order), location: loc });

const day = (over: Partial<DerivedDay> = {}): DerivedDay => ({
  date: "2026-09-01",
  dayNumber: 1,
  label: null,
  stops: [],
  startAnchor: null,
  endAnchor: null,
  checkInWaypoint: null,
  ...over,
});

const shape = (pairs: PathPair[]) => pairs.map((p) => `${p.from.locationId}>${p.to.locationId}`);
const shapeLocPairs = (pairs: { from: Location; to: Location }[]) => pairs.map((p) => `${p.from.id}>${p.to.id}`);

// ── pairsOfDay: the chain's composition and order ────────────────────────────────────────────

{
  const d = day({
    startAnchor: lodging("hotel", 35.0, 139.0),
    stops: [stop(activity("a1", 35.1, 139.1), 1), stop(activity("a2", 35.2, 139.2), 2)],
    endAnchor: lodging("hotel", 35.0, 139.0),
  });
  assert.deepEqual(
    shape(pairsOfDay(d)),
    ["hotel>a1", "a1>a2", "a2>hotel"],
    "a normal Day chains start Anchor -> stops -> end Anchor"
  );
}

{
  // The check-in waypoint precedes the day's stops (ADR-0013 Phase 2) — bags are dropped on arrival.
  const d = day({
    startAnchor: lodging("old-hotel", 35.0, 139.0),
    checkInWaypoint: lodging("new-hotel", 35.5, 139.5),
    stops: [stop(activity("a1", 35.1, 139.1), 1)],
    endAnchor: lodging("new-hotel", 35.5, 139.5),
  });
  assert.deepEqual(
    shape(pairsOfDay(d)),
    ["old-hotel>new-hotel", "new-hotel>a1", "a1>new-hotel"],
    "the check-in waypoint sits between the start Anchor and the first stop"
  );
}

{
  const d = day({ stops: [stop(activity("a1", 35.1, 139.1), 1)] });
  assert.deepEqual(pairsOfDay(d), [], "one positioned entry and no Anchors yields no pairs");
}

{
  assert.deepEqual(pairsOfDay(day()), [], "an empty Day yields no pairs");
}

{
  // An ungeocoded Location drops out rather than breaking the chain — its neighbours become
  // adjacent, which is what the map drew before this module existed.
  const d = day({
    startAnchor: lodging("hotel", 35.0, 139.0),
    stops: [
      stop(activity("a1", 35.1, 139.1), 1),
      stop(activity("nowhere", null, null), 2),
      stop(activity("a2", 35.2, 139.2), 3),
    ],
  });
  assert.deepEqual(
    shape(pairsOfDay(d)),
    ["hotel>a1", "a1>a2"],
    "a stop with no coordinates is skipped and its neighbours join up"
  );
}

// ── pairKey: what invalidates a held answer ──────────────────────────────────────────────────

{
  const p: PathPair = { from: { lat: 35.0, lng: 139.0 }, to: { lat: 35.1, lng: 139.1 } };
  assert.equal(pairKey("walking", p, []), "walking:139.000000,35.000000>139.100000,35.100000");

  assert.notEqual(
    pairKey("walking", p, []),
    pairKey("driving", p, []),
    "the Road profile selects the OSRM graph, so it must key the answer"
  );

  const reversed: PathPair = { from: p.to, to: p.from };
  assert.notEqual(pairKey("walking", p, []), pairKey("walking", reversed, []), "direction is part of the pair");

  const moved: PathPair = { from: { lat: 35.0, lng: 139.0 }, to: { lat: 35.100001, lng: 139.1 } };
  assert.notEqual(pairKey("walking", p, []), pairKey("walking", moved, []), "a re-geocode invalidates by construction");

  const sameCoordsOtherLocation: PathPair = {
    from: { lat: 35.0, lng: 139.0, locationId: "x" },
    to: { lat: 35.1, lng: 139.1, locationId: "y" },
  };
  assert.equal(
    pairKey("walking", p, []),
    pairKey("walking", sameCoordsOtherLocation, []),
    "identity plays no part when neither carries a pin: two Locations at one point share an answer"
  );
}

{
  // Float arithmetic reaching the same point by a different route must produce the same key.
  const direct: PathPair = { from: { lat: 35.1, lng: 139.0 }, to: { lat: 35.2, lng: 139.0 } };
  const summed: PathPair = { from: { lat: 35.0 + 0.1, lng: 139.0 }, to: { lat: 0.1 + 35.1, lng: 139.0 } };
  assert.equal(pairKey("walking", direct, []), pairKey("walking", summed, []), "fixed precision absorbs float drift");
}

// A pin changes which kind answers this pair (#218), so it must key the held answer too (#223) —
// otherwise a pair fetched before a pin was set (or after it was cleared) keeps answering for it.
{
  const p: PathPair = {
    from: { lat: 35.0, lng: 139.0, locationId: "x" },
    to: { lat: 35.1, lng: 139.1, locationId: "y" },
  };
  const pin: LegModePin = { id: "pin1", tripId: "t1", locationAId: "x", locationBId: "y", mode: "driving" };

  assert.notEqual(pairKey("walking", p, [pin]), pairKey("walking", p, []), "pinning invalidates the unpinned answer");
  assert.ok(
    pairKey("walking", p, [pin]).endsWith(":driving") && pairKey("walking", { from: p.to, to: p.from }, [pin]).endsWith(":driving"),
    "a pin is unordered, so both directions of the same pair carry the same pin suffix (direction still keys the coordinates)"
  );

  const unrelatedPin: LegModePin = { id: "pin2", tripId: "t1", locationAId: "x", locationBId: "z", mode: "driving" };
  assert.equal(
    pairKey("walking", p, [unrelatedPin]),
    pairKey("walking", p, []),
    "a pin on a different pair doesn't affect this one's key"
  );

  const noLocationId: PathPair = { from: { lat: 35.0, lng: 139.0 }, to: { lat: 35.1, lng: 139.1 } };
  assert.equal(
    pairKey("walking", noLocationId, [pin]),
    pairKey("walking", noLocationId, []),
    "a pair with no locationId can't carry a pin, same as legModePinFor already requires"
  );
}

// ── withLegModePin: the one place a pin's effect on a base kinds list is decided ─────────────────

{
  // Not a substitution within the list — osm-japan never declines a cell within its reach, so
  // keeping "rail" alongside a pinned mode leaves the pin permanently outranked (#223). A pin
  // drops every other kind and asks for the pinned mode alone.
  const pin: LegModePin = { id: "pin1", tripId: "t1", locationAId: "a", locationBId: "b", mode: "driving" };
  assert.deepEqual(withLegModePin(["rail", "bus", "walking"], pin), ["driving"], "a pin excludes rail/bus entirely, not just the road element");
  assert.deepEqual(withLegModePin(["rail", "walking"], pin), ["driving"], "same, for a base list without bus");
  assert.deepEqual(withLegModePin(["rail", "bus", "walking"], undefined), ["rail", "bus", "walking"], "no pin, no change");
}

// ── uniquePairsOfDays: one lookup per distinct pair ──────────────────────────────────────────

{
  const hotel = lodging("hotel", 35.0, 139.0);
  const a1 = activity("a1", 35.1, 139.1);
  // Consecutive Days bookended by the same lodging share the hotel>a1 pair.
  const days = [
    day({ dayNumber: 1, startAnchor: hotel, stops: [stop(a1, 1)], endAnchor: hotel }),
    day({ dayNumber: 2, startAnchor: hotel, stops: [stop(a1, 1)], endAnchor: hotel }),
  ];
  assert.deepEqual(
    shape(uniquePairsOfDays(days, "walking", [])),
    ["hotel>a1", "a1>hotel"],
    "a pair shared across Days is looked up once"
  );
}

{
  const days = [
    day({ dayNumber: 1, startAnchor: lodging("h", 35.0, 139.0), stops: [stop(activity("a1", 35.1, 139.1), 1)] }),
    day({ dayNumber: 2, startAnchor: lodging("h", 35.0, 139.0), stops: [stop(activity("a2", 35.2, 139.2), 1)] }),
  ];
  assert.deepEqual(
    shape(uniquePairsOfDays(days, "walking", [])),
    ["h>a1", "h>a2"],
    "distinct pairs across Days are all kept, in first-seen order"
  );
}

assert.deepEqual(uniquePairsOfDays([], "walking", []), [], "a Trip with no Days needs no lookups");

// ── dayChainEntries / dayChainPairs: render-oriented chain, ungeocoded entries kept (ADR-0036) ──

{
  const d = day({
    startAnchor: lodging("hotel", 35.0, 139.0),
    stops: [stop(activity("a1", 35.1, 139.1), 1), stop(activity("a2", 35.2, 139.2), 2)],
    endAnchor: lodging("hotel", 35.0, 139.0),
  });
  assert.deepEqual(
    dayChainEntries(d).map((e) => e.role),
    ["start", "stop", "stop", "end"],
    "a normal Day's entries: start Anchor, stops, end Anchor"
  );
  assert.deepEqual(
    shapeLocPairs(dayChainPairs(d)),
    ["hotel>a1", "a1>a2", "a2>hotel"],
    "and the same pairs pairsOfDay would produce, in Location form"
  );
}

{
  // Regression: the bug found live on a real trip — a Day with only anchors and no stops got zero
  // connectors anywhere, because every connector was hand-gated on `stops.length > 0`. This is
  // exactly the case dayChainPairs must get right by construction.
  const d = day({
    startAnchor: lodging("narita", 35.0, 139.0),
    checkInWaypoint: lodging("hotel", 35.5, 139.5),
  });
  assert.deepEqual(
    shapeLocPairs(dayChainPairs(d)),
    ["narita>hotel"],
    "a Day with only a start Anchor and a check-in waypoint still gets one connector between them"
  );
}

{
  const d = day({
    startAnchor: lodging("narita", 35.0, 139.0),
    checkInWaypoint: lodging("hotel", 35.5, 139.5),
    endAnchor: lodging("hotel", 35.5, 139.5),
  });
  assert.deepEqual(
    shapeLocPairs(dayChainPairs(d)),
    ["narita>hotel", "hotel>hotel"],
    "all three anchor kinds with no stops still gets both connectors, start->checkin and checkin->end"
  );
}

{
  // Stops present: dayChainPairs must agree with pairsOfDay's existing, already-correct behavior.
  const d = day({
    startAnchor: lodging("old-hotel", 35.0, 139.0),
    checkInWaypoint: lodging("new-hotel", 35.5, 139.5),
    stops: [stop(activity("a1", 35.1, 139.1), 1)],
    endAnchor: lodging("new-hotel", 35.5, 139.5),
  });
  assert.deepEqual(
    shapeLocPairs(dayChainPairs(d)),
    ["old-hotel>new-hotel", "new-hotel>a1", "a1>new-hotel"],
    "with stops present, dayChainPairs matches pairsOfDay's existing ordering"
  );
}

{
  // Unlike chainOfDay (which pairsOfDay/uniquePairsOfDays rely on for routing requests),
  // dayChainEntries/dayChainPairs keep an ungeocoded stop — a render surface still owes it a
  // (disabled) row, and the connectors either side of it are still real gaps to ask about; only
  // the coordinate-keyed routing side needs to skip what it can't key.
  const d = day({
    startAnchor: lodging("hotel", 35.0, 139.0),
    stops: [stop(activity("nowhere", null, null), 1)],
  });
  assert.deepEqual(
    dayChainEntries(d).map((e) => e.role),
    ["start", "stop"],
    "an ungeocoded stop is still an entry"
  );
  assert.deepEqual(
    shapeLocPairs(dayChainPairs(d)),
    ["hotel>nowhere"],
    "and still produces a pair — the row/connector's own lat===null guard is what suppresses rendering, not the pairing rule"
  );
}

// ── legModePinFor: the read-side mirror of db/index.ts's canonicalPinPair (#217/#219) ────────────

{
  const pins: LegModePin[] = [{ id: "pin1", tripId: "t1", locationAId: "a", locationBId: "b", mode: "driving" }];
  assert.equal(legModePinFor(pins, "a", "b")?.mode, "driving", "found in stored order");
  assert.equal(legModePinFor(pins, "b", "a")?.mode, "driving", "found in reversed order — a pin is unordered");
  assert.equal(legModePinFor(pins, "a", "c"), undefined, "no pin for an unrelated pair");
  assert.equal(legModePinFor([], "a", "b"), undefined, "no pins at all");
}

console.log("pathPairs.test.ts: all assertions passed");
