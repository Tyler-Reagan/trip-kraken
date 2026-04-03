import type { ScrapedPlace } from "./scraper";

export interface GeocodedPlace {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
}

const GEOCODING_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Geocodes a list of scraped places.
 * Places that already have coordinates are passed through unchanged.
 * For the rest, we call the Google Maps Geocoding API.
 * Requests are serialized to avoid rate-limit errors (5 RPS free tier).
 */
export async function geocodePlaces(
  places: ScrapedPlace[]
): Promise<GeocodedPlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");

  const results: GeocodedPlace[] = [];

  for (const place of places) {
    if (place.lat !== undefined && place.lng !== undefined) {
      results.push({
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
      });
      continue;
    }

    const query = place.address
      ? `${place.name}, ${place.address}`
      : place.name;

    try {
      const geocoded = await geocodeQuery(query, apiKey);
      if (geocoded) {
        results.push({
          name: place.name,
          address: geocoded.address ?? place.address,
          lat: geocoded.lat,
          lng: geocoded.lng,
          placeId: geocoded.placeId,
        });
      } else {
        // Couldn't resolve — include without coords so user can see it
        console.warn(`Could not geocode: "${query}"`);
        results.push({ name: place.name, address: place.address });
      }
    } catch (err) {
      console.error(`Geocoding error for "${query}":`, err);
      results.push({ name: place.name, address: place.address, lat: 0, lng: 0 });
    }

    // Small delay to stay within free-tier rate limits
    await sleep(200);
  }

  return results;
}

async function geocodeQuery(
  query: string,
  apiKey: string
): Promise<{ lat: number; lng: number; address?: string; placeId?: string } | null> {
  const url = new URL(GEOCODING_BASE);
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);

  const data = (await res.json()) as {
    status: string;
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
      place_id: string;
    }>;
  };

  if (data.status !== "OK" || data.results.length === 0) return null;

  const first = data.results[0];
  return {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    address: first.formatted_address,
    placeId: first.place_id,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
