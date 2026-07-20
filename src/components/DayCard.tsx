"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DerivedDay, ScheduledStop, Lodging, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { dayColorCss, dayTextColor } from "@/lib/dayColors";
import { GripVertical, Route, Search, Trash2 } from "lucide-react";
import { dayDropId } from "./DayNavigator";

interface Props {
  day: DerivedDay;
  draggingStop: ScheduledStop | null;
  draggingLocation: Location | null;
  stopDragId: (placementId: string) => string;
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

export default function DayCard({ day, draggingStop, draggingLocation, stopDragId }: Props) {
  const setDayLabel = useTripStore((s) => s.setDayLabel);
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);
  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(day.label ?? "");

  // The day itself is a drop target for "append to the end" (or an empty day) — sized to fill
  // whatever space isn't already claimed by a specific stop, so it never competes with them for
  // the pointer, and always has a real (non-sliver) hit area regardless of how full the day is.
  const { setNodeRef: setEndDropRef, isOver: isOverEnd } = useDroppable({
    id: dayDropId(day.date),
    data: { date: day.date, order: day.stops.length },
  });

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

  const isDragTarget = (draggingStop !== null || draggingLocation !== null) && isOverEnd;

  return (
    <div className={`card p-4 space-y-3 transition-all ${isDragTarget ? "ring-2 ring-brand-400 bg-brand-50 dark:bg-brand-950/20" : ""}`}>
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
      <ol className="space-y-1">
        {day.startAnchor && <AnchorRow loc={day.startAnchor} role="start" date={day.date} />}
        {/* Lodging anchors are valid "along the way" edge endpoints too (#129) — only skip the
            connector when there's no non-lodging stop on the other side to search a corridor to. */}
        {day.startAnchor && !day.checkInWaypoint && day.stops.length > 0 && (
          <RouteConnector from={day.startAnchor} to={day.stops[0].location} date={day.date} />
        )}
        {day.checkInWaypoint && <AnchorRow loc={day.checkInWaypoint} role="checkin" date={day.date} />}
        {day.checkInWaypoint && day.stops.length > 0 && (
          <RouteConnector from={day.checkInWaypoint} to={day.stops[0].location} date={day.date} />
        )}
        <SortableContext items={day.stops.map((s) => stopDragId(s.placement.id))} strategy={verticalListSortingStrategy}>
          {day.stops.map((stop, idx) => (
            <Fragment key={stop.placement.id}>
              <StopRow
                id={stopDragId(stop.placement.id)}
                stop={stop}
                index={idx}
                dayNumber={day.dayNumber}
                date={day.date}
                dayOfWeek={dayOfWeek}
              />
              {/* Between two consecutive stops: search the corridor between them (#102, chunk 4). */}
              {idx < day.stops.length - 1 && (
                <RouteConnector from={stop.location} to={day.stops[idx + 1].location} date={day.date} />
              )}
            </Fragment>
          ))}
        </SortableContext>
        {day.endAnchor && day.stops.length > 0 && (
          <RouteConnector from={day.stops[day.stops.length - 1].location} to={day.endAnchor} date={day.date} />
        )}
        {day.endAnchor && <AnchorRow loc={day.endAnchor} role="end" date={day.date} />}
      </ol>
      <div
        ref={setEndDropRef}
        className={`rounded-lg transition-all ${
          day.stops.length === 0
            ? "min-h-12 flex items-center justify-center"
            : `min-h-6 ${isOverEnd ? "min-h-10" : ""}`
        } ${isOverEnd ? "bg-brand-50 dark:bg-brand-950/30 ring-1 ring-brand-300 dark:ring-brand-700" : ""}`}
      >
        {day.stops.length === 0 && <p className="text-sm text-faint italic text-center">Drag stops here or re-optimize</p>}
      </div>
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
      data-inspect-anchor={loc.id}
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

/** The hover-revealed affordance between two consecutive stops: opens along-route discovery for the
 *  corridor between them (#102). Rendered only when both ends have coordinates — a corridor can't be
 *  computed otherwise (the route endpoint would reject it), so there's nothing to offer. */
function RouteConnector({ from, to, date }: { from: Location; to: Location; date: string }) {
  const setRouteSearch = useTripStore((s) => s.setRouteSearch);
  if (from.lat === null || to.lat === null) return null;
  return (
    <li className="group flex justify-center py-0.5 select-none">
      <button
        onClick={() => setRouteSearch({ from, to, date })}
        title="Find places along the way between these two stops"
        aria-label={`Find places along the way from ${from.name} to ${to.name}`}
        className="hover-reveal flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full text-brand-600 dark:text-brand-400 hover:bg-surface-2 transition-colors"
      >
        <Route className="w-3 h-3" />
        Along the way
      </button>
    </li>
  );
}

interface StopRowProps {
  id: string;
  stop: ScheduledStop;
  index: number;
  dayNumber: number;
  dayOfWeek: number;
  date: string;
}

function StopRow({ id, stop, index, dayNumber, dayOfWeek, date }: StopRowProps) {
  const removePlacement = useTripStore((s) => s.removePlacement);
  const highlightedLocationId = useTripStore((s) => s.highlightedLocationId);
  const setHighlightedLocationId = useTripStore((s) => s.setHighlightedLocationId);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);

  const loc = stop.location;
  const isHighlighted = highlightedLocationId === loc.id;
  const isInspected = inspectedLocationId === loc.id;
  const highlightRef = useRef<HTMLLIElement | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { kind: "stop", stop, date, order: index },
  });

  const hoursText = formatHoursSubtext(loc, dayOfWeek);
  const durText = loc.visitDuration !== null ? formatDuration(loc.visitDuration) : "—";

  useEffect(() => {
    if (isHighlighted && highlightRef.current) highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isHighlighted]);

  return (
    <li
      ref={(el) => { setNodeRef(el); highlightRef.current = el; }}
      data-inspect-anchor={loc.id}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      {...attributes}
      {...listeners}
      className={`group flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all select-none touch-none
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
  );
}
