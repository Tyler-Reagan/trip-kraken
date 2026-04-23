"use client";

import { useState } from "react";
import type { ItineraryStop, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { FlagIcon, FlagFilledIcon, SearchIcon, TrashIcon } from "./icons";

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
  const trip = useTripStore((s) => s.trip);
  const reload = useTripStore((s) => s.reload);
  const toggleAnchor = useTripStore((s) => s.toggleAnchor);
  const setNearbyAnchor = useTripStore((s) => s.setNearbyAnchor);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);

  const isInspected = inspectedLocationId === loc.id;
  const [confirmAction, setConfirmAction] = useState<"delete" | "unmark" | null>(null);
  const hoursText = formatHoursSubtext(loc);
  const durText = loc.visitDuration !== null ? formatDuration(loc.visitDuration) : "—";

  const affectedDayNums = trip
    ? trip.days.filter((d) => d.stops.some((s) => s.locationId === loc.id)).map((d) => d.dayNumber)
    : [];

  async function doRemoveLocation() {
    setConfirmAction(null);
    await fetch(`/api/trips/${tripId}/locations/${loc.id}`, { method: "DELETE" });
    reload();
  }

  function doUnmark() {
    setConfirmAction(null);
    toggleAnchor(loc.id, false);
  }

  return (
    <li
      draggable={confirmAction === null}
      onDragStart={onDragStart}
      className={`group flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all select-none
        ${isInspected
          ? "bg-gray-100 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
          : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
        }`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (confirmAction) { setConfirmAction(null); return; }
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

      {/* Inline confirmation — replaces action buttons for destructive base-location actions */}
      {confirmAction !== null ? (
        <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            {confirmAction === "delete"
              ? "Permanently delete base location?"
              : affectedDayNums.length > 0
                ? `Unmark base? Affects Day${affectedDayNums.length > 1 ? "s " + affectedDayNums.join(", ") : " " + affectedDayNums[0]}.`
                : "Unmark base?"}
          </span>
          <button
            onClick={confirmAction === "delete" ? doRemoveLocation : doUnmark}
            className="text-xs px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmAction(null)}
            className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        /* Normal action buttons */
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (loc.isAnchor) { setConfirmAction("unmark"); } else { toggleAnchor(loc.id, true); }
            }}
            title={loc.isAnchor ? "Unmark as base (hotel / start point)" : "Mark as base — prepended to every day during optimization"}
            aria-label={loc.isAnchor ? "Unmark as base" : "Mark as base"}
            aria-pressed={loc.isAnchor}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              loc.isAnchor
                ? "text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                : "text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {loc.isAnchor ? <FlagFilledIcon /> : <FlagIcon />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setNearbyAnchor(loc, null); }}
            disabled={loc.lat === null}
            title={loc.lat === null ? "No coordinates — run Enrich first" : "Find nearby places anchored to this location"}
            aria-label="Find nearby places"
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <SearchIcon />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (loc.isAnchor) { setConfirmAction("delete"); } else { doRemoveLocation(); }
            }}
            title="Remove location from trip"
            aria-label="Remove location"
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </li>
  );
}
