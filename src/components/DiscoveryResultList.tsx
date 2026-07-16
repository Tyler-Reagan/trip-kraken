"use client";

import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import type { NearbyPlace } from "@/types";
import { useTripStore } from "@/store/tripStore";

export const PRICE_LABELS = ["Free", "$", "$$", "$$$", "$$$$"];

interface Props {
  /** Already-filtered, ranked results — null before the first fetch resolves. */
  results: NearbyPlace[] | null;
  loading: boolean;
  error: string | null;
  /** The day added activities are placed on (ADR-0015); null leaves them unscheduled. */
  anchorDate: string | null;
  /** Placement order to insert an added activity at (e.g. between an along-route search's two
   *  anchor stops, #131); omitted appends to the end of `anchorDate`, as before. */
  insertOrder?: number;
  /** Message shown when a completed search returns nothing. */
  emptyHint?: string;
}

/**
 * The discovery results list, shared by anchored ({@link NearbyDrawer}) and along-route
 * ({@link AlongRouteDrawer}) search. Both surface the same candidate cards and the same
 * "Add to trip" flow (ADR-0009 — providers differ, the result shape and add path don't);
 * only the controls that produce `results` differ, so those stay in each drawer.
 */
export default function DiscoveryResultList({ results, loading, error, anchorDate, insertOrder, emptyHint }: Props) {
  const tripId = useTripStore((s) => s.tripId);
  const trip = useTripStore((s) => s.trip);
  const reload = useTripStore((s) => s.reload);

  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Keep addedIds in sync with trip.locations so that removing a location from the trip
  // (e.g. via the sidebar) clears its "Added" badge here.
  useEffect(() => {
    setAddedIds(new Set(
      (trip?.locations ?? []).map((l) => l.placeId).filter(Boolean) as string[]
    ));
  }, [trip?.locations]);

  async function handleAdd(place: NearbyPlace) {
    if (!tripId) return;
    setAddingId(place.placeId);
    setAddError(null);
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

      if (res.status === 409) {
        // Already in trip — still mark as added
        setAddedIds((prev) => new Set(prev).add(place.placeId));
        await reload();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setAddError(data.error ?? "Failed to add location");
        return;
      }

      const newLocation = await res.json();
      setAddedIds((prev) => new Set(prev).add(place.placeId));

      // If the search is anchored to a day, place the new activity on that day (ADR-0015).
      // An along-route search additionally knows where in the day it belongs (#131).
      if (anchorDate && newLocation.id) {
        await fetch(`/api/trips/${tripId}/placements`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: newLocation.id,
            date: anchorDate,
            ...(insertOrder !== undefined ? { order: insertOrder } : {}),
          }),
        });
      }

      await reload();
    } catch {
      setAddError("Network error. Could not add location.");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {loading && (
        <div className="flex items-center justify-center h-32 text-sm text-faint">
          Loading…
        </div>
      )}

      {!loading && (error || addError) && (
        <div className="p-4 text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-950 m-4 rounded-lg">
          {error ?? addError}
        </div>
      )}

      {!loading && !error && results !== null && results.length === 0 && (
        <div className="flex items-center justify-center h-32 text-sm text-faint px-4 text-center">
          {emptyHint ?? "No results. Try a different search or adjust filters."}
        </div>
      )}

      {!loading && !error && results && results.length > 0 && (
        <ul className="divide-y divide-line">
          {results.map((place) => {
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
  );
}
