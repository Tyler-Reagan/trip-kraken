/**
 * Google's encoded polyline algorithm (encode-only — nothing in this codebase decodes one; Path
 * geometry speaks GeoJSON, ADR-0030 §9). Needed because `searchAlongRouteParameters` (`places.ts`)
 * only accepts this format, and the OSM-Japan corridor (#106) has to reach it from a Path's own
 * `GeoJSON.LineString[]` geometry.
 */

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (v >= 0x20) {
    output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  output += String.fromCharCode(v + 63);
  return output;
}

export function encodePolyline(points: { lat: number; lng: number }[]): string {
  let output = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const { lat, lng } of points) {
    const lat5 = Math.round(lat * 1e5);
    const lng5 = Math.round(lng * 1e5);
    output += encodeValue(lat5 - prevLat) + encodeValue(lng5 - prevLng);
    prevLat = lat5;
    prevLng = lng5;
  }
  return output;
}
