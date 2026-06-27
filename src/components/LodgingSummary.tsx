"use client";

import { useTripStore } from "@/store/tripStore";

/**
 * Read-only timeline of lodging bookings (ADR-0014). Days derive their start/end anchors from
 * these; this just shows the bookings themselves. Editing happens in StayEditor.
 */
const shortDate = (date: string) =>
  // Parse as local midnight so a "YYYY-MM-DD" date isn't shifted a day by UTC interpretation.
  new Date(date.slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function LodgingSummary() {
  const trip = useTripStore((s) => s.trip);
  const stays = trip?.stays ?? [];
  if (stays.length === 0) return null;

  const nameById = new Map((trip?.locations ?? []).map((l) => [l.id, l.name]));

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
      {stays.map((s) => (
        <span key={s.id} className="whitespace-nowrap">
          <span className="font-medium text-gray-700 dark:text-gray-200">
            {nameById.get(s.lodgingLocationId) ?? "Lodging"}
          </span>{" "}
          · {shortDate(s.checkInDate)} → {shortDate(s.checkOutDate)}
        </span>
      ))}
    </div>
  );
}
