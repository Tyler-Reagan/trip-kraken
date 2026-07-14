"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { deriveDays, type NearbyPlace } from "@/types";
import { useTripStore } from "@/store/tripStore";
import DiscoveryResultList, { PRICE_LABELS } from "./DiscoveryResultList";

type ProviderOption = { id: string; label: string };

const RATING_OPTIONS = [
  { label: "Any",  value: null },
  { label: "3+",   value: 3    },
  { label: "4+",   value: 4    },
  { label: "4.5+", value: 4.5  },
] as const;

// Query-text shortcuts, not API type filters: the chip folds into the free-text
// query (#100 — category lookup is a text-search problem, not a type filter).
const PLACE_TYPES = [
  { label: "All", value: "" },
  { label: "Restaurants", value: "restaurant" },
  { label: "Attractions", value: "tourist attraction" },
  { label: "Cafes", value: "cafe" },
  { label: "Museums", value: "museum" },
  { label: "Parks", value: "park" },
  { label: "Shopping", value: "shopping" },
  { label: "Bars", value: "bar" },
];

export default function NearbyDrawer() {
  const tripId = useTripStore((s) => s.tripId);
  const trip = useTripStore((s) => s.trip);
  const searchLocation = useTripStore((s) => s.nearbySearchLocation);
  const searchDate = useTripStore((s) => s.nearbySearchDate);
  const setSearchLocation = useTripStore((s) => s.setNearbySearchLocation);

  // The day the search is anchored to: the date it was opened with, else the day this location is
  // placed on. Drives the diversity bonus and the location picker (ADR-0015 — days are derived).
  const days = trip ? deriveDays(trip) : [];
  const searchDay =
    (searchDate ? days.find((d) => d.date === searchDate) : null) ??
    (searchLocation ? days.find((d) => d.stops.some((s) => s.location.id === searchLocation.id)) : null) ??
    null;
  const anchorDate = searchDay?.date ?? searchDate ?? null;
  const dayStops = searchDay?.stops ?? [];

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
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!tripId || !trip || !searchLocation) return null;

  // Anchored providers that apply at this location — drives the source toggle
  // (ADR-0009). Only Google today; regional providers gate via applies(scope).
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
      const q = [t, kw.trim()].filter(Boolean).join(" ");
      if (q) params.set("keyword", q);
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

  // Client-side post-filters (rating and price — not supported as Google API params)
  const filtered = (results ?? []).filter((p) => {
    if (minRating !== null && (p.rating === null || p.rating < minRating)) return false;
    if (priceLevels.size > 0 && (p.priceLevel === null || !priceLevels.has(p.priceLevel))) return false;
    return true;
  });

  const activeMoreFiltersCount =
    (openNow ? 1 : 0) + (minRating !== null ? 1 : 0) + (priceLevels.size > 0 ? 1 : 0);

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
      className="card w-full flex flex-col max-h-[calc(100vh-5rem)] overflow-hidden"
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

        {/* Category chips — shortcuts folded into the query text */}
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

        {/* Secondary filters — collapsed by default so the 320px drawer doesn't stack every
            control group at once; the toggle label surfaces a count when any are active so
            they're never silently hiding an applied filter. */}
        <button
          onClick={() => setShowMoreFilters((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-sub hover:text-ink transition-colors"
        >
          {showMoreFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          More filters
          {!showMoreFilters && activeMoreFiltersCount > 0 ? ` (${activeMoreFiltersCount})` : ""}
        </button>

        {showMoreFilters && (
          <div className="space-y-3">
            {/* Open now — a Google capability; hidden for sources that don't expose live open status */}
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
        )}
      </div>

      {/* Results */}
      <DiscoveryResultList
        results={results === null ? null : filtered}
        loading={loading}
        error={error}
        anchorDate={anchorDate}
        emptyHint="No results. Try a larger radius or adjust filters."
      />
    </div>
  );
}
