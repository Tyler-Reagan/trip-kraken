"use client";

import { useEffect, useRef, useState } from "react";
import type { TripWithDetails, ItineraryDay, ItineraryStop } from "@/types";

interface Props {
  day: ItineraryDay;
  trip: TripWithDetails;
  draggingStop: ItineraryStop | null;
  onDragStart: (stop: ItineraryStop) => void;
  onDrop: (day: ItineraryDay, order: number) => void;
  onReload: () => void;
  highlightedLocationId?: string | null;
  onHighlightClear?: () => void;
}

export default function DayCard({
  day,
  trip,
  draggingStop,
  onDragStart,
  onDrop,
  onReload,
  highlightedLocationId,
  onHighlightClear,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(day.label ?? "");

  const dateStr = day.date
    ? new Date(day.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  async function saveLabel() {
    setEditingLabel(false);
    await fetch(`/api/trips/${trip.id}/days/${day.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() || null }),
    });
    onReload();
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

  return (
    <div
      className={`card p-4 space-y-3 transition-all
        ${dragOver && draggingStop ? "ring-2 ring-brand-400 bg-brand-50" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Day header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-brand-700 shrink-0">
            Day {day.dayNumber}
          </span>
          {dateStr && (
            <span className="text-xs text-gray-400 shrink-0">{dateStr}</span>
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
              className="text-sm text-gray-500 hover:text-gray-800 truncate max-w-[160px]"
              title="Click to add a label"
            >
              {day.label || <span className="text-gray-300 italic">Add label…</span>}
            </button>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {day.stops.length} stop{day.stops.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Stops list */}
      {day.stops.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2 text-center">
          Drag stops here or re-optimize
        </p>
      ) : (
        <ol className="space-y-2">
          {day.stops.map((stop, idx) => (
            <StopRow
              key={stop.id}
              stop={stop}
              index={idx}
              day={day}
              tripId={trip.id}
              isDragging={draggingStop?.id === stop.id}
              isHighlighted={highlightedLocationId === stop.locationId}
              onDragStart={onDragStart}
              onDropBefore={() => onDrop(day, idx)}
              onReload={onReload}
              onHighlightClear={onHighlightClear}
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
  day: ItineraryDay;
  tripId: string;
  isDragging: boolean;
  isHighlighted: boolean;
  onDragStart: (stop: ItineraryStop) => void;
  onDropBefore: () => void;
  onReload: () => void;
  onHighlightClear?: () => void;
}

function StopRow({
  stop,
  index,
  tripId,
  isDragging,
  isHighlighted,
  onDragStart,
  onDropBefore,
  onReload,
  onHighlightClear,
}: StopRowProps) {
  const [dropTarget, setDropTarget] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  // Scroll highlighted stop into view when it becomes active
  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  async function removeStop() {
    await fetch(`/api/trips/${tripId}/stops/${stop.id}`, { method: "DELETE" });
    onReload();
  }

  return (
    <>
      {/* Drop zone above this stop */}
      <div
        className={`h-1 rounded-full transition-all ${
          dropTarget ? "bg-brand-400 h-2" : "bg-transparent"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(e) => {
          e.stopPropagation();
          setDropTarget(false);
          onDropBefore();
        }}
      />

      <li
        ref={rowRef}
        draggable
        onDragStart={() => onDragStart(stop)}
        onClick={() => isHighlighted && onHighlightClear?.()}
        className={`flex items-start gap-3 p-2 rounded-lg border cursor-grab active:cursor-grabbing
          transition-all select-none
          ${isDragging ? "opacity-40" : ""}
          ${isHighlighted
            ? "ring-2 ring-brand-400 bg-brand-50 border-brand-200"
            : "border-transparent hover:bg-gray-50 hover:border-gray-200"
          }`}
      >
        {/* Order badge */}
        <span className="shrink-0 w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs flex items-center justify-center font-semibold mt-0.5">
          {index + 1}
        </span>

        {/* Location info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">
            {stop.location.name}
          </p>
          {stop.location.address && (
            <p className="text-xs text-gray-400 truncate">{stop.location.address}</p>
          )}
        </div>

        {/* Remove button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeStop();
          }}
          className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-lg leading-none mt-0.5"
          title="Remove from this day"
          aria-label="Remove stop"
        >
          ×
        </button>
      </li>
    </>
  );
}
