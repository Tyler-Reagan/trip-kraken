"use client";

import { useState, useEffect } from "react";
import { useTripStore } from "@/store/tripStore";
import type { Location } from "@/types";

interface Props {
  isDrawer?: boolean;
  onCloseDrawer?: () => void;
}

function DurationInput({ loc, tripId, reload }: { loc: Location; tripId: string; reload: () => Promise<void> }) {
  // Use loose != null so both null and undefined (pre-migration rows) map to 0
  const savedHours = loc.visitDuration != null ? Math.floor(loc.visitDuration / 60) : 0;
  const savedMins  = loc.visitDuration != null ? loc.visitDuration % 60 : 0;

  const [hours, setHours] = useState(savedHours);
  const [mins,  setMins]  = useState(savedMins);

  useEffect(() => {
    setHours(loc.visitDuration != null ? Math.floor(loc.visitDuration / 60) : 0);
    setMins(loc.visitDuration != null ? loc.visitDuration % 60 : 0);
  }, [loc.visitDuration]);

  async function handleBlur() {
    const total = hours * 60 + mins;
    const current = loc.visitDuration ?? 0;
    if (total === current) return;
    await fetch(`/api/trips/${tripId}/locations/${loc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitDuration: total === 0 ? null : total }),
    });
    await reload();
  }

  const inputCls = "w-6 text-xs text-center text-gray-400 dark:text-gray-500 bg-transparent border-none focus:outline-none focus:text-gray-600 dark:focus:text-gray-300 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div
      className="flex items-center gap-0.5 mt-0.5"
      title="Estimated time spent at this location — used to balance day lengths when optimizing"
    >
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 select-none cursor-default">Duration:</span>
      <input
        type="number"
        min={0}
        max={23}
        value={hours}
        placeholder="0"
        onChange={(e) => setHours(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
        onBlur={handleBlur}
        className={inputCls}
        aria-label={`Hours for ${loc.name} visit duration`}
      />
      <span className="text-xs text-gray-400 dark:text-gray-500 select-none">h</span>
      <input
        type="number"
        min={0}
        max={59}
        value={mins}
        placeholder="0"
        onChange={(e) => setMins(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
        onBlur={handleBlur}
        className={inputCls}
        aria-label={`Minutes for ${loc.name} visit duration`}
      />
      <span className="text-xs text-gray-400 dark:text-gray-500 select-none">m</span>
    </div>
  );
}

export default function LocationSidebar({ isDrawer, onCloseDrawer }: Props) {
  const trip = useTripStore((s) => s.trip);
  const tripId = useTripStore((s) => s.tripId);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const toggleExcluded = useTripStore((s) => s.toggleExcluded);
  const setNearbyAnchor = useTripStore((s) => s.setNearbyAnchor);
  const reload = useTripStore((s) => s.reload);

  if (!trip) return null;

  const included = trip.locations.filter((l) => !l.excluded);
  const excluded = trip.locations.filter((l) => l.excluded);

  const activeDayLocationIds = selectedDayNumber
    ? new Set(
        trip.days
          .find((d) => d.dayNumber === selectedDayNumber)
          ?.stops.map((s) => s.locationId) ?? []
      )
    : null;

  const content = (
    <div className={`p-4 space-y-4 ${isDrawer ? "" : "max-h-[calc(100vh-10rem)] overflow-y-auto"}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Locations ({included.length} included)
        </h2>
        {isDrawer && onCloseDrawer && (
          <button
            onClick={onCloseDrawer}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>

      <ul className="space-y-1">
        {trip.locations.map((loc) => {
          const dimmed =
            !loc.excluded &&
            activeDayLocationIds !== null &&
            !activeDayLocationIds.has(loc.id);

          return (
            <li
              key={loc.id}
              className={`group flex items-start gap-2.5 py-1.5 px-2 rounded-lg transition-all
                ${loc.excluded || dimmed
                  ? "opacity-30"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
            >
              <input
                type="checkbox"
                checked={!loc.excluded}
                onChange={(e) => toggleExcluded(loc.id, !e.target.checked)}
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 cursor-pointer shrink-0"
                aria-label={`Include ${loc.name}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{loc.name}</p>
                {loc.address && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{loc.address}</p>
                )}
                {tripId && (
                  <DurationInput loc={loc} tripId={tripId} reload={reload} />
                )}
              </div>
              <button
                onClick={() => setNearbyAnchor(loc)}
                disabled={loc.lat === null || loc.lng === null}
                title={loc.lat === null ? "No coordinates" : "Find nearby attractions"}
                className={`shrink-0 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded
                  ${loc.lat !== null && loc.lng !== null
                    ? "text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 cursor-pointer"
                    : "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                  }`}
              >
                Nearby
              </button>
            </li>
          );
        })}
      </ul>

      {excluded.length > 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {excluded.length} location{excluded.length !== 1 ? "s" : ""} excluded from the itinerary.
          Re-optimize to apply changes.
        </p>
      )}
    </div>
  );

  if (isDrawer) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Locations"
        className="card rounded-b-none rounded-t-xl max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-700" />
        </div>
        {content}
      </div>
    );
  }

  return <div className="card">{content}</div>;
}
