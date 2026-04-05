/**
 * Parses KML text into a flat list of named places with coordinates.
 *
 * KML (Keyhole Markup Language) is an XML-based format used by Google My Maps.
 * Coordinates are stored directly in each <Placemark>, so no geocoding is needed.
 *
 * KML coordinate order is longitude, latitude, altitude (not lat/lng!).
 * That's a historical quirk of the format — we swap them on the way out.
 */

import { XMLParser } from "fast-xml-parser";

export interface KmlPlace {
  name: string;
  lat: number;
  lng: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function parseKml(text: string): KmlPlace[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) =>
      ["Placemark", "Folder", "Document"].includes(name),
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch (err) {
    throw new Error(`KML parse error: ${(err as Error).message}`);
  }

  return extractPlacemarks(parsed);
}

// ---------------------------------------------------------------------------
// Internal — walk the parsed XML tree and collect Placemarks
// ---------------------------------------------------------------------------

function extractPlacemarks(node: unknown): KmlPlace[] {
  if (!node || typeof node !== "object") return [];

  const results: KmlPlace[] = [];

  // Depth-first walk: handle arrays and objects uniformly
  if (Array.isArray(node)) {
    for (const child of node) results.push(...extractPlacemarks(child));
    return results;
  }

  const obj = node as Record<string, unknown>;

  // If this node is a Placemark, try to extract a place from it
  if ("Placemark" in obj) {
    const placemarks = obj["Placemark"];
    const arr = Array.isArray(placemarks) ? placemarks : [placemarks];
    for (const pm of arr) {
      const place = placemarkToPlace(pm as Record<string, unknown>);
      if (place) results.push(place);
    }
  }

  // Recurse into child containers (Document, Folder, kml root)
  for (const key of ["kml", "Document", "Folder"]) {
    if (key in obj) {
      results.push(...extractPlacemarks(obj[key]));
    }
  }

  return results;
}

function placemarkToPlace(
  pm: Record<string, unknown>
): KmlPlace | null {
  // Name
  const name =
    typeof pm["name"] === "string" ? pm["name"].trim() : null;
  if (!name) return null;

  // Coordinates live in <Point><coordinates>lng,lat,alt</coordinates></Point>
  const point = pm["Point"];
  if (!point || typeof point !== "object") return null;

  const coordStr = (point as Record<string, unknown>)["coordinates"];
  if (typeof coordStr !== "string") return null;

  const coords = parseKmlCoordinates(coordStr.trim());
  if (!coords) return null;

  const place: KmlPlace = { name, lat: coords.lat, lng: coords.lng };

  // Optional description
  const desc = pm["description"];
  if (typeof desc === "string" && desc.trim()) {
    // Strip HTML tags that My Maps sometimes includes in descriptions
    place.description = desc.replace(/<[^>]+>/g, "").trim() || undefined;
  }

  return place;
}

/**
 * KML coordinate string: "lng,lat[,alt]" — note longitude comes first.
 * Multiple coordinate pairs are space-separated (for LineString/Polygon),
 * but a Point always has exactly one.
 */
function parseKmlCoordinates(
  raw: string
): { lat: number; lng: number } | null {
  // Take the first coordinate tuple (Points have only one)
  const first = raw.split(/\s+/)[0];
  const parts = first.split(",").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;

  const [lng, lat] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}
