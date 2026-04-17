"use client";

import { useState } from "react";
import type { ItineraryStop, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";

interface Props {
  locations: Location[];
  draggingStop: ItineraryStop | null;
  onDragStartLocation: (loc: Location) => void;
  onDropStop: () => void;
}

function formatHoursSubtext(loc: Location): string {
  if (!loc.openTime && !loc.closeTime) return "No hours";
  if (loc.openTime === "00:00" && loc.closeTime === "23:59") return "Always open";
  return `${loc.openTime ?? "?"}–${loc.closeTime ?? "?"}`;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function UnassignedCard({ locations, draggingStop, onDragStartLocation, onDropStop }: Props) {
  const [dragOver, setDragOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (draggingStop) onDropStop();
  }

  const isDragTarget = dragOver && draggingStop !== null;

  return (
    <div
      className={`card p-4 space-y-3 border-dashed transition-all
        ${isDragTarget ? "ring-2 ring-brand-400 bg-brand-50 dark:bg-brand-950/20" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Unassigned
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {locations.length} location{locations.length !== 1 ? "s" : ""}
        </span>
      </div>

      {locations.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic py-1 text-center">
          Drag stops here to unschedule them
        </p>
      ) : (
        <ul className="space-y-2">
          {locations.map((loc) => (
            <UnassignedRow
              key={loc.id}
              loc={loc}
              onDragStart={() => onDragStartLocation(loc)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UnassignedRow({ loc, onDragStart }: { loc: Location; onDragStart: () => void }) {
  const tripId = useTripStore((s) => s.tripId);
  const reload = useTripStore((s) => s.reload);
  const toggleAnchor = useTripStore((s) => s.toggleAnchor);
  const setNearbyAnchor = useTripStore((s) => s.setNearbyAnchor);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);

  const isInspected = inspectedLocationId === loc.id;
  const hoursText = formatHoursSubtext(loc);
  const durText = loc.visitDuration !== null ? formatDuration(loc.visitDuration) : "—";

  async function removeLocation() {
    await fetch(`/api/trips/${tripId}/locations/${loc.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <li
      draggable
      onDragStart={onDragStart}
      className={`group flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all select-none
        ${isInspected
          ? "bg-gray-100 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
          : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
        }`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        setInspectedLocationId(isInspected ? null : loc.id);
      }}
    >
      {/* Drag handle */}
      <span
        className="shrink-0 text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing mt-0.5 text-base leading-none select-none"
        title="Drag to a day to schedule"
      >
        ≡
      </span>

      {/* Name + subtext */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{loc.name}</p>
          {loc.enrichmentStatus === "pending" && (
            <span className="text-[10px] text-gray-400 animate-pulse shrink-0">···</span>
          )}
          {loc.enrichmentStatus === "failed" && (
            <span className="text-[10px] text-amber-500 shrink-0 font-bold" title="Enrichment failed">!</span>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {hoursText} · {durText}
        </p>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); toggleAnchor(loc.id, !loc.isAnchor); }}
          title={loc.isAnchor ? "Unmark as base" : "Mark as base — first stop every day"}
          className={`text-sm leading-none px-0.5 transition-colors ${
            loc.isAnchor
              ? "text-amber-500 dark:text-amber-400 hover:text-amber-600"
              : "text-gray-300 dark:text-gray-600 hover:text-amber-500 dark:hover:text-amber-400"
          }`}
          aria-pressed={loc.isAnchor}
        >
          ⚑
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setNearbyAnchor(loc); }}
          disabled={loc.lat === null}
          title="Find nearby"
          className="text-sm leading-none px-0.5 text-gray-300 dark:text-gray-600 hover:text-brand-500 dark:hover:text-brand-400 disabled:cursor-not-allowed transition-colors"
        >
          🔍
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); removeLocation(); }}
          title="Remove from trip"
          className="text-base leading-none px-0.5 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors"
          aria-label="Remove location"
        >
          ×
        </button>
      </div>
    </li>
  );
}
