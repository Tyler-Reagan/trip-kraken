"use client";

import { Star, X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { isActivity, type Location } from "@/types";
import VisitDurationEditor from "@/components/VisitDurationEditor";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun display order

function timeStr(entry: { open: string; close: string | null } | undefined): string {
  if (!entry) return "Closed";
  if (entry.open === "00:00" && entry.close === "23:59") return "Open 24h";
  return `${entry.open}–${entry.close ?? "?"}`;
}

/** Collapse consecutive days with identical hours into ranges like "Mon–Wed". */
function groupHours(
  hoursJson: Record<string, { open: string; close: string | null }>
): Array<{ label: string; hours: string }> {
  const days = DAY_ORDER.map((d) => ({ day: d, hours: timeStr(hoursJson[String(d)]) }));

  const groups: Array<{ label: string; hours: string }> = [];
  let i = 0;
  while (i < days.length) {
    let j = i + 1;
    while (j < days.length && days[j].hours === days[i].hours) j++;
    const span = j - i;
    const label =
      span === 1
        ? DAY_NAMES[days[i].day]
        : `${DAY_NAMES[days[i].day]}–${DAY_NAMES[days[j - 1].day]}`;
    groups.push({ label, hours: days[i].hours });
    i = j;
  }
  return groups;
}

function HoursDisplay({ loc }: { loc: Location }) {
  if (loc.hoursJson && Object.keys(loc.hoursJson).length > 0) {
    const groups = groupHours(loc.hoursJson);
    return (
      <div className="space-y-0.5">
        {groups.map(({ label, hours }) => (
          <div key={label} className="flex justify-between text-xs gap-3">
            <span className="text-sub shrink-0">{label}</span>
            <span className="text-sub text-right">{hours}</span>
          </div>
        ))}
      </div>
    );
  }
  if (!loc.openTime && !loc.closeTime) return <p className="text-xs">No hours set</p>;
  if (loc.openTime === "00:00" && loc.closeTime === "23:59") return <p className="text-xs">Always open</p>;
  return <p className="text-xs">{loc.openTime ?? "?"}–{loc.closeTime ?? "?"}</p>;
}


export default function LocationInspector() {
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const trip = useTripStore((s) => s.trip);

  if (!inspectedLocationId || !trip) return null;

  const loc = trip.locations.find((l) => l.id === inspectedLocationId);
  if (!loc) return null;

  return (
    <aside className="w-full card p-4 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink leading-snug">
          {loc.name}
        </h2>
        <button
          onClick={() => setInspectedLocationId(null)}
          className="text-faint hover:text-sub shrink-0 transition-colors"
          aria-label="Close inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <LocationInspectorContent loc={loc} />
    </aside>
  );
}

/** The inspector's body, shared between the Places-surface side panel above and the
 *  itinerary's anchored popover ({@link InspectorPopover}, #134). */
export function LocationInspectorContent({ loc }: { loc: Location }) {
  return (
    <>
      {/* Rating */}
      {(loc.rating !== null || loc.reviewCount !== null) && (
        <div className="flex items-center gap-1.5 text-sm">
          {loc.rating !== null && (
            <>
              <Star className="w-4 h-4 text-amber-500 fill-current" />
              <span className="font-medium text-ink">{loc.rating.toFixed(1)}</span>
            </>
          )}
          {loc.reviewCount !== null && (
            <span className="text-faint text-xs">
              ({loc.reviewCount.toLocaleString()} reviews)
            </span>
          )}
        </div>
      )}

      {/* Address */}
      {loc.address && (
        <p className="text-xs text-sub leading-relaxed">{loc.address}</p>
      )}

      {/* Hours */}
      <div className="text-xs text-sub space-y-0.5">
        <p className="font-medium text-sub text-xs">Hours</p>
        <HoursDisplay loc={loc} />
      </div>

      {/* Duration editor — only activities are scheduled, so only they carry a visit duration */}
      {isActivity(loc) && (
        <div className="text-xs text-sub space-y-0.5">
          <p className="font-medium text-sub text-xs">Visit duration</p>
          <VisitDurationEditor loc={loc} />
        </div>
      )}

      {/* Categories */}
      {loc.categories && loc.categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {loc.categories.map((cat) => (
            <span
              key={cat}
              className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded bg-surface-2 text-sub"
            >
              {cat.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      {/* Enrichment status indicators */}
      {loc.enrichmentStatus === "pending" && (
        <p className="text-xs text-faint animate-pulse">Fetching details…</p>
      )}
      {loc.enrichmentStatus === "failed" && (
        <p className="text-xs text-amber-500 dark:text-amber-400">Details unavailable</p>
      )}
    </>
  );
}
