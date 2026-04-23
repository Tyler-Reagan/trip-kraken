"use client";

import { useEffect, useRef, useState } from "react";
import type { ItineraryDay, ItineraryStop, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { FlagIcon, FlagFilledIcon, SearchIcon, TrashIcon } from "./icons";

interface Props {
  day: ItineraryDay;
  draggingStop: ItineraryStop | null;
  draggingLocation: Location | null;
  onDragStart: (stop: ItineraryStop) => void;
  onDrop: (day: ItineraryDay, order: number) => void;
}

const LIGHT_DAY_THRESHOLD = 240;

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatHoursSubtext(loc: Location, dayOfWeek?: number): string {
  if (dayOfWeek !== undefined && loc.hoursJson) {
    const entry = loc.hoursJson[String(dayOfWeek)];
    if (!entry) return "Closed";
    if (entry.open === "00:00" && entry.close === "23:59") return "Always open";
    return `${entry.open}–${entry.close ?? "?"}`;
  }
  if (!loc.openTime && !loc.closeTime) return "No hours";
  if (loc.openTime === "00:00" && loc.closeTime === "23:59") return "Always open";
  return `${loc.openTime ?? "?"}–${loc.closeTime ?? "?"}`;
}

export default function DayCard({ day, draggingStop, draggingLocation, onDragStart, onDrop }: Props) {
  const tripId = useTripStore((s) => s.tripId);
  const reload = useTripStore((s) => s.reload);
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);
  const [dragOver, setDragOver] = useState(false);
  const dayOfWeek = day.date ? new Date(day.date).getDay() : undefined;
  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(day.label ?? "");

  const totalMinutes = day.stops.reduce((sum, s) => sum + (s.location.visitDuration ?? 0), 0);
  const anyHasDuration = day.stops.some((s) => s.location.visitDuration !== null);
  const isLightDay = anyHasDuration && totalMinutes < LIGHT_DAY_THRESHOLD && day.stops.length > 0;
  const nearbyDefaultStop = day.stops[0] ?? null;

  const dateStr = day.date
    ? new Date(day.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  async function saveLabel() {
    setEditingLabel(false);
    await fetch(`/api/trips/${tripId}/days/${day.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() || null }),
    });
    reload();
  }

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
    onDrop(day, day.stops.length);
  }

  const isDragTarget = dragOver && (draggingStop !== null || draggingLocation !== null);

  return (
    <div
      className={`card p-4 space-y-3 transition-all
        ${isDragTarget ? "ring-2 ring-brand-400 bg-brand-50 dark:bg-brand-950/20" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Day header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-brand-600 dark:text-brand-400 shrink-0">
            Day {day.dayNumber}
          </span>
          {dateStr && (
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{dateStr}</span>
          )}
          {editingLabel ? (
            <input
              autoFocus
              className="input py-0.5 text-sm"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveLabel();
                if (e.key === "Escape") setEditingLabel(false);
              }}
            />
          ) : (
            <button
              onClick={() => setEditingLabel(true)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 truncate max-w-[160px] transition-colors"
              title="Click to add a label"
            >
              {day.label || <span className="text-gray-300 dark:text-gray-600 italic">Add label…</span>}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {anyHasDuration && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {formatDuration(totalMinutes)}
            </span>
          )}
          {isLightDay && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Light day</span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {day.stops.length} stop{day.stops.length !== 1 ? "s" : ""}
          </span>
          {nearbyDefaultStop && (
            <button
              onClick={() => setNearbySearchLocation(nearbyDefaultStop.location, day.id)}
              disabled={nearbyDefaultStop.location.lat === null}
              title="Find nearby stops for this day"
              className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 disabled:text-gray-300 dark:disabled:text-gray-600 transition-colors"
            >
              Nearby
            </button>
          )}
        </div>
      </div>

      {/* Stops list */}
      {day.stops.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic py-2 text-center">
          Drag stops here or re-optimize
        </p>
      ) : (
        <ol className="space-y-2">
          {day.stops.map((stop, idx) => (
            <StopRow
              key={stop.id}
              stop={stop}
              index={idx}
              isDragging={draggingStop?.id === stop.id}
              dayOfWeek={dayOfWeek}
              dayId={day.id}
              onDragStart={onDragStart}
              onDropBefore={() => onDrop(day, idx)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

interface StopRowProps {
  stop: ItineraryStop;
  index: number;
  isDragging: boolean;
  dayOfWeek?: number;
  dayId: string;
  onDragStart: (stop: ItineraryStop) => void;
  onDropBefore: () => void;
}

function StopRow({ stop, index, isDragging, dayOfWeek, dayId, onDragStart, onDropBefore }: StopRowProps) {
  const tripId = useTripStore((s) => s.tripId);
  const trip = useTripStore((s) => s.trip);
  const reload = useTripStore((s) => s.reload);
  const highlightedLocationId = useTripStore((s) => s.highlightedLocationId);
  const setHighlightedLocationId = useTripStore((s) => s.setHighlightedLocationId);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const toggleLodging = useTripStore((s) => s.toggleLodging);
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);

  const isHighlighted = highlightedLocationId === stop.locationId;
  const isInspected = inspectedLocationId === stop.locationId;
  const [dropTarget, setDropTarget] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"delete" | "unmark" | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  const loc = stop.location;
  const hoursText = formatHoursSubtext(loc, dayOfWeek);
  const durText = loc.visitDuration !== null ? formatDuration(loc.visitDuration) : "—";

  const affectedDayNums = trip
    ? trip.days.filter((d) => d.stops.some((s) => s.locationId === loc.id)).map((d) => d.dayNumber)
    : [];

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  async function doRemoveStop() {
    setConfirmAction(null);
    await fetch(`/api/trips/${tripId}/stops/${stop.id}`, { method: "DELETE" });
    reload();
  }

  function doUnmark() {
    setConfirmAction(null);
    toggleLodging(loc.id, false);
  }

  return (
    <>
      <div
        className={`h-1 rounded-full transition-all ${dropTarget ? "bg-brand-400 h-2" : "bg-transparent"}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(true); }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(e) => { e.stopPropagation(); setDropTarget(false); onDropBefore(); }}
      />

      <li
        ref={rowRef}
        draggable={confirmAction === null}
        onDragStart={() => onDragStart(stop)}
        className={`group flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all select-none
          ${isDragging ? "opacity-40" : ""}
          ${isHighlighted
            ? "ring-2 ring-brand-400 bg-brand-50 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800"
            : isInspected
              ? "bg-gray-100 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
              : loc.isLodging
                ? "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
          }`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          if (confirmAction) { setConfirmAction(null); return; }
          if (isHighlighted) { setHighlightedLocationId(null); return; }
          setInspectedLocationId(isInspected ? null : stop.locationId);
        }}
      >
        {/* Stop number */}
        <span className="shrink-0 w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-400 text-xs flex items-center justify-center font-semibold mt-0.5">
          {index + 1}
        </span>

        {/* Drag handle */}
        <span
          className="shrink-0 text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing mt-0.5 text-base leading-none select-none"
          title="Drag to reorder"
          onMouseDown={(e) => e.stopPropagation()}
        >
          ≡
        </span>

        {/* Name + subtext */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{loc.name}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {hoursText} · {durText}
          </p>
        </div>

        {/* Inline confirmation — replaces action buttons for destructive lodging actions */}
        {confirmAction !== null ? (
          <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              {confirmAction === "delete"
                ? `Remove lodging from Day${affectedDayNums.length > 1 ? "s " + affectedDayNums.join(", ") : " " + affectedDayNums[0]}?`
                : `Remove lodging? Affects Day${affectedDayNums.length > 1 ? "s " + affectedDayNums.join(", ") : " " + affectedDayNums[0]}.`}
            </span>
            <button
              onClick={confirmAction === "delete" ? doRemoveStop : doUnmark}
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
                if (loc.isLodging) { setConfirmAction("unmark"); } else { toggleLodging(loc.id, true); }
              }}
              title={loc.isLodging ? "Remove lodging status" : "Set as lodging — your hotel for this leg"}
              aria-label={loc.isLodging ? "Remove lodging" : "Set as lodging"}
              aria-pressed={loc.isLodging}
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                loc.isLodging
                  ? "text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  : "text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {loc.isLodging ? <FlagFilledIcon /> : <FlagIcon />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setNearbySearchLocation(loc, dayId); }}
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
                if (loc.isLodging) { setConfirmAction("delete"); } else { doRemoveStop(); }
              }}
              title="Remove location from this day"
              aria-label="Remove location"
              className="w-7 h-7 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </li>
    </>
  );
}
