"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Location, NearbyPlace } from "@/types";

interface Props {
  tripId: string;
  anchorLocation: Location;
  existingPlaceIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}

const PRICE_LABELS = ["Free", "$", "$$", "$$$", "$$$$"];

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

export default function NearbyDrawer({
  tripId,
  anchorLocation,
  existingPlaceIds,
  onClose,
  onAdded,
}: Props) {
  const [results, setResults] = useState<NearbyPlace[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radius, setRadius] = useState(1000);
  const [type, setType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set(existingPlaceIds));
  const [addingId, setAddingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNearby = useCallback(async (r: number, t: string, kw: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ radius: String(r), limit: "20" });
      if (t) params.set("type", t);
      if (kw.trim()) params.set("keyword", kw.trim());
      const res = await fetch(
        `/api/trips/${tripId}/locations/${anchorLocation.id}/nearby?${params}`
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
  }, [tripId, anchorLocation.id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchNearby(radius, type, keyword), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [radius, type, keyword, fetchNearby]);

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
        }),
      });
      if (res.ok || res.status === 409) {
        setAddedIds((prev) => new Set(prev).add(place.placeId));
        onAdded();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to add location");
      }
    } catch {
      setError("Network error. Could not add location.");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-96 z-40 bg-white shadow-xl flex flex-col border-l border-gray-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Nearby places</h2>
          <p className="text-xs text-gray-500 truncate">{anchorLocation.name}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 mt-0.5"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Controls */}
      <div className="p-4 border-b border-gray-100 space-y-3 shrink-0">
        {/* Type filter */}
        <div className="flex gap-1.5 flex-wrap">
          {PLACE_TYPES.map((pt) => (
            <button
              key={pt.value}
              onClick={() => setType(pt.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                ${type === pt.value
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
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
          placeholder="Search by keyword…"
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />

        {/* Radius */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Radius: {radius >= 1000 ? `${(radius / 1000).toFixed(1)}km` : `${radius}m`}
          </label>
          <input
            type="range"
            min={500}
            max={5000}
            step={500}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-brand-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5">
            <span>500m</span>
            <span>5km</span>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            Loading…
          </div>
        )}

        {!loading && error && (
          <div className="p-4 text-sm text-red-600 bg-red-50 m-4 rounded-lg">
            {error}
          </div>
        )}

        {!loading && !error && results !== null && results.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            No results. Try a larger radius or different type.
          </div>
        )}

        {!loading && !error && results && results.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {results.map((place) => {
              const isAdded = addedIds.has(place.placeId);
              const isAdding = addingId === place.placeId;
              const displayTypes = place.categories
                .slice(0, 2)
                .map((t) => t.replace(/_/g, " "));
              return (
                <li key={place.placeId} className="p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{place.name}</p>
                        {place.priceLevel !== null && (
                          <span className="text-xs text-gray-500 shrink-0">
                            {PRICE_LABELS[place.priceLevel]}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{place.address}</p>
                    </div>
                    <button
                      onClick={() => handleAdd(place)}
                      disabled={isAdded || isAdding}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium shrink-0 transition-colors
                        ${isAdded
                          ? "bg-gray-100 text-gray-400 cursor-default"
                          : "bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                        }`}
                    >
                      {isAdding ? "…" : isAdded ? "Added" : "Add"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                    {place.rating !== null && (
                      <span>★ {place.rating}{place.reviewCount !== null ? ` (${place.reviewCount.toLocaleString()})` : ""}</span>
                    )}
                    {displayTypes.map((t) => (
                      <span key={t} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded capitalize">
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
