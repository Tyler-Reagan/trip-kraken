"use client";

import type { Location } from "@/types";

interface Props {
  locations: Location[];
  onToggle: (id: string, excluded: boolean) => void;
}

export default function LocationSidebar({ locations, onToggle }: Props) {
  const included = locations.filter((l) => !l.excluded);
  const excluded = locations.filter((l) => l.excluded);

  return (
    <div className="card p-4 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
      <h2 className="text-sm font-semibold text-gray-700">
        Locations ({included.length} included)
      </h2>

      <ul className="space-y-1">
        {locations.map((loc) => (
          <li
            key={loc.id}
            className={`flex items-start gap-2.5 py-1.5 px-2 rounded-lg transition-colors
              ${loc.excluded ? "opacity-50" : "hover:bg-gray-50"}`}
          >
            <input
              type="checkbox"
              checked={!loc.excluded}
              onChange={(e) => onToggle(loc.id, !e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer shrink-0"
              aria-label={`Include ${loc.name}`}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{loc.name}</p>
              {loc.address && (
                <p className="text-xs text-gray-400 truncate">{loc.address}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {excluded.length > 0 && (
        <p className="text-xs text-gray-400">
          {excluded.length} location{excluded.length !== 1 ? "s" : ""} excluded
          from the itinerary. Re-optimize to apply changes.
        </p>
      )}
    </div>
  );
}
