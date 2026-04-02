/**
 * Parses a Google Takeout "Saved places" CSV file.
 *
 * Format exported by Google Takeout (Maps → Saved):
 *   Title,Note,URL,Comment
 *   "Eiffel Tower","","https://maps.google.com/?cid=12345678","optional note"
 *
 * The URL field can take several shapes:
 *   - https://maps.google.com/?cid=XXXXXXXXXX  (CID — no coords)
 *   - https://www.google.com/maps/place/Name/@lat,lng,zoom/...  (full URL — has coords)
 *   - https://goo.gl/maps/XXXXX  (short URL — no coords)
 *
 * When coordinates are present in the URL we use them directly and skip
 * geocoding. Otherwise we return the name alone and let the geocoding layer
 * resolve it.
 */

export interface ParsedPlace {
  name: string;
  /** Pre-extracted coordinates when available from the URL itself. */
  lat?: number;
  lng?: number;
}

export function parseTakeoutCsv(text: string): ParsedPlace[] {
  const lines = splitCsvLines(text);
  if (lines.length < 2) return [];

  // Normalise the header to find column indices (Takeout capitalises first letter)
  const header = parseRow(lines[0]).map((h) => h.trim().toLowerCase());
  const titleIdx = header.indexOf("title");
  const urlIdx = header.indexOf("url");

  if (titleIdx === -1) {
    throw new Error(
      'CSV is missing a "Title" column. Make sure this is a Google Takeout Saved Places export.'
    );
  }

  const results: ParsedPlace[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseRow(line);
    const name = cols[titleIdx]?.trim();
    if (!name) continue;

    const place: ParsedPlace = { name };

    if (urlIdx !== -1) {
      const url = cols[urlIdx]?.trim() ?? "";
      const coords = extractCoordsFromMapsUrl(url);
      if (coords) {
        place.lat = coords.lat;
        place.lng = coords.lng;
      }
    }

    results.push(place);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Coordinate extraction
// ---------------------------------------------------------------------------

/**
 * Tries to pull a lat/lng from a Google Maps URL.
 *
 * The @lat,lng pattern appears in place URLs like:
 *   https://www.google.com/maps/place/Name/@48.8584,2.2945,17z/...
 */
function extractCoordsFromMapsUrl(
  url: string
): { lat: number; lng: number } | null {
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  // Sanity-check valid coordinate ranges
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Minimal CSV parser
// ---------------------------------------------------------------------------
// The Takeout format uses standard RFC 4180 quoting, so we need to handle:
//   - Quoted fields (may contain commas)
//   - Escaped quotes ("" inside a quoted field)
//   - Optional CRLF or LF line endings

function splitCsvLines(text: string): string[] {
  // Normalise line endings, then split — but quoted fields may span lines
  // (Takeout doesn't use multi-line fields, so a simple split is safe here)
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      let field = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ",") i++;
    } else {
      // Unquoted field
      const end = line.indexOf(",", i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }

  return fields;
}
