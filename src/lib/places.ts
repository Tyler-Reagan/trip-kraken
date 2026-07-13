import type { NearbyPlace } from "@/types";
import { haversineMeters } from "./travelCost";

/**
 * Places API (New) client (migrated off the deprecated legacy endpoints, #102).
 * Response quirks the code below relies on: zero results come back as an empty
 * object (no status field); errors arrive as a non-200 with an error envelope.
 * Place IDs are unchanged between legacy and New, so stored IDs keep working.
 * No query-shaping: #100's zero-result phrasings no longer reproduce on New
 * (probed live 2026-07-12), so queries are sent verbatim.
 */

const PLACES_BASE = "https://places.googleapis.com/v1";

/** Fields every search maps onto NearbyPlace. */
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.priceLevel",
].join(",");

type NewPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  priceLevel?: string;
  currentOpeningHours?: { openNow?: boolean };
};

type SearchResponse = { places?: NewPlace[] };

/** New expresses price as an enum; NearbyPlace keeps the legacy 0–4 scale. */
const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function stripGenericTypes(types: string[]): string[] {
  return types.filter((t) => t !== "point_of_interest" && t !== "establishment");
}

function toNearbyPlace(p: NewPlace): NearbyPlace {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    categories: stripGenericTypes(p.types ?? []),
    priceLevel: p.priceLevel !== undefined ? (PRICE_LEVELS[p.priceLevel] ?? null) : null,
    distanceMeters: null,
  };
}

function requireApiKey(): string {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  return apiKey;
}

/** POST a search (`places:searchText` / `places:searchNearby`); throws on API errors. */
async function postSearch(
  method: "searchText" | "searchNearby",
  body: Record<string, unknown>,
  fieldMask: string = SEARCH_FIELD_MASK
): Promise<NewPlace[]> {
  const res = await fetch(`${PLACES_BASE}/places:${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": requireApiKey(),
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as SearchResponse & {
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Google Places API error: HTTP ${res.status}`);
  }
  return data.places ?? [];
}

function circle(lat: number, lng: number, radius: number) {
  return { circle: { center: { latitude: lat, longitude: lng }, radius } };
}

export async function searchNearby(
  lat: number,
  lng: number,
  opts: {
    radius?: number;
    keyword?: string;
    limit?: number;
    openNow?: boolean;
  }
): Promise<NearbyPlace[]> {
  const radius = Math.min(opts.radius ?? 1000, 50000);
  const limit = Math.min(opts.limit ?? 20, 20); // New caps at 20 per request (no pagination)

  // A keyword is a free-text query, which only searchText serves. Its circle is
  // a bias, not a restriction (legacy restricted hard), so cut off beyond-radius
  // results in-process to keep the radius meaning what the UI says it means.
  if (opts.keyword) {
    const places = await postSearch("searchText", {
      textQuery: opts.keyword,
      pageSize: limit,
      locationBias: circle(lat, lng, radius),
      ...(opts.openNow ? { openNow: true } : {}),
    });
    return places
      .filter(
        (p) =>
          !p.location ||
          haversineMeters({ lat, lng }, { lat: p.location.latitude, lng: p.location.longitude }) <= radius
      )
      .map(toNearbyPlace);
  }

  // searchNearby has no openNow filter, so request the flag and filter in-process.
  const places = await postSearch(
    "searchNearby",
    {
      locationRestriction: circle(lat, lng, radius),
      maxResultCount: limit,
    },
    opts.openNow ? `${SEARCH_FIELD_MASK},places.currentOpeningHours.openNow` : SEARCH_FIELD_MASK
  );
  const filtered = opts.openNow ? places.filter((p) => p.currentOpeningHours?.openNow) : places;
  return filtered.map(toNearbyPlace);
}

/**
 * Unanchored Places discovery (ADR-0009): a free-text query → a list of candidate
 * places. The list-returning sibling of findPlaceFromText (which returns only the
 * single best match). Used to seed an empty trip (ADR-0010 blank-slate).
 */
export async function searchText(
  query: string,
  opts: { limit?: number; openNow?: boolean } = {}
): Promise<NearbyPlace[]> {
  const places = await postSearch("searchText", {
    textQuery: query,
    pageSize: Math.min(opts.limit ?? 20, 20),
    ...(opts.openNow ? { openNow: true } : {}),
  });
  return places.map(toNearbyPlace);
}

