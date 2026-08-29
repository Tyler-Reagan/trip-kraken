/**
 * Unit test for osrmProvider (ADR-0024). Standalone (no test runner):
 * run with `tsx src/lib/osrmProvider.test.ts`. Mocks global.fetch — no live OSRM container
 * needed; `docker compose`'s live containers were used once, by hand, to derive
 * `ROAD_SNAP_MAX_METERS` and confirm the response shapes these mocks stand in for (see
 * ADR-0024's 2026-08-11 amendment).
 */

import assert from "node:assert/strict";
import { osrmProvider } from "@/lib/osrmProvider";

process.env.OSRM_FOOT_URL = "http://localhost:5002";
process.env.OSRM_CAR_URL = "http://localhost:5010";

function mockFetch(handler: (url: string) => unknown) {
  global.fetch = (async (url: string) =>
    ({
      ok: true,
      status: 200,
      json: async () => handler(url),
    }) as Response) as typeof fetch;
}

function mockFetchError(status: number, text: string) {
  global.fetch = (async () =>
    ({
      ok: false,
      status,
      text: async () => text,
    }) as Response) as typeof fetch;
}

const P = (lat: number, lng: number) => ({ lat, lng });

async function main() {
  // ── costMatrix: URL shape — profile, coordinate order, annotations, no fallback_speed ──
  {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return {
        code: "Ok",
        durations: [
          [0, 100],
          [100, 0],
        ],
        distances: [
          [0, 1000],
          [1000, 0],
        ],
        sources: [
          { location: [139.76, 35.68], distance: 0.5 },
          { location: [139.79, 35.71], distance: 0.5 },
        ],
        destinations: [
          { location: [139.76, 35.68], distance: 0.5 },
          { location: [139.79, 35.71], distance: 0.5 },
        ],
      };
    });
    const matrix = await osrmProvider.costMatrix(
      [P(35.68, 139.76), P(35.71, 139.79)],
      ["walking"],
    );

    assert.ok(
      capturedUrl.startsWith("http://localhost:5002/table/v1/foot/"),
      "walking resolves the foot profile and URL",
    );
    assert.ok(
      capturedUrl.includes("139.76,35.68;139.79,35.71"),
      "coordinates are lng,lat, not lat,lng",
    );
    assert.ok(capturedUrl.includes("annotations=duration,distance"));
    assert.ok(
      !capturedUrl.includes("fallback_speed"),
      "fallback_speed is never sent (ADR-0024's 2026-08-11 amendment)",
    );
    assert.equal(matrix[0][1]?.distanceMeters, 1000);
    assert.equal(matrix[0][1]?.durationSeconds, 100);
    assert.equal(matrix[0][1]?.basisOfCost, "routingService");
    assert.equal(matrix[0][1]?.answeredBy, "osrm");
  }

  // ── costMatrix: driving resolves the car profile/URL ──
  {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return {
        code: "Ok",
        durations: [
          [0, 200],
          [200, 0],
        ],
        distances: [
          [0, 3000],
          [3000, 0],
        ],
        sources: [
          { location: [139.76, 35.68], distance: 0.5 },
          { location: [139.79, 35.71], distance: 0.5 },
        ],
        destinations: [
          { location: [139.76, 35.68], distance: 0.5 },
          { location: [139.79, 35.71], distance: 0.5 },
        ],
      };
    });
    await osrmProvider.costMatrix(
      [P(35.68, 139.76), P(35.71, 139.79)],
      ["driving"],
    );
    assert.ok(
      capturedUrl.startsWith("http://localhost:5010/table/v1/car/"),
      "driving resolves the car profile and URL",
    );
  }

  // ── costMatrix: a null duration cell declines; other cells in the same response still answer ──
  {
    mockFetch(() => ({
      code: "Ok",
      durations: [
        [0, null],
        [100, 0],
      ],
      distances: [
        [0, 1000],
        [1000, 0],
      ],
      sources: [
        { location: [0, 0], distance: 0.5 },
        { location: [1, 1], distance: 0.5 },
      ],
      destinations: [
        { location: [0, 0], distance: 0.5 },
        { location: [1, 1], distance: 0.5 },
      ],
    }));
    const matrix = await osrmProvider.costMatrix(
      [P(0, 0), P(1, 1)],
      ["walking"],
    );
    assert.equal(
      matrix[0][1],
      null,
      "OSRM's own null duration declines that cell",
    );
    assert.ok(
      matrix[1][0],
      "an unrelated cell in the same response still answers",
    );
  }

  // ── costMatrix: a far-snapped waypoint declines its entire row/column, not just itself —
  //    the out-of-Extract case, proven by shape, not by trusting a single-cell check ──
  {
    mockFetch(() => ({
      code: "Ok",
      durations: [
        [0, 100, 200],
        [100, 0, 300],
        [200, 300, 0],
      ],
      distances: [
        [0, 1000, 2000],
        [1000, 0, 3000],
        [2000, 3000, 0],
      ],
      sources: [
        { location: [0, 0], distance: 0.5 },
        { location: [1, 1], distance: 0.5 },
        { location: [132.45, 34.4], distance: 584908.6 }, // Hiroshima against a Kanto-only graph, live-verified
      ],
      destinations: [
        { location: [0, 0], distance: 0.5 },
        { location: [1, 1], distance: 0.5 },
        { location: [132.45, 34.4], distance: 584908.6 },
      ],
    }));
    const matrix = await osrmProvider.costMatrix(
      [P(0, 0), P(1, 1), P(34.4, 132.45)],
      ["driving"],
    );
    assert.ok(matrix[0][1], "a well-snapped pair still answers");
    assert.equal(matrix[0][2], null, "the far-snapped point's column declines");
    assert.equal(matrix[2][0], null, "the far-snapped point's row declines");
    assert.equal(matrix[2][2], null);
  }

  // ── costMatrix: HTTP and OSRM-level errors both throw, naming the profile ──
  {
    mockFetchError(500, "boom");
    await assert.rejects(
      () => osrmProvider.costMatrix([P(0, 0), P(1, 1)], ["walking"]),
      /osrm.*foot.*HTTP 500/i,
    );
  }
  {
    mockFetch(() => ({ code: "InvalidQuery", message: "bad coordinates" }));
    await assert.rejects(
      () => osrmProvider.costMatrix([P(0, 0), P(1, 1)], ["driving"]),
      /InvalidQuery/,
    );
  }

  // ── describeJourney: contiguous same-kind steps collapse into one Path each; walking + pushing
  //    bike collapse together; a ferry run becomes OtherPath; geometry is concatenated ──
  {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return {
        code: "Ok",
        waypoints: [
          { location: [139.76, 35.68], distance: 0.5 },
          { location: [139.79, 35.71], distance: 0.5 },
        ],
        routes: [
          {
            distance: 5000,
            duration: 3600,
            legs: [
              {
                steps: [
                  {
                    distance: 1000,
                    duration: 600,
                    mode: "walking",
                    name: "Main St",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [139.76, 35.68],
                        [139.765, 35.685],
                      ],
                    },
                  },
                  {
                    distance: 500,
                    duration: 300,
                    mode: "pushing bike",
                    name: "",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [139.765, 35.685],
                        [139.77, 35.69],
                      ],
                    },
                  },
                  {
                    distance: 2000,
                    duration: 900,
                    mode: "ferry",
                    name: "Tokyo Bay Ferry",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [139.77, 35.69],
                        [139.8, 35.7],
                      ],
                    },
                  },
                  {
                    distance: 1500,
                    duration: 1800,
                    mode: "driving",
                    name: "Highway 1",
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [139.8, 35.7],
                        [139.79, 35.71],
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };
    });

    const paths = await osrmProvider.describeJourney(
      { lat: 35.68, lng: 139.76 },
      { lat: 35.71, lng: 139.79 },
      ["walking"],
    );

    assert.ok(capturedUrl.includes("steps=true"));
    assert.ok(capturedUrl.includes("geometries=geojson"));
    assert.ok(
      capturedUrl.includes("139.76,35.68;139.79,35.71"),
      "route URL is also lng,lat",
    );
    assert.ok(paths);
    assert.equal(
      paths!.length,
      3,
      "four steps collapse to three runs — walking absorbs pushing bike",
    );

    assert.equal(paths![0].kind, "walking");
    assert.equal(
      paths![0].travelCost.distanceMeters,
      1500,
      "walking + pushing bike distances summed",
    );
    assert.equal(paths![0].travelCost.durationSeconds, 900);
    assert.equal(
      paths![0].geometry?.length,
      1,
      "an end-to-end routed run is one span (ADR-0030 §9)",
    );
    assert.equal(
      paths![0].geometry?.[0].coordinates.length,
      4,
      "geometry concatenated across the collapsed steps",
    );

    assert.equal(paths![1].kind, "other");
    assert.equal(
      (paths![1] as { lineName?: string }).lineName,
      "Tokyo Bay Ferry",
    );
    assert.equal(paths![1].travelCost.distanceMeters, 2000);

    assert.equal(paths![2].kind, "driving");
    assert.equal(paths![2].travelCost.distanceMeters, 1500);
    for (const p of paths!) {
      assert.equal(p.travelCost.answeredBy, "osrm");
      assert.equal(p.travelCost.basisOfCost, "routingService");
    }
  }

  // ── describeJourney: a far-snapped waypoint declines the whole journey ──
  {
    mockFetch(() => ({
      code: "Ok",
      waypoints: [
        { location: [139.76, 35.68], distance: 0.5 },
        { location: [132.45, 34.4], distance: 584908.6 },
      ],
      routes: [{ distance: 0, duration: 0, legs: [{ steps: [] }] }],
    }));
    const declined = await osrmProvider.describeJourney(
      { lat: 35.68, lng: 139.76 },
      { lat: 34.4, lng: 132.45 },
      ["walking"],
    );
    assert.equal(
      declined,
      null,
      "an out-of-Extract endpoint declines the journey, not just a cell",
    );
  }

  console.log("✓ osrmProvider.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
