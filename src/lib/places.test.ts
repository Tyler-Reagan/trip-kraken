/**
 * Unit tests for the Places API (New) client (ADR-0009 enrichment + discovery lookup).
 * Standalone (no test runner): run with `tsx src/lib/places.test.ts`.
 * Mocks global.fetch — no network or API key needed.
 */

import assert from "node:assert/strict";
import { searchText, searchNearby, searchAlongRoute, findPlaceFromText, getPlaceDetails } from "@/lib/places";

process.env.GOOGLE_MAPS_API_KEY = "test-key";

const originalFetch = global.fetch;

/** Queue a response and capture the request for shape assertions. */
let lastRequest: { url: string; init: RequestInit } | null = null;
function mockFetch(body: unknown, ok = true, status = 200) {
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    lastRequest = { url: String(url), init: init ?? {} };
    return { ok, status, json: async () => body } as Response;
  }) as typeof fetch;
}
function requestBody(): Record<string, unknown> {
  return JSON.parse(String(lastRequest!.init.body));
}
function requestHeader(name: string): string | undefined {
  return (lastRequest!.init.headers as Record<string, string>)[name];
}

const newPlace = {
  id: "place-1",
  displayName: { text: "Senso-ji" },
  formattedAddress: "2 Chome-3-1 Asakusa, Tokyo",
  location: { latitude: 35.71, longitude: 139.79 },
  rating: 4.5,
  userRatingCount: 1200,
  types: ["tourist_attraction", "point_of_interest", "establishment"],
  priceLevel: "PRICE_LEVEL_MODERATE",
};

