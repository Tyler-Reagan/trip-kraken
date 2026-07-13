/**
 * Unit test for the discovery provider layer (ADR-0009; contract locked in #102).
 * Standalone: run with `tsx src/lib/discovery.test.ts`. Registry, modes,
 * applicability, and ranking are pure; search dispatch runs against a mocked
 * fetch — no network or API key.
 */

import assert from "node:assert/strict";
import type { NearbyPlace } from "@/types";
import {
  getDiscoveryProvider,
  listDiscoveryProviders,
  modeForScope,
  scoreAndSort,
} from "@/lib/discovery";

process.env.GOOGLE_MAPS_API_KEY = "test-key";

async function main() {
  // ── Registry ──
  assert.equal(getDiscoveryProvider("google")?.id, "google", "google resolves");
  assert.equal(getDiscoveryProvider("nope"), undefined, "unknown source → undefined");
  assert.deepEqual(
    listDiscoveryProviders().map((p) => p.id).sort(),
    ["google"],
    "registry lists the google provider"
  );

  // ── Scope kind ↔ mode mapping (what routes gate on) ──
  assert.equal(modeForScope({ kind: "anchor", lat: 1, lng: 2 }), "anchored");
  assert.equal(modeForScope({ kind: "none" }), "unanchored");
  assert.equal(modeForScope({ kind: "route", polyline: "abc" }), "alongRoute");

  // ── Declared modes ──
  const google = getDiscoveryProvider("google")!;
  assert.deepEqual(
    [...google.modes].sort(),
    ["anchored", "unanchored"],
    "google serves anchor + none scopes (alongRoute lands with route support)"
  );

  // ── Applicability ──
  assert.equal(google.applies({ kind: "anchor", lat: 48.85, lng: 2.35 }), true, "google applies anywhere (Paris)");
  assert.equal(google.applies({ kind: "none" }), true, "google applies with no scope coords");

  // ── Search dispatch (mocked fetch) ──
  const originalFetch = global.fetch;
  let lastUrl = "";
  let lastBody: Record<string, unknown> = {};
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    lastUrl = String(url);
    lastBody = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        places: [
          {
            id: "p1",
            displayName: { text: "Spot" },
            location: { latitude: 35.0002, longitude: 139.0002 },
            types: [],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  // anchor scope, no query → nearby browse, with anchor→place distance computed in-process
  const anchored = await google.search({ scope: { kind: "anchor", lat: 35, lng: 139, radius: 800 } });
  assert.ok(lastUrl.endsWith("places:searchNearby"), "anchor browse hits searchNearby");
  assert.ok(
    anchored[0].distanceMeters! > 0 && anchored[0].distanceMeters! < 100,
    "anchor distance computed from coords"
  );

  // anchor scope + query → free-text search biased to the anchor
  await google.search({ query: "ramen", scope: { kind: "anchor", lat: 35, lng: 139 } });
  assert.ok(lastUrl.endsWith("places:searchText"), "anchor + query routes through text search");
  assert.equal(lastBody.textQuery, "ramen", "query becomes textQuery");
  assert.ok(lastBody.locationBias, "anchor becomes a location bias");

  // none scope → bare text search; openNow honored; missing query fails loud
  await google.search({ query: "kissaten in Tokyo", scope: { kind: "none" }, limit: 3, openNow: true });
  assert.ok(lastUrl.endsWith("places:searchText"), "none scope hits searchText");
  assert.equal(lastBody.locationBias, undefined, "unanchored has no bias");
  assert.equal(lastBody.openNow, true, "openNow passes through to text search");
  await assert.rejects(
    () => google.search({ scope: { kind: "none" } }),
    /query is required/,
    "none scope without query rejects"
  );

  // route scope → not declared by google yet; search refuses rather than misbehaving
  await assert.rejects(
    () => google.search({ query: "bakery", scope: { kind: "route", polyline: "abc" } }),
    /route/,
    "undeclared route scope rejects"
  );

  global.fetch = originalFetch;

  // ── Ranking (caller-side by contract — #102) ──
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
