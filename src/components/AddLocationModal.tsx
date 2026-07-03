"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { NearbyPlace } from "@/types";
import { useTripStore } from "@/store/tripStore";

const PRICE_LABELS = ["Free", "$", "$$", "$$$", "$$$$"];

export default function AddLocationModal() {
  const tripId = useTripStore((s) => s.tripId);
  const trip = useTripStore((s) => s.trip);
  const setShowAddLocation = useTripStore((s) => s.setShowAddLocation);
  const reload = useTripStore((s) => s.reload);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NearbyPlace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror in-trip placeIds so already-added places show as "Added".
  useEffect(() => {
    setAddedIds(new Set(
      (trip?.locations ?? []).map((l) => l.placeId).filter(Boolean) as string[]
    ));
  }, [trip?.locations]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/locations/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Search failed.");
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
  }, [tripId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  if (!tripId) return null;

  async function handleAdd(place: NearbyPlace) {
    setAddingId(place.placeId);
    setError(null);
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
        }),
      });

      // 409 = already in trip; still mark as added.
      if (res.ok || res.status === 409) {
        setAddedIds((prev) => new Set(prev).add(place.placeId));
        await reload();
        return;
      }

      const data = await res.json();
      setError(data.error ?? "Failed to add location.");
    } catch {
      setError("Network error. Could not add location.");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-location-modal-title"
        className="card w-full max-w-md flex flex-col max-h-[80vh] shadow-xl"
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 id="add-location-modal-title" className="text-lg font-semibold text-ink">Add a place</h2>
          <button
            onClick={() => setShowAddLocation(false)}
            className="text-faint hover:text-sub text-xl leading-none transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6">
          <input
            type="text"
            autoFocus
            placeholder="Search Google for a place…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input"
          />
          <p className="mt-2 text-xs text-sub">
            Added places appear in the sidebar. Re-optimize to include them in the schedule.
          </p>
        </div>

        {error && (
          <p className="mx-6 mt-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto mt-3">
          {loading && (
            <div className="flex items-center justify-center h-24 text-sm text-faint">
              Searching…
            </div>
          )}

          {!loading && !error && results !== null && results.length === 0 && (
            <div className="flex items-center justify-center h-24 text-sm text-faint">
              No matches. Try a different search.
            </div>
          )}

          {!loading && !error && query.trim() === "" && (
            <div className="flex items-center justify-center h-24 text-sm text-faint px-6 text-center">
              Type a place name, e.g. “Senso-ji Tokyo”.
            </div>
          )}

          {!loading && results && results.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {results.map((place) => {
                const isAdded = addedIds.has(place.placeId);
                const isAdding = addingId === place.placeId;
                const displayTypes = place.categories.slice(0, 2).map((t) => t.replace(/_/g, " "));
                return (
                  <li key={place.placeId} className="px-6 py-3 space-y-1.5">
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
                        <p className="text-xs text-faint truncate">{place.address}</p>
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
                        <span>★ {place.rating}{place.reviewCount !== null ? ` (${place.reviewCount.toLocaleString()})` : ""}</span>
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

        <div className="p-4 border-t border-line">
          <button onClick={() => setShowAddLocation(false)} className="btn-secondary w-full">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
