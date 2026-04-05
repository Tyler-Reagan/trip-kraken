"use client";

import { useTripStore } from "@/store/tripStore";

interface Props {
  isDrawer?: boolean;
  onCloseDrawer?: () => void;
}

export default function LocationSidebar({ isDrawer, onCloseDrawer }: Props) {
  const trip = useTripStore((s) => s.trip);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const toggleExcluded = useTripStore((s) => s.toggleExcluded);
  const setNearbyAnchor = useTripStore((s) => s.setNearbyAnchor);

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