async function main() {
  // ── searchText: request shape (Places-New searchText) ──
  mockFetch({ places: [newPlace] });
  let results = await searchText("Senso-ji Tokyo");
  assert.equal(lastRequest!.url, "https://places.googleapis.com/v1/places:searchText", "New searchText endpoint");
  assert.equal(lastRequest!.init.method, "POST", "POST request");
  assert.equal(requestHeader("X-Goog-Api-Key"), "test-key", "key in header, not URL");
  assert.ok(requestHeader("X-Goog-FieldMask")?.includes("places.id"), "field mask requests place id");
  assert.deepEqual(requestBody(), { textQuery: "Senso-ji Tokyo", pageSize: 20 }, "textQuery + pageSize body");

  // ── searchText: mapping onto NearbyPlace ──
  assert.equal(results.length, 1, "one result mapped");
  const r = results[0];
  assert.equal(r.placeId, "place-1", "id → placeId");
  assert.equal(r.name, "Senso-ji", "displayName.text → name");
  assert.equal(r.address, "2 Chome-3-1 Asakusa, Tokyo", "formattedAddress → address");
  assert.deepEqual([r.lat, r.lng], [35.71, 139.79], "location.latitude/longitude → lat/lng");
  assert.equal(r.rating, 4.5, "rating mapped");
  assert.equal(r.reviewCount, 1200, "userRatingCount → reviewCount");
  assert.deepEqual(r.categories, ["tourist_attraction"], "generic place types stripped");
  assert.equal(r.priceLevel, 2, "PRICE_LEVEL_MODERATE enum → 2");
  assert.equal(r.distanceMeters, null, "unanchored → no distance");

  // ── searchText: zero results is an empty object, not a status field ──
  mockFetch({});
  assert.deepEqual(await searchText("asdfqwerty nowhere"), [], "empty response → empty list");

  // ── searchText: API error (non-200 + error envelope) throws with the message ──
  mockFetch({ error: { code: 403, message: "bad key", status: "PERMISSION_DENIED" } }, false, 403);
  await assert.rejects(() => searchText("x"), /bad key/, "error envelope throws");

  // ── searchNearby without keyword: Places-New searchNearby with circle restriction ──
  mockFetch({ places: [newPlace] });
  results = await searchNearby(35.71, 139.79, { radius: 800, limit: 5 });
  assert.equal(lastRequest!.url, "https://places.googleapis.com/v1/places:searchNearby", "New searchNearby endpoint");
  assert.deepEqual(
    requestBody(),
    {
      locationRestriction: { circle: { center: { latitude: 35.71, longitude: 139.79 }, radius: 800 } },
      maxResultCount: 5,
    },
    "circle restriction + maxResultCount"
  );
  assert.equal(results[0].placeId, "place-1", "nearby result mapped");

  // ── searchNearby with keyword: routed through searchText with a location bias ──
  mockFetch({ places: [newPlace] });
  await searchNearby(35.71, 139.79, { radius: 800, keyword: "kissaten", openNow: true });
  assert.equal(lastRequest!.url, "https://places.googleapis.com/v1/places:searchText", "keyword → text search");
  assert.deepEqual(
    requestBody(),
    {
      textQuery: "kissaten",
      pageSize: 20,
      openNow: true,
      locationBias: { circle: { center: { latitude: 35.71, longitude: 139.79 }, radius: 800 } },
    },
    "keyword becomes textQuery, anchor becomes locationBias"
  );

  // ── searchNearby with keyword: bias is soft, so beyond-radius results are cut off ──
  mockFetch({
    places: [
      { ...newPlace, id: "inside", location: { latitude: 35.712, longitude: 139.797 } },
      { ...newPlace, id: "far-away", location: { latitude: 35.0, longitude: 135.75 } }, // Kyoto, ~370km
    ],
  });
  results = await searchNearby(35.71, 139.79, { radius: 1000, keyword: "ramen" });
  assert.deepEqual(results.map((p) => p.placeId), ["inside"], "beyond-radius text results filtered");

  // ── searchNearby openNow without keyword: filtered in-process (New nearby has no filter) ──
  mockFetch({
    places: [
      { ...newPlace, id: "open", currentOpeningHours: { openNow: true } },
      { ...newPlace, id: "closed", currentOpeningHours: { openNow: false } },
    ],
  });
  results = await searchNearby(35.71, 139.79, { openNow: true });
  assert.ok(
    requestHeader("X-Goog-FieldMask")?.includes("places.currentOpeningHours.openNow"),
    "openNow adds currentOpeningHours to the mask"
  );
  assert.deepEqual(results.map((p) => p.placeId), ["open"], "closed places filtered out");

  // ── searchAlongRoute: text search with a structured corridor param ──
  mockFetch({ places: [newPlace] });
  results = await searchAlongRoute("bakery", "abc123", { limit: 5, openNow: true });
  assert.equal(lastRequest!.url, "https://places.googleapis.com/v1/places:searchText", "along-route uses text search");
  assert.deepEqual(
    requestBody(),
    {
      textQuery: "bakery",
      pageSize: 5,
      searchAlongRouteParameters: { polyline: { encodedPolyline: "abc123" } },
      openNow: true,
    },
    "polyline becomes searchAlongRouteParameters, no location bias"
  );
  assert.equal(results[0].placeId, "place-1", "along-route result mapped");

  // ── findPlaceFromText: single best match with bias circle ──
  mockFetch({ places: [{ id: "place-2", location: { latitude: 34.66, longitude: 135.5 } }] });
  const found = await findPlaceFromText("Ichiran Namba", 34.67, 135.5, 5000);
  assert.deepEqual(found, { placeId: "place-2", lat: 34.66, lng: 135.5 }, "id + coords resolved");
  assert.deepEqual(
    requestBody(),
    {
      textQuery: "Ichiran Namba",
      pageSize: 1,
      locationBias: { circle: { center: { latitude: 34.67, longitude: 135.5 }, radius: 5000 } },
    },
    "single-result text search with bias"
  );

  // ── findPlaceFromText: zero results / network failure → null, never throws ──
  mockFetch({});
  assert.equal(await findPlaceFromText("nowhere", null, null), null, "zero results → null");
  global.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.equal(await findPlaceFromText("x", null, null), null, "fetch throw → null");

  // ── getPlaceDetails: GET place resource, map fields + weekly hours ──
  mockFetch({
    formattedAddress: "1-1 Chiyoda, Tokyo",
    rating: 4.2,
    userRatingCount: 300,
    types: ["restaurant", "point_of_interest"],
    nationalPhoneNumber: "03-1234-5678",
    regularOpeningHours: {
      periods: [
        { open: { day: 1, hour: 9, minute: 30 }, close: { day: 1, hour: 22, minute: 0 } },
        { open: { day: 2, hour: 9, minute: 30 }, close: { day: 2, hour: 22, minute: 0 } },
      ],
    },
  });
  const details = await getPlaceDetails("place-3");
  assert.equal(lastRequest!.url, "https://places.googleapis.com/v1/places/place-3", "place resource GET");
  assert.equal(lastRequest!.init.method ?? "GET", "GET", "details is a GET");
  assert.ok(requestHeader("X-Goog-FieldMask")?.includes("regularOpeningHours"), "mask requests hours");
  assert.equal(details?.address, "1-1 Chiyoda, Tokyo", "address mapped");
  assert.equal(details?.phone, "03-1234-5678", "nationalPhoneNumber → phone");
  assert.deepEqual(details?.categories, ["restaurant"], "generic types stripped");
  assert.equal(details?.openTime, "09:30", "Monday open, {hour,minute} → HH:MM");
  assert.equal(details?.closeTime, "22:00", "Monday close");
  assert.deepEqual(details?.hoursJson?.["2"], { open: "09:30", close: "22:00" }, "weekly map built");

  // ── getPlaceDetails: 24/7 (single Sunday-midnight open period, no close) ──
  mockFetch({
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] },
  });
  const allDay = await getPlaceDetails("place-4");
  assert.equal(allDay?.openTime, "00:00", "24/7 open");
  assert.equal(allDay?.closeTime, "23:59", "24/7 close");
  assert.deepEqual(allDay?.hoursJson?.["6"], { open: "00:00", close: "23:59" }, "24/7 covers all days");

  // ── getPlaceDetails: failure → null, never throws ──
  mockFetch({ error: { code: 404, message: "not found", status: "NOT_FOUND" } }, false, 404);
  assert.equal(await getPlaceDetails("gone"), null, "error → null");

  global.fetch = originalFetch;
  console.log("✓ places.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
