"use client";

import { useEffect, useRef, useState } from "react";
import type { DerivedDay, ScheduledStop, Lodging, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { dayColorCss, dayTextColor } from "@/lib/dayColors";
import { GripVertical, Search, Trash2 } from "lucide-react";

interface Props {
  day: DerivedDay;
  draggingStop: ScheduledStop | null;
  draggingLocation: Location | null;
  onDragStart: (stop: ScheduledStop) => void;
  onDrop: (day: DerivedDay, order: number) => void;
}

const LIGHT_DAY_THRESHOLD = 240;

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatHoursSubtext(loc: Location, dayOfWeek: number): string {
  if (loc.hoursJson) {
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
  const setDayLabel = useTripStore((s) => s.setDayLabel);
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);
  const [dragOver, setDragOver] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(day.label ?? "");

  const dayOfWeek = new Date(day.date + "T00:00:00").getDay();
  const totalMinutes = day.stops.reduce((sum, s) => sum + (s.location.visitDuration ?? 0), 0);
  const anyHasDuration = day.stops.some((s) => s.location.visitDuration !== null);
  const isLightDay = anyHasDuration && totalMinutes < LIGHT_DAY_THRESHOLD && day.stops.length > 0;
  const nearbyAnchorLoc: Location | null = day.startAnchor ?? day.stops[0]?.location ?? null;

  const dateStr = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  function saveLabel() {
    setEditingLabel(false);
    setDayLabel(day.date, label.trim() || null);
  }

  const isDragTarget = dragOver && (draggingStop !== null || draggingLocation !== null);

  return (
    <div
      className={`card p-4 space-y-3 transition-all ${isDragTarget ? "ring-2 ring-brand-400 bg-brand-50 dark:bg-brand-950/20" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(day, day.stops.length); }}
    >
      {/* Day header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: dayColorCss(day.dayNumber) }}
              aria-hidden
            />
            <span className="text-base font-semibold text-ink">Day {day.dayNumber}</span>
          </span>
          <span className="text-meta text-faint shrink-0">{dateStr}</span>
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
              className="text-sm text-sub hover:text-ink truncate max-w-[160px] transition-colors"
              title="Click to add a label"
            >
              {day.label || <span className="text-faint italic">Add label…</span>}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {anyHasDuration && <span className="text-numeral text-faint">{formatDuration(totalMinutes)}</span>}
          {isLightDay && <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Light day</span>}
          <span className="text-meta text-faint">
            {day.stops.length} stop{day.stops.length !== 1 ? "s" : ""}
          </span>
          {nearbyAnchorLoc && (
            <button
              onClick={() => setNearbySearchLocation(nearbyAnchorLoc, day.date)}
              disabled={nearbyAnchorLoc.lat === null}
              title="Find nearby stops for this day"
              className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 disabled:text-ghost transition-colors"
            >
              Nearby
            </button>
          )}
        </div>
      </div>

      {/* Stops list, between the day's projected lodging bookends */}
      <ol className="space-y-2">
        {day.startAnchor && <AnchorRow loc={day.startAnchor} role="start" date={day.date} />}
        {day.checkInWaypoint && <AnchorRow loc={day.checkInWaypoint} role="checkin" date={day.date} />}
        {day.stops.map((stop, idx) => (
          <StopRow
            key={stop.placement.id}
            stop={stop}
            index={idx}
            dayNumber={day.dayNumber}
            isDragging={draggingStop?.placement.id === stop.placement.id}
            dayOfWeek={dayOfWeek}
            date={day.date}
            onDragStart={onDragStart}
            onDropBefore={() => onDrop(day, idx)}
          />
        ))}
        {day.endAnchor && <AnchorRow loc={day.endAnchor} role="end" date={day.date} />}
      </ol>
      {day.stops.length === 0 && (
        <p className="text-sm text-faint italic py-1 text-center">Drag stops here or re-optimize</p>
      )}
    </div>
  );
}

/** A day's projected lodging bookend (ADR-0015): where you woke / sleep / dropped bags. Lodging is
 *  derived from booking dates, never a stored stop, so these rows are read-only anchors. */
function AnchorRow({ loc, role, date }: { loc: Lodging; role: "start" | "end" | "checkin"; date: string }) {
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const subtext = role === "checkin" ? "Check-in · drop bags" : role === "start" ? "Start of day" : "Overnight";

  return (
    <li
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        setInspectedLocationId(loc.id);
      }}
      className="group flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-900/30"
    >
      <span className="shrink-0 px-1.5 h-5 flex items-center rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
        {role === "checkin" ? "Check-in" : "Stay"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-body truncate text-ink">{loc.name}</p>
        <p className="text-meta mt-0.5 text-amber-600/80 dark:text-amber-400/80">{subtext}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setNearbySearchLocation(loc, date); }}
        disabled={loc.lat === null}
        title="Find nearby places"
        aria-label="Find nearby places"
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-faint hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed hover-reveal transition-all"
      >
        <Search className="w-4 h-4" />
      </button>
    </li>
  );
}

interface StopRowProps {
  stop: ScheduledStop;
  index: number;
  dayNumber: number;
  isDragging: boolean;
  dayOfWeek: number;
  date: string;
  onDragStart: (stop: ScheduledStop) => void;
  onDropBefore: () => void;
}

function StopRow({ stop, index, dayNumber, isDragging, dayOfWeek, date, onDragStart, onDropBefore }: StopRowProps) {
  const removePlacement = useTripStore((s) => s.removePlacement);
  const highlightedLocationId = useTripStore((s) => s.highlightedLocationId);
  const setHighlightedLocationId = useTripStore((s) => s.setHighlightedLocationId);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);

  const loc = stop.location;
  const isHighlighted = highlightedLocationId === loc.id;
  const isInspected = inspectedLocationId === loc.id;
  const [dropTarget, setDropTarget] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  const hoursText = formatHoursSubtext(loc, dayOfWeek);
  const durText = loc.visitDuration !== null ? formatDuration(loc.visitDuration) : "—";

  useEffect(() => {
    if (isHighlighted && rowRef.current) rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isHighlighted]);

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
              ? "bg-surface-2 border-line border-line-strong"
              : "border-transparent hover:bg-surface-2 hover:border-line-strong"
          }`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          if (isHighlighted) { setHighlightedLocationId(null); return; }
          setInspectedLocationId(isInspected ? null : loc.id);
        }}
      >
        <span
          className="shrink-0 w-5 h-5 rounded-full text-xs flex items-center justify-center font-semibold mt-0.5"
          style={{ backgroundColor: dayColorCss(dayNumber), color: dayTextColor(dayNumber) }}
        >
          {index + 1}
        </span>
        <span
          className="shrink-0 text-ghost cursor-grab active:cursor-grabbing mt-0.5 select-none"
          title="Drag to reorder"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-body truncate text-ink">{loc.name}</p>
          <p className="text-numeral text-faint mt-0.5">{hoursText} · {durText}</p>
        </div>
        <div className="shrink-0 flex items-center gap-0.5 hover-reveal transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); setNearbySearchLocation(loc, date); }}
            disabled={loc.lat === null}
            title={loc.lat === null ? "No coordinates — run Enrich first" : "Find nearby places anchored to this location"}
            aria-label="Find nearby places"
            className="w-7 h-7 flex items-center justify-center rounded text-faint hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); removePlacement(stop.placement.id); }}
            title="Remove from this day (keeps the place)"
            aria-label="Remove from day"
            className="w-7 h-7 flex items-center justify-center rounded text-faint hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </li>
    </>
  );
}
