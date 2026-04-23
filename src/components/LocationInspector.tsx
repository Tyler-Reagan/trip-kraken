"use client";

import { useState, useEffect } from "react";
import { useTripStore } from "@/store/tripStore";
import type { Location } from "@/types";

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
            <span className="text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
            <span className="text-gray-600 dark:text-gray-300 text-right">{hours}</span>
          </div>
        ))}
      </div>
    );
  }
  if (!loc.openTime && !loc.closeTime) return <p className="text-xs">No hours set</p>;
  if (loc.openTime === "00:00" && loc.closeTime === "23:59") return <p className="text-xs">Always open</p>;
  return <p className="text-xs">{loc.openTime ?? "?"}–{loc.closeTime ?? "?"}</p>;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function DurationEditor({ loc }: { loc: Location }) {
  const tripId = useTripStore((s) => s.tripId);
  const reload = useTripStore((s) => s.reload);

  const savedH = loc.visitDuration != null ? Math.floor(loc.visitDuration / 60) : 0;
  const savedM = loc.visitDuration != null ? loc.visitDuration % 60 : 0;
  const [hours, setHours] = useState(savedH);
  const [mins, setMins] = useState(savedM);

  useEffect(() => {
    setHours(loc.visitDuration != null ? Math.floor(loc.visitDuration / 60) : 0);
    setMins(loc.visitDuration != null ? loc.visitDuration % 60 : 0);
  }, [loc.visitDuration]);

  async function handleBlur() {
    if (!tripId) return;
    const total = hours * 60 + mins;
    if (total === (loc.visitDuration ?? 0)) return;
    await fetch(`/api/trips/${tripId}/locations/${loc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitDuration: total === 0 ? null : total }),
    });
    await reload();
  }

  const inputCls =
    "w-7 text-sm text-center bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-20">Visit duration</span>
      <input
        type="number" min={0} max={23} value={hours}
        onChange={(e) => setHours(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
        onBlur={handleBlur}
        className={inputCls}
        aria-label="Hours"
      />
      <span className="text-xs text-gray-400">h</span>
      <input
        type="number" min={0} max={59} value={mins}
        onChange={(e) => setMins(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
        onBlur={handleBlur}
        className={inputCls}
        aria-label="Minutes"
      />
      <span className="text-xs text-gray-400">m</span>
    </div>
  );
}

export default function LocationInspector() {
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const trip = useTripStore((s) => s.trip);

  if (!inspectedLocationId || !trip) return null;

  const loc = trip.locations.find((l) => l.id === inspectedLocationId);
  if (!loc) return null;

  return (
    <aside className="w-72 shrink-0 card p-4 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-snug">
          {loc.name}
        </h2>
        <button
          onClick={() => setInspectedLocationId(null)}
          className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none shrink-0 transition-colors"
          aria-label="Close inspector"
        >
          ×
        </button>
      </div>

      {/* Rating */}
      {(loc.rating !== null || loc.reviewCount !== null) && (
        <div className="flex items-center gap-1.5 text-sm">
          {loc.rating !== null && (
            <>
              <span className="text-amber-500">★</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{loc.rating.toFixed(1)}</span>
            </>
          )}
          {loc.reviewCount !== null && (
            <span className="text-gray-400 dark:text-gray-500 text-xs">
              ({loc.reviewCount.toLocaleString()} reviews)
            </span>
          )}
        </div>
      )}

      {/* Address */}
      {loc.address && (
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{loc.address}</p>
      )}

      {/* Hours */}
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
        <p className="font-medium text-gray-600 dark:text-gray-300 text-xs">Hours</p>
        <HoursDisplay loc={loc} />
      </div>

      {/* Duration editor — hidden for lodging */}
      {!loc.isLodging && <DurationEditor loc={loc} />}

      {/* Categories */}
      {loc.categories && loc.categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
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

      {/* Enrichment status indicators */}
      {loc.enrichmentStatus === "pending" && (
        <p className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Fetching details…</p>
      )}
      {loc.enrichmentStatus === "failed" && (
        <p className="text-xs text-amber-500 dark:text-amber-400">Details unavailable</p>
      )}
    </aside>
  );
}
