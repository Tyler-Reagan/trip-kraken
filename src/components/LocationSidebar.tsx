"use client";

import { useState, useEffect } from "react";
import { useTripStore } from "@/store/tripStore";
import type { Location } from "@/types";

interface Props {
  isDrawer?: boolean;
  onCloseDrawer?: () => void;
}

function LengthOfStayInput({ loc, tripId, reload }: { loc: Location; tripId: string; reload: () => Promise<void> }) {
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
      title="How long you plan to spend here — used to balance day lengths when optimizing"
    >
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 select-none cursor-default">Length of stay:</span>
      <input
        type="number"
        min={0}
        max={23}
        value={hours}
        placeholder="0"
        onChange={(e) => setHours(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
        onBlur={handleBlur}
        className={inputCls}
        aria-label={`Hours for length of stay at ${loc.name}`}
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
        aria-label={`Minutes for length of stay at ${loc.name}`}
      />
      <span className="text-xs text-gray-400 dark:text-gray-500 select-none">m</span>
    </div>
  );
}

function OpeningHours({ loc }: { loc: Location }) {
  if (!loc.openTime && !loc.closeTime) return null;
  return (
    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
      Hours: {loc.openTime ?? "?"} – {loc.closeTime ?? "?"}
    </p>
  );
}

export default function LocationSidebar({ isDrawer, onCloseDrawer }: Props) {
  const trip = useTripStore((s) => s.trip);
  const tripId = useTripStore((s) => s.tripId);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const toggleExcluded = useTripStore((s) => s.toggleExcluded);
  const toggleAnchor = useTripStore((s) => s.toggleAnchor);
  const setNearbyAnchor = useTripStore((s) => s.setNearbyAnchor);
  const showCategoryChips = useTripStore((s) => s.showCategoryChips);
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
                  <LengthOfStayInput loc={loc} tripId={tripId} reload={reload} />
                )}
                <OpeningHours loc={loc} />
                {showCategoryChips && loc.categories && loc.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {loc.categories.map((cat) => (
                      <span
                        key={cat}
                        className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                      >
                        {cat.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <button
                  onClick={() => toggleAnchor(loc.id, !loc.isAnchor)}
                  title={loc.isAnchor ? "Unmark as base (hotel/start point)" : "Mark as base — first stop of every day"}
                  className={`text-xs transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded
                    ${loc.isAnchor
                      ? "opacity-100 text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 cursor-pointer"
                      : "opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 cursor-pointer"
                    }`}
                  aria-label={loc.isAnchor ? `Unmark ${loc.name} as base` : `Mark ${loc.name} as base`}
                  aria-pressed={loc.isAnchor}
                >
                  {loc.isAnchor ? "Base ✓" : "Base"}
                </button>
                <button
                  onClick={() => setNearbyAnchor(loc)}
                  disabled={loc.lat === null || loc.lng === null}
                  title={loc.lat === null ? "No coordinates" : "Find nearby attractions"}
                  className={`text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded
                    ${loc.lat !== null && loc.lng !== null
                      ? "text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 cursor-pointer"
                      : "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                    }`}
                >
                  Nearby
                </button>
                <button
                  onClick={async () => {
                    await fetch(`/api/trips/${tripId}/locations/${loc.id}`, { method: "DELETE" });
                    await reload();
                  }}
                  title="Remove location from trip"
                  className="text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 rounded cursor-pointer"
                  aria-label={`Remove ${loc.name} from trip`}
                >
                  Remove
                </button>
              </div>
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
