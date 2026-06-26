"use client";

import { useTripStore } from "@/store/tripStore";

/**
 * Read-only timeline of lodging bookings (ADR-0013). Days derive their start/end anchors from
 * these; this just shows the bookings themselves. Editing happens in StayEditor.
 */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
          · {shortDate(s.checkIn)} → {shortDate(s.checkOut)}
        </span>
      ))}
    </div>
  );
}
