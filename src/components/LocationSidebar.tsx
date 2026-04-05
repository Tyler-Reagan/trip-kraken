"use client";

import type { Location } from "@/types";

interface Props {
  locations: Location[];
  activeDayLocationIds: Set<string> | null;
  onToggle: (id: string, excluded: boolean) => void;
  onFindNearby: (location: Location) => void;
}

export default function LocationSidebar({
  locations,
  activeDayLocationIds,
  onToggle,
  onFindNearby,
}: Props) {
  const included = locations.filter((l) => !l.excluded);
  const excluded = locations.filter((l) => l.excluded);

  return (
    <div className="card p-4 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Locations ({included.length} included)
      </h2>

      <ul className="space-y-1">
        {locations.map((loc) => {
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
                onChange={(e) => onToggle(loc.id, !e.target.checked)}
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
                onClick={() => onFindNearby(loc)}
                disabled={loc.lat === null || loc.lng === null}
                title={loc.lat === null ? "No coordinates — geocoding failed" : "Find nearby attractions"}
                className={`shrink-0 text-xs opacity-0 group-hover:opacity-100 transition-opacity
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
          {excluded.length} location{excluded.length !== 1 ? "s" : ""} excluded
          from the itinerary. Re-optimize to apply changes.
        </p>
      )}
    </div>
  );
}
