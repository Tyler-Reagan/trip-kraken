/**
 * The travel-cost provider (ADR-0004): every "how far / how long between two places" query the
 * optimizer's sequencing phase makes routes through this interface, so a real routing API can
 * replace the default straight-line math later without touching any caller.
 *
 * Async, deliberately: a real provider is inherently a network call. Building this synchronous now
 * would force a breaking rework of every caller exactly when it matters most — when a real provider
 * actually gets added (O1-O3 grill, docs/optimizer-rebuild.md, 2026-07-06).
 *
 * NOT used by the optimizer's clustering step (kMeans/seedCentroids in optimizer.ts) — a clustering
 * centroid is a synthetic averaged point, not a real place, so "how do I travel to this made-up
 * point" isn't a meaningful provider query. Clustering stays on its own local distance math.
 */

export type TravelMode = "walking" | "driving" | "transit";

export interface Point {
  lat: number;
  lng: number;
}

/** A location is treated as not-yet-geocoded when its coordinates default to (0,0) — the shape
 * `toInput()` (optimize.ts) produces before a Location has real lat/lng. Shared by every caller
 * that needs to exclude these from distance-lookup construction or anchor selection. */
export function hasValidCoords(l: Point): boolean {
  return l.lat !== 0 || l.lng !== 0;
}

export interface TravelCost {
  distanceMeters: number;
  durationSeconds: number;
}

export interface TravelCostProvider {
  /** Fetch every pairwise cost in one round trip (ADR-0004), for sequencing's inner loops. */
  costMatrix(points: Point[], mode: TravelMode): Promise<TravelCost[][]>;
}

const EARTH_RADIUS_M = 6_371_000;

// Average city travel speed for estimating durations (20 km/h) — unchanged from the pre-O2 constant.
const AVG_SPEED_M_PER_S = (20 * 1000) / 3600;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const x =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Straight-line distance in km. The single haversine implementation shared by the travel-cost
 * provider above and clustering's centroid math (optimizer.ts) — a k-means centroid is a
 * synthetic point, not a real place, so it never goes through the async `TravelCostProvider`
 * itself, but there's no reason for it to duplicate the trig.
 */
export function haversineKm(a: Point, b: Point): number {
  return haversineMeters(a, b) / 1000;
}

function haversineCost(from: Point, to: Point): TravelCost {
  const distanceMeters = haversineMeters(from, to);
  return { distanceMeters, durationSeconds: distanceMeters / AVG_SPEED_M_PER_S };
}

/**
 * Default provider (ADR-0004): straight-line distance + one fixed speed — the same numbers the
 * pre-O2 optimizer produced. `mode` is accepted (interface contract) but ignored here; giving each
 * mode its own speed is a real quality change (category A, docs/optimizer-rebuild.md), deliberately
 * not bundled into this slice.
 */
export const haversineProvider: TravelCostProvider = {
  async costMatrix(points) {
    return points.map((p) => points.map((q) => haversineCost(p, q)));
  },
};

export interface DistanceLookup {
  km(aId: string, bId: string): number;
  mins(aId: string, bId: string): number;
}

/**
 * Fetches one full pairwise matrix upfront and returns synchronous by-id lookups over it — the
 * batching ADR-0004 calls for. Sequencing (optimizer.ts) calls this once per optimize run, then
 * every distance/duration query inside its construction loops is a plain array read, not a
 * provider round trip.
 */
export async function buildDistanceLookup(
  provider: TravelCostProvider,
  points: (Point & { id: string })[],
  mode: TravelMode
): Promise<DistanceLookup> {
  const index = new Map(points.map((p, i) => [p.id, i]));
  const matrix = await provider.costMatrix(points, mode);

  const cellOf = (aId: string, bId: string) => {
    const i = index.get(aId);
    const j = index.get(bId);
    if (i === undefined) throw new Error(`buildDistanceLookup: unknown id ${aId}`);
    if (j === undefined) throw new Error(`buildDistanceLookup: unknown id ${bId}`);
    return matrix[i][j];
  };

  return {
    km: (aId, bId) => cellOf(aId, bId).distanceMeters / 1000,
    mins: (aId, bId) => cellOf(aId, bId).durationSeconds / 60,
  };
}