/**
 * Along-route Places discovery (#102): a free-text query scoped to a corridor via a
 * caller-computed encoded polyline. `searchAlongRouteParameters` is the structured
 * mechanism New requires for this — the same query as bare text has no corridor bias
 * and returns unrelated results (#100 prototype finding).
 */
export async function searchAlongRoute(
  query: string,
  polyline: string,
  opts: { limit?: number; openNow?: boolean } = {}
): Promise<NearbyPlace[]> {
  const places = await postSearch("searchText", {
    textQuery: query,
    pageSize: Math.min(opts.limit ?? 20, 20),
    searchAlongRouteParameters: { polyline: { encodedPolyline: polyline } },
    ...(opts.openNow ? { openNow: true } : {}),
  });
  return places.map(toNearbyPlace);
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

type HoursPoint = { day: number; hour: number; minute: number };
type HoursPeriod = { open: HoursPoint; close?: HoursPoint };

type DetailsResponse = {
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  nationalPhoneNumber?: string;
  regularOpeningHours?: { periods?: HoursPeriod[] };
};

function toHHMM(p: HoursPoint): string {
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * Build a full weekly hours map from Place Details periods.
 * Also derives openTime/closeTime (Monday preferred) for the optimizer.
 */
function extractWeeklyHours(
  periods: HoursPeriod[]
): { openTime: string | null; closeTime: string | null; hoursJson: Record<string, { open: string; close: string | null }> | null } {
  if (!periods.length) return { openTime: null, closeTime: null, hoursJson: null };

  // 24/7: single period opening Sunday midnight with no close
  const first = periods[0];
  if (periods.length === 1 && first.open.day === 0 && first.open.hour === 0 && first.open.minute === 0 && !first.close) {
    const allDay = { open: "00:00", close: "23:59" };
    const hoursJson = Object.fromEntries([0,1,2,3,4,5,6].map((d) => [String(d), allDay]));
    return { openTime: "00:00", closeTime: "23:59", hoursJson };
  }

  const hoursJson: Record<string, { open: string; close: string | null }> = {};
  for (const period of periods) {
    hoursJson[String(period.open.day)] = {
      open: toHHMM(period.open),
      close: period.close ? toHHMM(period.close) : null,
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
 * When lat/lng are null, searches by name alone.
 * Pass lat/lng as a geographic bias when you know the approximate area (e.g. the
 * anchor location) — this prevents name collisions for common restaurant names.
 * Returns null on zero results or any error — never throws.
 */
export async function findPlaceFromText(
  name: string,
  lat: number | null,
  lng: number | null,
  /** Bias radius in metres. Use ~100 when coords are precise (e.g. from a prior
   *  geocode); use ~5000 when coords are only approximate (e.g. anchor hotel). */
  biasRadius = 1000
): Promise<{ placeId: string; lat: number; lng: number } | null> {
  try {
    const places = await postSearch(
      "searchText",
      {
        textQuery: name,
        pageSize: 1,
        ...(lat !== null && lng !== null ? { locationBias: circle(lat, lng, biasRadius) } : {}),
      },
      "places.id,places.location"
    );
    const r = places[0];
    if (!r?.location) return null;
    return { placeId: r.id, lat: r.location.latitude, lng: r.location.longitude };
  } catch {
    return null;
  }
}

/**
 * Fetch Place Details for a known placeId.
 * Returns null on failure — never throws.
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  try {
    const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": requireApiKey(),
        "X-Goog-FieldMask":
          "formattedAddress,rating,userRatingCount,types,nationalPhoneNumber,regularOpeningHours",
      },
    });
    if (!res.ok) return null;
    const r = (await res.json()) as DetailsResponse;
    const { openTime, closeTime, hoursJson } = r.regularOpeningHours?.periods
      ? extractWeeklyHours(r.regularOpeningHours.periods)
      : { openTime: null, closeTime: null, hoursJson: null };
    return {
      address: r.formattedAddress ?? null,
      rating: r.rating ?? null,
      reviewCount: r.userRatingCount ?? null,
      categories: stripGenericTypes(r.types ?? []),
      phone: r.nationalPhoneNumber ?? null,
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
 * A location with no Google placeId is resolved via Text Search first.
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
    // Resolve Google placeId + coordinates if needed
    let resolvedPlaceId = loc.placeId;
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
