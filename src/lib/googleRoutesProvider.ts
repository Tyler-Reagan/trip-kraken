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
 * `departureTime` is only forwarded to Google when the resolved Google mode is TRANSIT: the API
 * only accepts a past `departureTime` for TRANSIT (rejects it for DRIVE/WALK/BICYCLE), and
 * ADR-0018 §1 already scoped time-of-day sensitivity to transit only — so the guard is real API
 * behavior, not speculative mode-specific branching.
 *
 * `kinds` (ADR-0022 P2) is a willingness *set*; Google's matrix/routes calls take exactly one
 * `travelMode` per request, so this provider collapses the set to one representative `PathKind`
 * via `resolvePrimaryPathKind` (`pathKind.ts`) before mapping it onto Google's vocabulary
 * (`GOOGLE_MODE_FOR_KIND`). Forwarding the full transit subset as `transitPreferences.
 * allowedTravelModes`, rather than just picking one, is deferred to #146 — not this slice.
 *
 * `describeJourney`'s result is currently a single `UnknownPath` whenever the resolved kind is
 * `rail`/`bus`/`other` (ADR-0022, revised): this provider doesn't request
 * `transitDetails.transitLine.vehicle.type` yet, so a transit result has genuine content
 * (distance, duration) but no derivable rail/bus/other kind to attach it to. Requesting
 * `vehicle.type` and binning it (17 Google values → three kinds) is #146/P3 of the ADR-0022
 * refactor, not this slice.
 */

import { makeTravelCost, type Path, type PathEndpoint, type PathKind, type Point, type TravelCost } from "@/types/path";
import type { PathProvider } from "@/lib/pathProvider";
import { resolvePrimaryPathKind } from "@/lib/pathKind";

const MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Maps one `PathKind` to Google's `travelMode` enum. `rail`/`bus`/`other` all fold onto
 * `TRANSIT` — Google has no separate top-level mode for them, only `transitPreferences` *within*
 * TRANSIT (ADR-0022's rail/bus split is a request-side filter Google supports, per the module
 * doc; not wired up here). */
const GOOGLE_MODE_FOR_KIND: Record<PathKind, string> = {
  walking: "WALK",
  driving: "DRIVE",
  bicycle: "BICYCLE",
  rail: "TRANSIT",
  bus: "TRANSIT",
  other: "TRANSIT",
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
 * Returns `null` when Google has no route for this Path/kind. Unlike routing (which fails
 * loudly — ADR-0018 — because a missing cost would corrupt the optimizer), a missing
 * discovery corridor is an ordinary outcome: the caller falls back to another kind (e.g. a
 * short urban Path has no transit route but is a walk). Genuine API/HTTP errors still throw.
 */
export async function computeRoutePolyline(from: Point, to: Point, kind: PathKind): Promise<string | null> {
  const googleMode = GOOGLE_MODE_FOR_KIND[kind];
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

/** Whether a resolved kind is one Google collapses onto `TRANSIT` — a type predicate (not a plain
 * `Set.has`) so the non-transit branch below narrows `PathKind` down to the three kinds `Path`
 * actually accepts a bare `kind` field for. */
function isTransitBucketKind(k: PathKind): k is "rail" | "bus" | "other" {
  return k === "rail" || k === "bus" || k === "other";
}

export const googleRoutesProvider: PathProvider = {
  async costMatrix(points, kinds, opts) {
    if (points.length === 0) return [];
    const primary = resolvePrimaryPathKind(kinds);
    const googleMode = GOOGLE_MODE_FOR_KIND[primary];
    const departureTime = googleMode === "TRANSIT" ? opts?.departureTime : undefined;
    return computeFullMatrix(points, googleMode, departureTime);
  },

  async describeJourney(from: PathEndpoint, to: PathEndpoint, kinds, opts): Promise<Path[]> {
    const primary = resolvePrimaryPathKind(kinds);
    const googleMode = GOOGLE_MODE_FOR_KIND[primary];
    const departureTime = googleMode === "TRANSIT" ? opts?.departureTime : undefined;

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

    // A transit-bucket kind was requested but not derivable from the response yet (see module
    // doc) — the resolved kind is otherwise exactly what was asked for and got.
    return [isTransitBucketKind(primary) ? { from, to, travelCost } : { kind: primary, from, to, travelCost }];
  },
};
