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

// `describeJourney`'s interface widened to `Path[] | null` for ADR-0024's decline mechanism, but
// this provider's own implementation never actually declines (it throws instead — ADR-0018 #4).
// This helper keeps that fact out of every call site below rather than null-checking each one.
async function describeJourney(...args: Parameters<typeof googleRoutesProvider.describeJourney>) {
  const result = await googleRoutesProvider.describeJourney(...args);
  assert.ok(result, "googleRoutesProvider.describeJourney never declines");
  return result!;
}
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
  ["rail"],
  { departureTime: new Date("2026-08-01T09:00:00Z") }
);
assert.equal(calls, 1, "small matrix fits one request");
assert.equal(matrix[0][1]!.distanceMeters, 5000, "distanceMeters mapped");
assert.equal(matrix[0][1]!.durationSeconds, 900, "duration string parsed to seconds");

// ── costMatrix: departureTime withheld for non-transit modes ──
mockFetch((_url, init) => {
  const body = JSON.parse(init.body as string);
  assert.equal(body.travelMode, "WALK");
  assert.equal(body.departureTime, undefined, "walking never sends departureTime");
  return [{ originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 100, duration: "60s" }];
});
await googleRoutesProvider.costMatrix([P(0, 0)], ["walking"], { departureTime: new Date() });

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
const tiled = await googleRoutesProvider.costMatrix(elevenPoints, ["rail"]);
assert.equal(calls, 4, "11 points at 10x10 cap tiles into 2x2 = 4 chunk requests");
assert.equal(tiled.length, 11, "full 11x11 matrix stitched");
assert.equal(tiled[10][10]!.distanceMeters, 1, "far corner cell populated by the last chunk");
assert.equal(tiled[0][10]!.distanceMeters, 1, "cross-chunk cell populated correctly");

// ── costMatrix: a per-element error status throws (fail loudly, ADR-0018 #4) ──
mockFetch(() => [
  { originIndex: 0, destinationIndex: 0, status: { code: 3, message: "invalid argument" }, distanceMeters: 0, duration: "0s" },
]);
await assert.rejects(
  () => googleRoutesProvider.costMatrix([P(0, 0)], ["driving"]),
  /invalid argument/,
  "per-element error status throws"
);

// ── costMatrix: ROUTE_NOT_FOUND throws rather than silently zeroing the cell ──
mockFetch(() => [
  { originIndex: 0, destinationIndex: 0, status: {}, condition: "ROUTE_NOT_FOUND", distanceMeters: 0, duration: "0s" },
]);
await assert.rejects(
  () => googleRoutesProvider.costMatrix([P(0, 0)], ["walking"]),
  /ROUTE_NOT_FOUND/,
  "no-route condition throws"
);

// ── describeJourney: transit-bucket kinds have genuine cost but no derivable kind (ADR-0022 P1 —
//    no vehicle.type in the field mask yet, so a rail/bus/other journey reports UnknownPath).
//    ["rail"] and ["bus"] both resolve to the same Google TRANSIT request (ADR-0022 P2). ──
mockFetch(() => ({ routes: [{ distanceMeters: 8000, duration: "1800s" }] }));
const journey = await describeJourney(P(35.68, 139.76), P(35.71, 139.79), ["rail"]);
assert.equal(journey.length, 1, "single-element Path[] — decomposition unimplemented");
assert.equal(journey[0].kind, undefined, "no vehicle.type requested yet, so no honest kind to report");
assert.equal(journey[0].travelCost.durationSeconds, 1800, "Path duration mapped");
assert.equal(journey[0].travelCost.basisOfCost, "routingService", "still a real routed cost, despite the unknown kind");

const busJourney = await describeJourney(P(35.68, 139.76), P(35.71, 139.79), ["bus"]);
assert.equal(busJourney[0].kind, undefined, "bus also folds onto Google's TRANSIT with no derivable kind yet");

// ── describeJourney: willingness set with a non-transit primary gets a definite kind, since the
//    resolved kind itself was honored ──
mockFetch(() => ({ routes: [{ distanceMeters: 400, duration: "300s" }] }));
const walkJourney = await describeJourney(P(0, 0), P(0, 0.01), ["walking"]);
assert.equal(walkJourney[0].kind, "walking", "walking resolves to WalkingPath");

// ── describeJourney: rail precedes walking in the resolution precedence ──
mockFetch(() => ({ routes: [{ distanceMeters: 8000, duration: "1800s" }] }));
const mixedJourney = await describeJourney(P(35.68, 139.76), P(35.71, 139.79), ["walking", "rail"]);
assert.equal(mixedJourney[0].kind, undefined, "rail wins the precedence over walking, so still an unknown-kind transit result");

// ── describeJourney: no route found throws ──
mockFetch(() => ({ routes: [] }));
await assert.rejects(() => googleRoutesProvider.describeJourney(P(0, 0), P(0, 0), ["driving"]), /no route found/, "empty routes throws");

// ── computeRoutePolyline: encoded polyline extracted, minimal field mask ──
mockFetch((_url, init) => {
  const body = JSON.parse(init.body as string);
  assert.equal(body.travelMode, "DRIVE", "mode mapped to Google enum");
  assert.equal(body.departureTime, undefined, "driving never sends departureTime");
  return { routes: [{ polyline: { encodedPolyline: "abc123~xyz" } }] };
});
const polyline = await computeRoutePolyline(P(34.7, 135.5), P(35.0, 135.75), "driving");
assert.equal(polyline, "abc123~xyz", "encoded polyline returned");

// ── computeRoutePolyline: no route found returns null (discovery degrades gracefully — the
//     caller falls back to another mode; only routing fails loudly, ADR-0018) ──
mockFetch(() => ({ routes: [] }));
assert.equal(
  await computeRoutePolyline(P(0, 0), P(0, 0), "walking"),
  null,
  "empty routes returns null"
);

// ── HTTP failure throws (fail loudly) ──
global.fetch = (async () => ({ ok: false, status: 403, text: async () => "PERMISSION_DENIED" }) as Response) as typeof fetch;
await assert.rejects(() => googleRoutesProvider.costMatrix([P(0, 0), P(1, 1)], ["rail"]), /HTTP 403/, "non-ok HTTP response throws");

// ── Missing API key throws before any network call ──
delete process.env.GOOGLE_MAPS_API_KEY;
await assert.rejects(() => googleRoutesProvider.costMatrix([P(0, 0), P(1, 1)], ["rail"]), /GOOGLE_MAPS_API_KEY/, "missing key throws");
process.env.GOOGLE_MAPS_API_KEY = "test-key";

global.fetch = originalFetch;
console.log("✓ googleRoutesProvider.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
