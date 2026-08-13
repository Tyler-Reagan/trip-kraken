/**
 * Coordinate primitives (ADR-0022) — `Point` and the haversine math outlive any one Path: it's
 * also the type of a clustering centroid (`metroCluster.ts`) and a discovery corridor endpoint.
 * Split out of the dissolved `travelCost.ts` so nothing here pulls in Path/provider machinery to
 * do plain trig.
 */

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

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Straight-line distance in meters — the single haversine implementation shared by the
 * path-provider default, `metroCluster.ts`'s clustering, discovery (discovery.ts, places.ts), and
 * transit-graph ingest/query (transitGraphIngest.ts, transitGraph.ts). `haversineKm` (the pre-VROOM
 * optimizer's k-means centroid math, its only caller) was deleted with `optimizer.ts` (ADR-0023 §9)
 * — every remaining caller wants meters. */
export function haversineMeters(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const x =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
