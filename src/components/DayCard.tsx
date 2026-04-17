"use client";

import { useEffect, useRef, useState } from "react";
import type { ItineraryDay, ItineraryStop, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";

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

function formatHoursSubtext(loc: Location): string {
  if (!loc.openTime && !loc.closeTime) return "No hours";
  if (loc.openTime === "00:00" && loc.closeTime === "23:59") return "Always open";
  return `${loc.openTime ?? "?"}–${loc.closeTime ?? "?"}`;
}

export default function DayCard({ day, draggingStop, draggingLocation, onDragStart, onDrop }: Props) {
  const tripId = useTripStore((s) => s.tripId);
  const reload = useTripStore((s) => s.reload);
  const setNearbyAnchor = useTripStore((s) => s.setNearbyAnchor);
  const [dragOver, setDragOver] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(day.label ?? "");

  const totalMinutes = day.stops.reduce((sum, s) => sum + (s.location.visitDuration ?? 0), 0);
  const anyHasDuration = day.stops.some((s) => s.location.visitDuration !== null);
  const isLightDay = anyHasDuration && totalMinutes < LIGHT_DAY_THRESHOLD && day.stops.length > 0;
  const nearbyDefaultStop =
    day.stops.find((s) => !s.location.isAnchor) ?? day.stops[0] ?? null;

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
              onClick={() => setNearbyAnchor(nearbyDefaultStop.location)}
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
  onDragStart: (stop: ItineraryStop) => void;
  onDropBefore: () => void;
}

function StopRow({ stop, index, isDragging, onDragStart, onDropBefore }: StopRowProps) {
  const tripId = useTripStore((s) => s.tripId);
  const reload = useTripStore((s) => s.reload);
  const highlightedLocationId = useTripStore((s) => s.highlightedLocationId);
  const setHighlightedLocationId = useTripStore((s) => s.setHighlightedLocationId);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const toggleAnchor = useTripStore((s) => s.toggleAnchor);
  const setNearbyAnchor = useTripStore((s) => s.setNearbyAnchor);

  const isHighlighted = highlightedLocationId === stop.locationId;
  const isInspected = inspectedLocationId === stop.locationId;
  const [dropTarget, setDropTarget] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  const loc = stop.location;
  const hoursText = formatHoursSubtext(loc);
  const durText = loc.visitDuration !== null ? formatDuration(loc.visitDuration) : "—";

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  async function removeStop() {
    await fetch(`/api/trips/${tripId}/stops/${stop.id}`, { method: "DELETE" });
    reload();
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
        draggable
        onDragStart={() => onDragStart(stop)}
        className={`group flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all select-none
          ${isDragging ? "opacity-40" : ""}
          ${isHighlighted
            ? "ring-2 ring-brand-400 bg-brand-50 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800"
            : isInspected
              ? "bg-gray-100 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
              : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
          }`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
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
            onClick={(e) => { e.stopPropagation(); removeStop(); }}
            title="Remove from trip"
            className="text-base leading-none px-0.5 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors"
            aria-label="Remove stop"
          >
            ×
          </button>
        </div>
      </li>
    </>
  );
}
