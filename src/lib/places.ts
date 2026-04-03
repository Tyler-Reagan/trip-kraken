import type { NearbyPlace } from "@/types";

const NEARBY_BASE = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

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
