"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Star, X } from "lucide-react";
import { deriveDays, type NearbyPlace } from "@/types";
import { useTripStore } from "@/store/tripStore";

type ProviderOption = { id: string; label: string };

const PRICE_LABELS = ["Free", "$", "$$", "$$$", "$$$$"];

const RATING_OPTIONS = [
  { label: "Any",  value: null },
  { label: "3+",   value: 3    },
  { label: "4+",   value: 4    },
  { label: "4.5+", value: 4.5  },
] as const;

const PLACE_TYPES = [
  { label: "All", value: "" },
  { label: "Restaurants", value: "restaurant" },
  { label: "Attractions", value: "tourist_attraction" },
  { label: "Cafes", value: "cafe" },
  { label: "Museums", value: "museum" },
  { label: "Parks", value: "park" },
  { label: "Shopping", value: "shopping_mall" },
  { label: "Bars", value: "bar" },
];

export default function NearbyDrawer() {
  const tripId = useTripStore((s) => s.tripId);
  const trip = useTripStore((s) => s.trip);
  const searchLocation = useTripStore((s) => s.nearbySearchLocation);
  const searchDate = useTripStore((s) => s.nearbySearchDate);
  const setSearchLocation = useTripStore((s) => s.setNearbySearchLocation);
  const reload = useTripStore((s) => s.reload);

  // The day the search is anchored to: the date it was opened with, else the day this location is
  // placed on. Drives the diversity bonus and the location picker (ADR-0015 — days are derived).
  const days = trip ? deriveDays(trip) : [];
  const searchDay =
    (searchDate ? days.find((d) => d.date === searchDate) : null) ??
    (searchLocation ? days.find((d) => d.stops.some((s) => s.location.id === searchLocation.id)) : null) ??
    null;
  const anchorDate = searchDay?.date ?? searchDate ?? null;
  const dayStops = searchDay?.stops ?? [];

  const existingPlaceIds = new Set(
    (trip?.locations ?? []).map((l) => l.placeId).filter(Boolean) as string[]
  );

  const [results, setResults] = useState<NearbyPlace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radius, setRadius] = useState(1000);
  const [type, setType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [providers, setProviders] = useState<ProviderOption[]>([{ id: "google", label: "Google" }]);
  const [source, setSource] = useState<string>("google");
  const [openNow, setOpenNow] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [priceLevels, setPriceLevels] = useState<Set<number>>(new Set());
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set(existingPlaceIds));
  const [addingId, setAddingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep addedIds in sync with trip.locations so that removing a location
  // from the trip (e.g. via the sidebar) clears its "Added" badge here.
  useEffect(() => {
    setAddedIds(new Set(
      (trip?.locations ?? []).map((l) => l.placeId).filter(Boolean) as string[]
    ));
  }, [trip?.locations]);

  if (!tripId || !trip || !searchLocation) return null;

  // Anchored providers that apply at this location (Tabelog is dropped outside
  // Japan via appliesAt) — drives the source toggle (ADR-0009).
  useEffect(() => {
    const params = new URLSearchParams({ mode: "anchored" });
    if (searchLocation.lat !== null && searchLocation.lng !== null) {
      params.set("lat", String(searchLocation.lat));
      params.set("lng", String(searchLocation.lng));
    }
    fetch(`/api/discovery/providers?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((list: ProviderOption[] | null) => { if (list?.length) setProviders(list); })
      .catch(() => { /* keep the default google-only toggle */ });
  }, [searchLocation.lat, searchLocation.lng]);

  // If the selected source no longer applies (e.g. anchor moved out of Japan), fall back.
  useEffect(() => {
    if (!providers.some((p) => p.id === source)) setSource(providers[0]?.id ?? "google");
  }, [providers, source]);

  const fetchNearby = useCallback(async (
    r: number, t: string, kw: string, on: boolean, date: string | null, src: string
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ radius: String(r), limit: "20" });
      if (t) params.set("type", t);
      if (kw.trim()) params.set("keyword", kw.trim());
      if (on) params.set("openNow", "true");
      if (date) params.set("date", date);
      params.set("source", src);
      const res = await fetch(
        `/api/trips/${tripId}/locations/${searchLocation.id}/nearby?${params}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load nearby places");
        setResults(null);
      } else {
        setResults(data as NearbyPlace[]);
      }
    } catch {
      setError("Network error. Check your connection.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [tripId, searchLocation.id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => fetchNearby(radius, type, keyword, openNow, anchorDate, source),
      400
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [radius, type, keyword, openNow, anchorDate, source, fetchNearby]);

  async function handleAdd(place: NearbyPlace) {
    setAddingId(place.placeId);
    try {
      const res = await fetch(`/api/trips/${tripId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          placeId: place.placeId,
          rating: place.rating,
          reviewCount: place.reviewCount,
          categories: place.categories,
          // Anchor coordinates used as a Text Search bias when geocoding Tabelog
          // locations (which have no coordinates in the scraper response).
          hintLat: searchLocation?.lat ?? null,
          hintLng: searchLocation?.lng ?? null,
        }),
      });

      if (res.status === 409) {
        // Already in trip — still mark as added
        setAddedIds((prev) => new Set(prev).add(place.placeId));
        await reload();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to add location");
        return;
      }

      const newLocation = await res.json();
      setAddedIds((prev) => new Set(prev).add(place.placeId));

      // If the search is anchored to a day, place the new activity on that day (ADR-0015).
      if (anchorDate && newLocation.id) {
        await fetch(`/api/trips/${tripId}/placements`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationId: newLocation.id, date: anchorDate }),
        });
      }

      await reload();
    } catch {
      setError("Network error. Could not add location.");
    } finally {
      setAddingId(null);
    }
  }

  // Client-side post-filters (rating and price — not supported as Google API params)
  const filtered = (results ?? []).filter((p) => {
    if (minRating !== null && (p.rating === null || p.rating < minRating)) return false;
    if (priceLevels.size > 0 && (p.priceLevel === null || !priceLevels.has(p.priceLevel))) return false;
    return true;
  });

  function togglePriceLevel(level: number) {
    setPriceLevels((prev) => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
  }

  return (
    <div
      role="complementary"
      aria-label="Nearby places"
      className="w-full flex flex-col max-h-[calc(100vh-5rem)] rounded-xl border border-line bg-surface shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 border-b border-line shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Nearby places</h2>
          {dayStops.length > 1 ? (
            <select
              value={searchLocation.id}
              onChange={(e) => {
                const picked = dayStops.find((s) => s.location.id === e.target.value);
                if (picked) setSearchLocation(picked.location, anchorDate);
              }}
              className="w-full text-xs text-sub bg-transparent border-none outline-none cursor-pointer truncate mt-0.5 pr-1"
            >
              {dayStops.map((s) => (
                <option key={s.location.id} value={s.location.id} className="bg-surface">
                  {s.location.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-sub truncate">{searchLocation.name}</p>
          )}
        </div>
        <button
          onClick={() => setSearchLocation(null)}
          className="text-faint hover:text-sub transition-colors shrink-0 mt-0.5"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Controls */}
      <div className="p-4 border-b border-line space-y-3 shrink-0">
        {/* Source toggle — only shown when more than one provider applies here */}
        {providers.length > 1 && (
          <div className="flex rounded-lg border border-line border-line-strong overflow-hidden text-xs w-fit">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => setSource(p.id)}
                className={`px-3 py-1.5 font-medium transition-colors
                  ${source === p.id
                    ? "bg-brand-600 dark:bg-brand-500 text-white"
                    : "bg-surface-2 text-sub hover:bg-surface-2 hover:bg-surface-3"
                  }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Type filter — Google only */}
        {source === "google" && <div className="flex gap-1.5 flex-wrap">
          {PLACE_TYPES.map((pt) => (
            <button
              key={pt.value}
              onClick={() => setType(pt.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                ${type === pt.value
                  ? "bg-brand-600 dark:bg-brand-500 text-white border-brand-600 dark:border-brand-500"
                  : "bg-surface-2 text-sub border-line-strong hover:bg-surface-2 hover:bg-surface-3"
                }`}
            >
              {pt.label}
            </button>
          ))}
        </div>}

        {/* Keyword search */}
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Search by keyword…"
          className="input py-1.5"
        />

        {/* Radius */}
        <div>
          <label className="block text-xs font-medium text-sub mb-1">
            Radius: {radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`}
          </label>
          <input
            type="range"
            min={500}
            max={5000}
            step={500}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-brand-500"
          />
          <div className="flex justify-between text-xs text-faint mt-0.5">
            <span>500m</span>
            <span>5km</span>
          </div>
        </div>

        {/* Open now — Google only (Tabelog listings don't expose current open status) */}
        {source === "google" && <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={openNow}
            onChange={(e) => setOpenNow(e.target.checked)}
            className="rounded border-line-strong text-brand-600 focus:ring-brand-500"
          />
          <span className="text-xs text-sub">Open now</span>
        </label>}

        {/* Min rating */}
        <div>
          <p className="text-xs font-medium text-sub mb-1">Min rating</p>
          <div className="flex gap-1">
            {RATING_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setMinRating(opt.value)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors
                  ${minRating === opt.value
                    ? "bg-brand-600 dark:bg-brand-500 text-white border-brand-600 dark:border-brand-500"
                    : "bg-surface-2 text-sub border-line-strong hover:bg-surface-2 hover:bg-surface-3"
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price level */}
        <div>
          <p className="text-xs font-medium text-sub mb-1">Price</p>
          <div className="flex gap-1">
            {PRICE_LABELS.map((label, level) => (
              <button
                key={level}
                onClick={() => togglePriceLevel(level)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors
                  ${priceLevels.has(level)
                    ? "bg-brand-600 dark:bg-brand-500 text-white border-brand-600 dark:border-brand-500"
                    : "bg-surface-2 text-sub border-line-strong hover:bg-surface-2 hover:bg-surface-3"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-32 text-sm text-faint">
            Loading…
          </div>
        )}

        {!loading && error && (
          <div className="p-4 text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-950 m-4 rounded-lg">
            {error}
          </div>
        )}

        {!loading && !error && results !== null && filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-faint">
            No results. Try a larger radius or adjust filters.
          </div>
        )}

        {!loading && !error && results && filtered.length > 0 && (
          <ul className="divide-y divide-line">
            {filtered.map((place) => {
              const isAdded = addedIds.has(place.placeId);
              const isAdding = addingId === place.placeId;
              const displayTypes = place.categories
                .slice(0, 2)
                .map((t) => t.replace(/_/g, " "));
              const distLabel = place.distanceMeters !== null
                ? place.distanceMeters >= 1000
                  ? `~${(place.distanceMeters / 1000).toFixed(1)}km`
                  : `~${place.distanceMeters}m`
                : null;
              return (
                <li key={place.placeId} className="p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-ink truncate">{place.name}</p>
                        {place.priceLevel !== null && (
                          <span className="text-xs text-sub shrink-0">
                            {PRICE_LABELS[place.priceLevel]}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs text-faint truncate">{place.address}</p>
                        {distLabel && (
                          <span className="text-xs text-brand-500 dark:text-brand-400 shrink-0 font-medium">
                            {distLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAdd(place)}
                      disabled={isAdded || isAdding}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium shrink-0 transition-colors
                        ${isAdded
                          ? "bg-surface-2 text-faint cursor-default"
                          : "bg-brand-600 dark:bg-brand-500 text-white hover:bg-brand-700 dark:hover:bg-brand-400 disabled:opacity-50"
                        }`}
                    >
                      {isAdding ? "…" : isAdded ? "Added" : "Add"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sub flex-wrap">
                    {place.rating !== null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="w-3 h-3 fill-current" />
                        {place.rating}{place.reviewCount !== null ? ` (${place.reviewCount.toLocaleString()})` : ""}
                      </span>
                    )}
                    {displayTypes.map((t) => (
                      <span key={t} className="bg-surface-2 text-sub px-1.5 py-0.5 rounded capitalize">
                        {t}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
