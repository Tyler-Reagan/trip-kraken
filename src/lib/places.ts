import type { NearbyPlace } from "@/types";

const NEARBY_BASE   = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const TEXTSEARCH_BASE = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS_BASE  = "https://maps.googleapis.com/maps/api/place/details/json";

type PlacesApiResponse = {
  status: string;
  error_message?: string;
  results: Array<{
    place_id: string;
    name: string;
    vicinity: string;
    geometry: { location: { lat: number; lng: number } };
    rating?: number;
    user_ratings_total?: number;
    types: string[];
    price_level?: number;
  }>;
};

export async function searchNearby(
  lat: number,
  lng: number,
  opts: {
    radius?: number;
    keyword?: string;
    type?: string;
    limit?: number;
    openNow?: boolean;
  }
): Promise<NearbyPlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");

  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: String(Math.min(opts.radius ?? 1000, 50000)),
    key: apiKey,
  });
  if (opts.keyword) params.set("keyword", opts.keyword);
  if (opts.type) params.set("type", opts.type);
  if (opts.openNow) params.set("opennow", "true");

  const res = await fetch(`${NEARBY_BASE}?${params}`);
  if (!res.ok) throw new Error(`Google Places API error: HTTP ${res.status}`);

  const data = (await res.json()) as PlacesApiResponse;

  if (data.status === "REQUEST_DENIED") {
    throw new Error(data.error_message ?? "Google Places API request denied. Check your API key.");
  }
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message ?? `Google Places API error: ${data.status}`);
  }

  const limit = Math.min(opts.limit ?? 20, 60);
  return data.results.slice(0, limit).map((r) => ({
    placeId: r.place_id,
    name: r.name,
    address: r.vicinity,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    rating: r.rating ?? null,
    reviewCount: r.user_ratings_total ?? null,
    categories: r.types.filter((t) => t !== "point_of_interest" && t !== "establishment"),
    priceLevel: r.price_level ?? null,
    distanceMeters: null, // Nearby Search doesn't return distance; use radius for context
  }));
}

// ─── Place Details enrichment ────────────────────────────────────────────────

export type LocationEnrichment = {
  placeId: string;
  rating: number | null;
  reviewCount: number | null;
  categories: string[];
  phone: string | null;
  openTime: string | null;
  closeTime: string | null;
};

type PlaceDetails = Omit<LocationEnrichment, "placeId">;

type DetailsApiResponse = {
  status: string;
  result?: {
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
    formatted_phone_number?: string;
    opening_hours?: {
      periods: Array<{
        open: { day: number; time: string };
        close?: { day: number; time: string };
      }>;
    };
  };
};

type TextSearchApiResponse = {
  status: string;
  results: Array<{ place_id: string }>;
};

/** Convert "HHMM" from Places API to "HH:MM". */
function toHHMM(time: string): string {
  return `${time.slice(0, 2)}:${time.slice(2)}`;
}

/**
 * Extract a representative openTime/closeTime from Place Details periods.
 * Prefers Monday (day = 1); falls back to the first available period.
 */
function extractHours(
  periods: Array<{ open: { day: number; time: string }; close?: { day: number; time: string } }>
): { openTime: string | null; closeTime: string | null } {
  const weekday = periods.find((p) => p.open.day === 1) ?? periods[0];
  if (!weekday) return { openTime: null, closeTime: null };
  return {
    openTime: toHHMM(weekday.open.time),
    closeTime: weekday.close ? toHHMM(weekday.close.time) : null,
  };
}

/**
 * Resolve a placeId for a location using Text Search (name + coords).
 * Returns null on ZERO_RESULTS or any error — never throws.
 */
async function findPlaceId(name: string, lat: number, lng: number): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({
      query: name,
      location: `${lat},${lng}`,
      radius: "100",
      key: apiKey,
    });
    const res = await fetch(`${TEXTSEARCH_BASE}?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as TextSearchApiResponse;
    if (data.status !== "OK" || !data.results.length) return null;
    return data.results[0].place_id;
  } catch {
    return null;
  }
}

/**
 * Fetch Place Details for a known placeId.
 * Returns null on failure — never throws.
 */
async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "rating,user_ratings_total,types,formatted_phone_number,opening_hours",
      key: apiKey,
    });
    const res = await fetch(`${DETAILS_BASE}?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as DetailsApiResponse;
    if (data.status !== "OK" || !data.result) return null;
    const r = data.result;
    const { openTime, closeTime } = r.opening_hours?.periods
      ? extractHours(r.opening_hours.periods)
      : { openTime: null, closeTime: null };
    return {
      rating: r.rating ?? null,
      reviewCount: r.user_ratings_total ?? null,
      categories: (r.types ?? []).filter(
        (t) => t !== "point_of_interest" && t !== "establishment"
      ),
      phone: r.formatted_phone_number ?? null,
      openTime,
      closeTime,
    };
  } catch {
    return null;
  }
}

/**
 * Orchestrates findPlaceId → getPlaceDetails for one location.
 * Returns a partial enrichment object with only fields that were resolved.
 * Never throws — errors surface as an empty object.
 */
export async function enrichLocation(loc: {
  id: string;
  name: string;
  lat: number;
  lng: number;
  placeId: string | null;
}): Promise<Partial<LocationEnrichment>> {
  try {
    const placeId = loc.placeId ?? (await findPlaceId(loc.name, loc.lat, loc.lng));
    if (!placeId) return {};
    const details = await getPlaceDetails(placeId);
    if (!details) return { placeId };
    return { placeId, ...details };
  } catch {
    return {};
  }
}
