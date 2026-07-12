/**
 * Unit test for the discovery provider layer (ADR-0009). Standalone: run with
 * `tsx src/lib/discovery.test.ts`. Covers the registry, declared modes/applicability,
 * and ranking — all pure, so no network or API key is touched.
 */

import assert from "node:assert/strict";
import type { NearbyPlace } from "@/types";
import { getDiscoveryProvider, listDiscoveryProviders, scoreAndSort } from "@/lib/discovery";

// ── Registry ──
assert.equal(getDiscoveryProvider("google")?.id, "google", "google resolves");
assert.equal(getDiscoveryProvider("nope"), undefined, "unknown source → undefined");
assert.deepEqual(
  listDiscoveryProviders().map((p) => p.id).sort(),
  ["google"],
  "registry lists the google provider"
);

// ── Declared modes ──
const google = getDiscoveryProvider("google")!;
assert.deepEqual([...google.modes].sort(), ["anchored", "unanchored"], "google serves both modes");
assert.ok(google.searchAnchored && google.searchUnanchored, "google implements both methods");

// ── Applicability ──
assert.equal(google.appliesAt(48.85, 2.35), true, "google applies anywhere (Paris)");

// ── Ranking ──
function place(over: Partial<NearbyPlace>): NearbyPlace {
  return {
    placeId: "x", name: "x", address: "", lat: null, lng: null,
    rating: null, reviewCount: null, categories: [], priceLevel: null, distanceMeters: null,
    ...over,
  };
}
const ranked = scoreAndSort([
  place({ placeId: "low",  rating: 3.0, reviewCount: 10 }),
  place({ placeId: "high", rating: 4.8, reviewCount: 5000 }),
]);
assert.deepEqual(ranked.map((p) => p.placeId), ["high", "low"], "higher rating + reviews ranks first");

// Diversity bonus lifts a place whose category is new to the day.
const dayCats = new Set(["restaurant"]);
const diverse = scoreAndSort([
  place({ placeId: "same",  rating: 4.0, categories: ["restaurant"] }),
  place({ placeId: "novel", rating: 4.0, categories: ["museum"] }),
], dayCats);
assert.deepEqual(diverse.map((p) => p.placeId), ["novel", "same"], "novel category gets the diversity bonus");

console.log("✓ discovery.test.ts passed");
