/**
 * Google Routes API provider (ADR-0018) — the first real `TravelCostProvider` implementation.
 * `costMatrix()` calls `computeRouteMatrix`; `describeLeg()` calls `computeRoutes` for one
 * point-to-point journey with display-only detail (line names, transfer count — ADR-0018 keeps
 * these out of the objective). Reuses `GOOGLE_MAPS_API_KEY` (places.ts) — Routes API is a separate
 * Google Cloud API that must be individually enabled/billed on the same project (see the ADR-0018
 * implementation notes for the console steps).
 *
 * Fails loudly (ADR-0018 #4): any HTTP error, per-element error status, or "no route" condition
 * throws — never a silent fallback to haversine.
 *
 * Waypoints are sent as lat/lng, not Google `placeId`s: `Point` (travelCost.ts) doesn't carry a
 * placeId today, and every committed Location's coordinates are already Google-canonical (ADR-0009
 * enrichment), so lat/lng is equivalent precision without widening the provider interface's shared
 * `Point` type for this one implementation.
 *
 * `departureTime` is only forwarded to Google when `mode === "transit"`: the API only accepts a
 * past `departureTime` for TRANSIT (rejects it for DRIVE/WALK/BICYCLE), and ADR-0018 §1 already
 * scoped time-of-day sensitivity to transit only — so the guard is real API behavior, not
 * speculative mode-specific branching.
 */

import type { Point, TravelCost, TravelCostProvider, LegDetail, TravelMode } from "@/lib/travelCost";

const MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

const GOOGLE_TRAVEL_MODE: Record<TravelMode, string> = {
  walking: "WALK",
  driving: "DRIVE",
  bicycle: "BICYCLE",
  transit: "TRANSIT",
};

// Google's per-request cap on origins × destinations (elements) — tighter for TRANSIT than the
// other modes. computeFullMatrix tiles requests to stay under whichever applies.
const MAX_ELEMENTS: Record<string, number> = {
  TRANSIT: 100,
  DRIVE: 625,
  WALK: 625,
  BICYCLE: 625,
};

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  return key;
}

function toWaypoint(p: Point) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

/** "160s" -> 160. Google always returns duration as a seconds-suffixed string. */
function toSeconds(duration: string): number {
  const n = Number(duration.replace(/s$/, ""));
  if (Number.isNaN(n)) throw new Error(`googleRoutesProvider: unparseable duration "${duration}"`);
  return n;
}

type MatrixElement = {
  originIndex: number;
  destinationIndex: number;
  status?: { code?: number; message?: string };
  condition?: string;
  distanceMeters?: number;
  duration?: string;
};

async function fetchMatrixChunk(
  origins: Point[],
  destinations: Point[],
  googleMode: string,
  departureTime?: Date
): Promise<MatrixElement[]> {
  const body: Record<string, unknown> = {
    origins: origins.map((p) => ({ waypoint: toWaypoint(p) })),
    destinations: destinations.map((p) => ({ waypoint: toWaypoint(p) })),
    travelMode: googleMode,
  };
  if (departureTime) body.departureTime = departureTime.toISOString();

  const res = await fetch(MATRIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      // `status` must be in the mask or every element silently reports OK (Google's own warning).
      "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Routes API error: HTTP ${res.status} ${text}`);
  }
  return (await res.json()) as MatrixElement[];
}

/**
 * Splits `points` into square batches so every origin-batch × destination-batch request stays
 * under Google's per-mode element cap, then stitches the per-chunk responses into one full matrix
 * keyed by the original point indices. ADR-0018's "one matrix per trip" is a logical fetch, not
 * necessarily one HTTP request — TRANSIT's 100-element cap means a trip with more than ~10 valid
 * points needs several requests to cover.
 */
async function computeFullMatrix(
  points: Point[],
  googleMode: string,
  departureTime?: Date
): Promise<TravelCost[][]> {
  const n = points.length;
  const matrix: TravelCost[][] = Array.from({ length: n }, () => new Array(n));

  const maxElements = MAX_ELEMENTS[googleMode] ?? 625;
  const batchSize = Math.max(1, Math.floor(Math.sqrt(maxElements)));

  const batches: number[][] = [];
  for (let i = 0; i < n; i += batchSize) {
    batches.push(Array.from({ length: Math.min(batchSize, n - i) }, (_, k) => i + k));
  }

  for (const originBatch of batches) {
    for (const destBatch of batches) {
      const elements = await fetchMatrixChunk(
        originBatch.map((i) => points[i]),
        destBatch.map((i) => points[i]),
        googleMode,
        departureTime
      );
      for (const el of elements) {
        if (el.status?.code) {
          throw new Error(`Google Routes API element error: ${el.status.message ?? el.status.code}`);
        }
        if (el.condition && el.condition !== "ROUTE_EXISTS") {
          throw new Error(`Google Routes API: no route (${el.condition}) between one origin/destination pair`);
        }
        const i = originBatch[el.originIndex];
        const j = destBatch[el.destinationIndex];
        matrix[i][j] = {
          distanceMeters: el.distanceMeters ?? 0,
          durationSeconds: el.duration ? toSeconds(el.duration) : 0,
        };
      }
    }
  }

  return matrix;
}

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    legs?: Array<{
      steps?: Array<{
        travelMode?: string;
        transitDetails?: { transitLine?: { nameShort?: string; name?: string } };
      }>;
    }>;
  }>;
};

export const googleRoutesProvider: TravelCostProvider = {
  async costMatrix(points, mode, opts) {
    if (points.length === 0) return [];
    const googleMode = GOOGLE_TRAVEL_MODE[mode];
    const departureTime = mode === "transit" ? opts?.departureTime : undefined;
    return computeFullMatrix(points, googleMode, departureTime);
  },

  async describeLeg(from, to, mode, opts): Promise<LegDetail> {
    const googleMode = GOOGLE_TRAVEL_MODE[mode];
    const departureTime = mode === "transit" ? opts?.departureTime : undefined;

    const body: Record<string, unknown> = {
      origin: toWaypoint(from),
      destination: toWaypoint(to),
      travelMode: googleMode,
    };
    if (departureTime) body.departureTime = departureTime.toISOString();

    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.legs.steps.travelMode,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.name",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google Routes API error: HTTP ${res.status} ${text}`);
    }
    const data = (await res.json()) as ComputeRoutesResponse;
    const route = data.routes?.[0];
    if (!route) throw new Error("Google Routes API: no route found for this leg");

    const distanceMeters = route.distanceMeters ?? 0;
    const durationSeconds = route.duration ? toSeconds(route.duration) : 0;

    if (googleMode !== "TRANSIT") return { distanceMeters, durationSeconds };

    // Google has no transfer-count field (confirmed against the API docs); derive it from
    // consecutive TRANSIT-mode steps — walking/waiting steps in between don't count as transfers.
    const transitSteps = (route.legs ?? [])
      .flatMap((leg) => leg.steps ?? [])
      .filter((s) => s.travelMode === "TRANSIT");
    const lineNames = transitSteps
      .map((s) => s.transitDetails?.transitLine?.nameShort ?? s.transitDetails?.transitLine?.name)
      .filter((name): name is string => !!name);
    // Collapse only consecutive duplicates — a line ridden twice non-consecutively is a real second
    // ride, not a naming artifact.
    const dedupedLines = lineNames.filter((name, i) => name !== lineNames[i - 1]);

    return {
      distanceMeters,
      durationSeconds,
      transferCount: Math.max(0, transitSteps.length - 1),
      lineNames: dedupedLines,
    };
  },
};
