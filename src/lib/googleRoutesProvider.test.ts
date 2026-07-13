/**
 * Unit test for googleRoutesProvider (ADR-0018). Standalone (no test runner):
 * run with `tsx src/lib/googleRoutesProvider.test.ts`. Mocks global.fetch — no network or API
 * key needed.
 */

import assert from "node:assert/strict";
import { googleRoutesProvider, computeRoutePolyline } from "@/lib/googleRoutesProvider";

process.env.GOOGLE_MAPS_API_KEY = "test-key";

const originalFetch = global.fetch;

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  global.fetch = (async (url: string, init: RequestInit) =>
    ({ ok: true, status: 200, json: async () => handler(url, init) }) as Response) as typeof fetch;
}

const P = (lat: number, lng: number) => ({ lat, lng });

async function main() {
// ── costMatrix: one small chunk, fields mapped correctly ──
let calls = 0;
mockFetch((_url, init) => {
  calls++;
  const body = JSON.parse(init.body as string);
  assert.equal(body.travelMode, "TRANSIT", "mode mapped to Google enum");
  assert.ok(body.departureTime, "departureTime forwarded for transit");
  return [
    { originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 0, duration: "0s" },
    { originIndex: 0, destinationIndex: 1, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 5000, duration: "900s" },
    { originIndex: 1, destinationIndex: 0, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 5200, duration: "920s" },
    { originIndex: 1, destinationIndex: 1, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 0, duration: "0s" },
  ];
});
const matrix = await googleRoutesProvider.costMatrix(
  [P(35.68, 139.76), P(35.71, 139.79)],
  "transit",
  { departureTime: new Date("2026-08-01T09:00:00Z") }
);
assert.equal(calls, 1, "small matrix fits one request");
assert.equal(matrix[0][1].distanceMeters, 5000, "distanceMeters mapped");
assert.equal(matrix[0][1].durationSeconds, 900, "duration string parsed to seconds");

// ── costMatrix: departureTime withheld for non-transit modes ──
mockFetch((_url, init) => {
  const body = JSON.parse(init.body as string);
  assert.equal(body.travelMode, "WALK");
  assert.equal(body.departureTime, undefined, "walking never sends departureTime");
  return [{ originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 100, duration: "60s" }];
});
await googleRoutesProvider.costMatrix([P(0, 0)], "walking", { departureTime: new Date() });

// ── costMatrix: tiling — 11 points at the 10x10 TRANSIT cap needs 4 request chunks ──
calls = 0;
mockFetch((_url, init) => {
  calls++;
  const body = JSON.parse(init.body as string);
  const elements: unknown[] = [];
  for (let i = 0; i < body.origins.length; i++) {
    for (let j = 0; j < body.destinations.length; j++) {
      elements.push({ originIndex: i, destinationIndex: j, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 1, duration: "1s" });
    }
  }
  return elements;
});
const elevenPoints = Array.from({ length: 11 }, (_, i) => P(i, i));
const tiled = await googleRoutesProvider.costMatrix(elevenPoints, "transit");
assert.equal(calls, 4, "11 points at 10x10 cap tiles into 2x2 = 4 chunk requests");
assert.equal(tiled.length, 11, "full 11x11 matrix stitched");
assert.equal(tiled[10][10].distanceMeters, 1, "far corner cell populated by the last chunk");
assert.equal(tiled[0][10].distanceMeters, 1, "cross-chunk cell populated correctly");

// ── costMatrix: a per-element error status throws (fail loudly, ADR-0018 #4) ──
mockFetch(() => [
  { originIndex: 0, destinationIndex: 0, status: { code: 3, message: "invalid argument" }, distanceMeters: 0, duration: "0s" },
]);
await assert.rejects(
  () => googleRoutesProvider.costMatrix([P(0, 0)], "driving"),
  /invalid argument/,
  "per-element error status throws"
);

// ── costMatrix: ROUTE_NOT_FOUND throws rather than silently zeroing the cell ──
mockFetch(() => [
  { originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_NOT_FOUND", distanceMeters: 0, duration: "0s" },
]);
await assert.rejects(
  () => googleRoutesProvider.costMatrix([P(0, 0)], "walking"),
  /ROUTE_NOT_FOUND/,
  "no-route condition throws"
);

// ── describeLeg: transit steps → transferCount + deduped line names, display-only fields ──
mockFetch(() => ({
  routes: [
    {
      distanceMeters: 8000,
      duration: "1800s",
      legs: [
        {
          steps: [
            { travelMode: "WALK" },
            { travelMode: "TRANSIT", transitDetails: { transitLine: { nameShort: "Yamanote Line" } } },
            { travelMode: "WALK" },
            { travelMode: "TRANSIT", transitDetails: { transitLine: { nameShort: "Ginza Line" } } },
          ],
        },
      ],
    },
  ],
}));
const leg = await googleRoutesProvider.describeLeg(P(35.68, 139.76), P(35.71, 139.79), "transit");
assert.equal(leg.durationSeconds, 1800, "leg duration mapped");
assert.equal(leg.transferCount, 1, "two transit steps = one transfer");
assert.deepEqual(leg.lineNames, ["Yamanote Line", "Ginza Line"], "line names in ride order");

// ── describeLeg: non-transit mode omits transit-only fields ──
mockFetch(() => ({ routes: [{ distanceMeters: 400, duration: "300s" }] }));
const walkLeg = await googleRoutesProvider.describeLeg(P(0, 0), P(0, 0.01), "walking");
assert.equal(walkLeg.transferCount, undefined, "walking has no transfer count");
assert.equal(walkLeg.lineNames, undefined, "walking has no line names");

// ── describeLeg: no route found throws ──
mockFetch(() => ({ routes: [] }));
await assert.rejects(() => googleRoutesProvider.describeLeg(P(0, 0), P(0, 0), "driving"), /no route found/, "empty routes throws");

// ── computeRoutePolyline: encoded polyline extracted, minimal field mask ──
mockFetch((_url, init) => {
  const body = JSON.parse(init.body as string);
  assert.equal(body.travelMode, "DRIVE", "mode mapped to Google enum");
  assert.equal(body.departureTime, undefined, "driving never sends departureTime");
  return { routes: [{ polyline: { encodedPolyline: "abc123~xyz" } }] };
});
const polyline = await computeRoutePolyline(P(34.7, 135.5), P(35.0, 135.75), "driving");
assert.equal(polyline, "abc123~xyz", "encoded polyline returned");

// ── computeRoutePolyline: no route found throws ──
mockFetch(() => ({ routes: [] }));
await assert.rejects(
  () => computeRoutePolyline(P(0, 0), P(0, 0), "walking"),
  /no route found/,
  "empty routes throws"
);

// ── HTTP failure throws (fail loudly) ──
global.fetch = (async () => ({ ok: false, status: 403, text: async () => "PERMISSION_DENIED" }) as Response) as typeof fetch;
await assert.rejects(() => googleRoutesProvider.costMatrix([P(0, 0), P(1, 1)], "transit"), /HTTP 403/, "non-ok HTTP response throws");

// ── Missing API key throws before any network call ──
delete process.env.GOOGLE_MAPS_API_KEY;
await assert.rejects(() => googleRoutesProvider.costMatrix([P(0, 0), P(1, 1)], "transit"), /GOOGLE_MAPS_API_KEY/, "missing key throws");
process.env.GOOGLE_MAPS_API_KEY = "test-key";

global.fetch = originalFetch;
console.log("✓ googleRoutesProvider.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
