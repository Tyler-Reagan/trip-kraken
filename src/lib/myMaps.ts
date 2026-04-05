/**
 * Google My Maps integration.
 *
 * My Maps links contain a `mid` query parameter (map ID).
 * Google exposes a stable, public KML export endpoint at:
 *   https://www.google.com/maps/d/kml?forcekml=1&mid={mid}
 *
 * This gives us exact embedded coordinates — no scraping, no geocoding needed.
 * The map must be set to public ("Anyone with the link can view").
 */

export function extractMid(url: string): string | null {
  try {
    return new URL(url).searchParams.get("mid");
  } catch {
    return null;
  }
}

export async function fetchKml(mid: string): Promise<string> {
  const kmlUrl = `https://www.google.com/maps/d/kml?forcekml=1&mid=${encodeURIComponent(mid)}`;
  const res = await fetch(kmlUrl);
  if (!res.ok) {
    throw new Error(
      `Google My Maps returned ${res.status}. Make sure the map is set to public ("Anyone with the link can view").`
    );
  }
  const text = await res.text();
  if (!text.trim().startsWith("<")) {
    throw new Error(
      "Unexpected response from Google My Maps. The map may not be set to public."
    );
  }
  return text;
}

/**
 * Extract the document-level <name> from KML text.
 * My Maps exports this as the map title, which makes a good default trip name.
 */
export function extractKmlDocumentName(kmlText: string): string | null {
  const match = kmlText.match(/<Document[^>]*>\s*<name>\s*([^<]+)\s*<\/name>/);
  return match ? match[1].trim() : null;
}
