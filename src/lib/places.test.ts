/**
 * Unit test for searchText (ADR-0009 unanchored discovery). Standalone (no test runner):
 * run with `tsx src/lib/places.test.ts`. Mocks global.fetch — no network or API key needed.
 */

import assert from "node:assert/strict";
import { searchText } from "@/lib/places";

process.env.GOOGLE_MAPS_API_KEY = "test-key";

const originalFetch = global.fetch;

function mockFetch(body: unknown, ok = true, status = 200) {
  global.fetch = (async () =>
    ({ ok, status, json: async () => body }) as Response) as typeof fetch;
}

async function main() {
// ── Mapping: Text Search fields (formatted_address) project onto NearbyPlace ──
mockFetch({
  status: "OK",
  results: [
    {
      place_id: "place-1",
      name: "Senso-ji",
      formatted_address: "2 Chome-3-1 Asakusa, Tokyo",
      geometry: { location: { lat: 35.71, lng: 139.79 } },
      rating: 4.5,
      user_ratings_total: 1200,
      types: ["tourist_attraction", "point_of_interest", "establishment"],
      price_level: 0,
    },
  ],
});

const results = await searchText("Senso-ji Tokyo");
assert.equal(results.length, 1, "one result mapped");
const r = results[0];
assert.equal(r.placeId, "place-1", "placeId mapped");
assert.equal(r.name, "Senso-ji", "name mapped");
assert.equal(r.address, "2 Chome-3-1 Asakusa, Tokyo", "formatted_address → address");
assert.deepEqual([r.lat, r.lng], [35.71, 139.79], "coordinates mapped");
assert.equal(r.rating, 4.5, "rating mapped");
assert.equal(r.reviewCount, 1200, "reviewCount mapped");
assert.deepEqual(r.categories, ["tourist_attraction"], "generic place types stripped");
assert.equal(r.distanceMeters, null, "unanchored → no distance");

// ── ZERO_RESULTS yields an empty list, not a throw ──
mockFetch({ status: "ZERO_RESULTS", results: [] });
assert.deepEqual(await searchText("asdfqwerty nowhere"), [], "ZERO_RESULTS → empty list");

// ── REQUEST_DENIED throws (surfaces a key/config problem) ──
mockFetch({ status: "REQUEST_DENIED", error_message: "bad key", results: [] });
await assert.rejects(() => searchText("x"), /bad key/, "REQUEST_DENIED throws");

global.fetch = originalFetch;
console.log("✓ places.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
