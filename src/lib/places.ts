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
  lat: number;
  lng: number;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  categories: string[];
  phone: string | null;
  openTime: string | null;
  closeTime: string | null;
  hoursJson: Record<string, { open: string; close: string | null }> | null;
};

type PlaceDetails = Omit<LocationEnrichment, "placeId" | "lat" | "lng">;

type DetailsApiResponse = {
  status: string;
  result?: {
    formatted_address?: string;
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
  results: Array<{
    place_id: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};

/** Convert "HHMM" from Places API to "HH:MM". */
function toHHMM(time: string): string {
  return `${time.slice(0, 2)}:${time.slice(2)}`;
}

/**
 * Build a full weekly hours map from Place Details periods.
 * Also derives openTime/closeTime (Monday preferred) for the optimizer.
 */
function extractWeeklyHours(
  periods: Array<{ open: { day: number; time: string }; close?: { day: number; time: string } }>
): { openTime: string | null; closeTime: string | null; hoursJson: Record<string, { open: string; close: string | null }> | null } {
  if (!periods.length) return { openTime: null, closeTime: null, hoursJson: null };

  // 24/7: single period, day=0, time="0000", no close
  if (periods.length === 1 && periods[0].open.time === "0000" && !periods[0].close) {
    const allDay = { open: "00:00", close: "23:59" };
    const hoursJson = Object.fromEntries([0,1,2,3,4,5,6].map((d) => [String(d), allDay]));
    return { openTime: "00:00", closeTime: "23:59", hoursJson };
  }

  const hoursJson: Record<string, { open: string; close: string | null }> = {};
  for (const period of periods) {
    hoursJson[String(period.open.day)] = {
      open: toHHMM(period.open.time),
      close: period.close ? toHHMM(period.close.time) : null,
    };
  }

  const rep = hoursJson["1"] ?? hoursJson[Object.keys(hoursJson).sort()[0]];
  return {
    openTime: rep?.open ?? null,
    closeTime: rep?.close ?? null,
    hoursJson: Object.keys(hoursJson).length > 0 ? hoursJson : null,
  };
}

/**
 * Resolve a placeId + coordinates via Text Search.
 * When lat/lng are null (e.g. Tabelog-sourced locations), searches by name alone.
 * Pass lat/lng as a geographic bias when you know the approximate area (e.g. the
 * anchor location) — this prevents name collisions for common restaurant names.
 * Returns null on ZERO_RESULTS or any error — never throws.
 */
export async function findPlaceFromText(
  name: string,
  lat: number | null,
  lng: number | null,
  /** Bias radius in metres. Use ~100 when coords are precise (e.g. from a prior
   *  geocode); use ~5000 when coords are only approximate (e.g. anchor hotel). */
  biasRadius = 1000
): Promise<{ placeId: string; lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({ query: name, key: apiKey });
    if (lat !== null && lng !== null) {
      params.set("location", `${lat},${lng}`);
      params.set("radius", String(biasRadius));
    }
    const res = await fetch(`${TEXTSEARCH_BASE}?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as TextSearchApiResponse;
    if (data.status !== "OK" || !data.results.length) return null;
    const r = data.results[0];
    return { placeId: r.place_id, lat: r.geometry.location.lat, lng: r.geometry.location.lng };
  } catch {
    return null;
  }
}

/**
 * Fetch Place Details for a known placeId.
 * Returns null on failure — never throws.
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "formatted_address,rating,user_ratings_total,types,formatted_phone_number,opening_hours",
      key: apiKey,
    });
    const res = await fetch(`${DETAILS_BASE}?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as DetailsApiResponse;
    if (data.status !== "OK" || !data.result) return null;
    const r = data.result;
    const { openTime, closeTime, hoursJson } = r.opening_hours?.periods
      ? extractWeeklyHours(r.opening_hours.periods)
      : { openTime: null, closeTime: null, hoursJson: null };
    return {
      address: r.formatted_address ?? null,
      rating: r.rating ?? null,
      reviewCount: r.user_ratings_total ?? null,
      categories: (r.types ?? []).filter(
        (t) => t !== "point_of_interest" && t !== "establishment"
      ),
      phone: r.formatted_phone_number ?? null,
      openTime,
      closeTime,
      hoursJson,
    };
  } catch {
    return null;
  }
}

/**
 * Orchestrates Text Search → Place Details for one location.
 * Handles Tabelog-sourced locations (placeId starts with "tabelog:") by
 * treating them as if they have no Google placeId — Text Search re-resolves
 * to a real Google placeId and supplies coordinates.
 * Returns a partial enrichment object. Never throws.
 */
export async function enrichLocation(loc: {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}): Promise<Partial<LocationEnrichment>> {
  try {
    const isTabelog = loc.placeId?.startsWith("tabelog:") ?? false;
    const googlePlaceId = isTabelog ? null : loc.placeId;

    // Resolve Google placeId + coordinates if needed
    let resolvedPlaceId = googlePlaceId;
    let resolvedLat = loc.lat;
    let resolvedLng = loc.lng;

    if (!resolvedPlaceId) {
      const found = await findPlaceFromText(loc.name, loc.lat, loc.lng);
      if (!found) return {};
      resolvedPlaceId = found.placeId;
      resolvedLat = found.lat;
      resolvedLng = found.lng;
    }

    const details = await getPlaceDetails(resolvedPlaceId);
    const base: Partial<LocationEnrichment> = {
      placeId: resolvedPlaceId,
      ...(resolvedLat !== null ? { lat: resolvedLat } : {}),
      ...(resolvedLng !== null ? { lng: resolvedLng } : {}),
    };
    if (!details) return base;
    return { ...base, ...details };
  } catch {
    return {};
  }
}
