/**
 * Google Routes API provider (ADR-0018) — the first real `PathProvider` implementation.
 * `costMatrix()` calls `computeRouteMatrix`; `describeJourney()` calls `computeRoutes` for one
 * A-to-B journey. Reuses `GOOGLE_MAPS_API_KEY` (places.ts) — Routes API is a separate
 * Google Cloud API that must be individually enabled/billed on the same project (see the ADR-0018
 * implementation notes for the console steps).
 *
 * Fails loudly (ADR-0018 #4): any HTTP error, per-element error status, or "no route" condition
 * throws — never a silent fallback to haversine.
 *
 * Waypoints are sent as lat/lng, not Google `placeId`s: `Point` doesn't carry a placeId today, and
 * every committed Location's coordinates are already Google-canonical (ADR-0009 enrichment), so
 * lat/lng is equivalent precision without widening the provider interface's shared `Point` type
 * for this one implementation.
 *
 * `departureTime` is only forwarded to Google when `mode === "transit"`: the API only accepts a
 * past `departureTime` for TRANSIT (rejects it for DRIVE/WALK/BICYCLE), and ADR-0018 §1 already
 * scoped time-of-day sensitivity to transit only — so the guard is real API behavior, not
 * speculative mode-specific branching.
 *
 * `describeJourney`'s transit result is currently a single `UnknownPath` (ADR-0022, revised): this
 * provider doesn't request `transitDetails.transitLine.vehicle.type` yet, so it has genuine line
 * names with no derivable `rail`/`bus`/`other` kind to attach them to — under the new taxonomy
 * there is no member for that. Requesting `vehicle.type` and binning it (17 Google values → three
 * kinds) is #146/P3 of the ADR-0022 refactor, not this slice.
 */

import { makeTravelCost, type Path, type PathEndpoint, type Point, type TravelCost } from "@/types/path";
import type { PathProvider, TravelMode } from "@/lib/pathProvider";

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
        matrix[i][j] = makeTravelCost(el.distanceMeters ?? 0, el.duration ? toSeconds(el.duration) : 0, "routingService");
      }
    }
  }

  return matrix;
}

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
};

type PolylineResponse = { routes?: Array<{ polyline?: { encodedPolyline?: string } }> };

/**
 * Encoded polyline for one Journey (discovery route scope, #102) — a separate call from
 * `describeJourney` because along-route discovery needs only the corridor shape, not
 * distance/duration, and callers compute it once per Journey to reuse
 * across several category searches (routing stays a separate seam, ADR-0018/0019).
 *
 * Returns `null` when Google has no route for this Path/mode. Unlike routing (which fails
 * loudly — ADR-0018 — because a missing cost would corrupt the optimizer), a missing
 * discovery corridor is an ordinary outcome: the caller falls back to another mode (e.g. a
 * short urban Path has no transit route but is a walk). Genuine API/HTTP errors still throw.
 */
export async function computeRoutePolyline(from: Point, to: Point, mode: TravelMode): Promise<string | null> {
  const googleMode = GOOGLE_TRAVEL_MODE[mode];
  const res = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: toWaypoint(from),
      destination: toWaypoint(to),
      travelMode: googleMode,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Routes API error: HTTP ${res.status} ${text}`);
  }
  const data = (await res.json()) as PolylineResponse;
  return data.routes?.[0]?.polyline?.encodedPolyline ?? null;
}

/** Maps a resolved `TravelMode` to the `Path` kind Google's answer for it can honestly claim.
 * `transit` maps to no kind — see the module doc: without `vehicle.type` in the field mask, a
 * transit result has genuine content (distance, duration) but no derivable rail/bus/other kind. */
const KIND_FOR_MODE: Partial<Record<TravelMode, "walking" | "driving" | "bicycle">> = {
  walking: "walking",
  driving: "driving",
  bicycle: "bicycle",
};

export const googleRoutesProvider: PathProvider = {
  async costMatrix(points, mode, opts) {
    if (points.length === 0) return [];
    const googleMode = GOOGLE_TRAVEL_MODE[mode];
    const departureTime = mode === "transit" ? opts?.departureTime : undefined;
    return computeFullMatrix(points, googleMode, departureTime);
  },

  async describeJourney(from: PathEndpoint, to: PathEndpoint, mode, opts): Promise<Path[]> {
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
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google Routes API error: HTTP ${res.status} ${text}`);
    }
    const data = (await res.json()) as ComputeRoutesResponse;
    const route = data.routes?.[0];
    if (!route) throw new Error("Google Routes API: no route found for this Journey");

    const travelCost = makeTravelCost(
      route.distanceMeters ?? 0,
      route.duration ? toSeconds(route.duration) : 0,
      "routingService"
    );

    const kind = KIND_FOR_MODE[mode];
    return [kind ? { kind, from, to, travelCost } : { from, to, travelCost }];
  },
};
