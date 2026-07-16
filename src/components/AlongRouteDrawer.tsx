"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronUp, X, ArrowRight } from "lucide-react";
import type { NearbyPlace } from "@/types";
import { useTripStore } from "@/store/tripStore";
import DiscoveryResultList, { PRICE_LABELS } from "./DiscoveryResultList";

const RATING_OPTIONS = [
  { label: "Any",  value: null },
  { label: "3+",   value: 3    },
  { label: "4+",   value: 4    },
  { label: "4.5+", value: 4.5  },
] as const;

// Query-text shortcuts, not API type filters — folded into the free-text query the way anchored
// search does (#100). Route scope *requires* a query, so there's no "All" no-op chip here.
const PLACE_TYPES = [
  { label: "Restaurants", value: "restaurant" },
  { label: "Coffee", value: "coffee" },
  { label: "Attractions", value: "tourist attraction" },
  { label: "Gas", value: "gas station" },
  { label: "Parks", value: "park" },
  { label: "Shopping", value: "shopping" },
];

/**
 * Along-route discovery drawer (#102, chunk 4): free-text search scoped to the corridor between
 * two consecutive stops. Mirrors {@link NearbyDrawer}'s controls minus the ones a corridor doesn't
 * have — no radius (the polyline defines the band) and no source toggle (only Google serves the
 * route scope today). The query is required, so an empty one shows a prompt instead of searching.
 */
export default function AlongRouteDrawer() {
  const tripId = useTripStore((s) => s.tripId);
  const trip = useTripStore((s) => s.trip);
  const routeSearch = useTripStore((s) => s.routeSearch);
  const setRouteSearch = useTripStore((s) => s.setRouteSearch);

  const [results, setResults] = useState<NearbyPlace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [priceLevels, setPriceLevels] = useState<Set<number>>(new Set());
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fromId = routeSearch?.from.id;
  const toId = routeSearch?.to.id;

  const fetchAlongRoute = useCallback(async (q: string, on: boolean) => {
    if (!tripId || !fromId || !toId) return;
    setError(null);
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: fromId, to: toId, q: q.trim(), limit: "20" });
      if (on) params.set("openNow", "true");
      const res = await fetch(`/api/trips/${tripId}/locations/along-route?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load places along the route");
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
  }, [tripId, fromId, toId]);

  const query = [type, keyword.trim()].filter(Boolean).join(" ");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchAlongRoute(query, openNow), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, openNow, fetchAlongRoute]);

  if (!tripId || !trip || !routeSearch) return null;

  // Insert the add between the two anchor stops the corridor search was scoped to, rather than
  // appending it to the day (#131). `from` may be a lodging anchor with no placement of its own
  // (ADR-0015) — in that case there's nothing at/before it to offset from, so the formula below
  // naturally lands on 0, the day's first slot.
  const insertOrder = routeSearch.date
    ? (trip.placements.find((p) => p.locationId === routeSearch.from.id && p.date === routeSearch.date)?.order ?? -1) + 1
    : undefined;

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
      aria-label="Places along the route"
      className="card w-full flex flex-col max-h-[calc(100vh-5rem)] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 border-b border-line shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Along the way</h2>
          <p className="flex items-center gap-1 text-xs text-sub mt-0.5 min-w-0">
            <span className="truncate">{routeSearch.from.name}</span>
            <ArrowRight className="w-3 h-3 shrink-0 text-faint" />
            <span className="truncate">{routeSearch.to.name}</span>
          </p>
        </div>
        <button
          onClick={() => setRouteSearch(null)}
          className="text-faint hover:text-sub transition-colors shrink-0 mt-0.5"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Controls */}
      <div className="p-4 border-b border-line space-y-3 shrink-0">
        {/* Category chips — shortcuts folded into the query text */}
        <div className="flex gap-1.5 flex-wrap">
          {PLACE_TYPES.map((pt) => (
            <button
              key={pt.value}
              onClick={() => setType(type === pt.value ? "" : pt.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                ${type === pt.value
                  ? "bg-brand-600 dark:bg-brand-500 text-white border-brand-600 dark:border-brand-500"
                  : "bg-surface-2 text-sub border-line-strong hover:bg-surface-2 hover:bg-surface-3"
                }`}
            >
              {pt.label}
            </button>
          ))}
        </div>

        {/* Keyword search */}
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Search along the way…"
          className="input py-1.5"
        />

        {/* Secondary filters — collapsed by default (mirrors NearbyDrawer); the toggle surfaces a
            count when any are active so an applied filter is never silently hidden. */}
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
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={openNow}
                onChange={(e) => setOpenNow(e.target.checked)}
                className="rounded border-line-strong text-brand-600 focus:ring-brand-500"
              />
              <span className="text-xs text-sub">Open now</span>
            </label>

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

      {/* Results — a corridor search needs a query, so prompt for one before searching */}
      {!query.trim() ? (
        <div className="flex-1 flex items-center justify-center h-32 text-sm text-faint px-4 text-center">
          Pick a category or type a search to find places along the way.
        </div>
      ) : (
        <DiscoveryResultList
          results={results === null ? null : filtered}
          loading={loading}
          error={error}
          anchorDate={routeSearch.date}
          insertOrder={insertOrder}
          emptyHint="Nothing along this leg. Try a different search or adjust filters."
        />
      )}
    </div>
  );
}
