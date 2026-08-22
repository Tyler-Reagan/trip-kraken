"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DerivedDay, ScheduledStop, Lodging, Transit, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { dayColorCss, dayTextColor } from "@/lib/dayColors";
import { metrosOf } from "@/lib/tripMetros";
import { formatDuration, resolveVisitDuration } from "@/lib/visitDuration";
import { Crosshair, GripVertical, MapPin, Route, Search, Trash2, TrainFront } from "lucide-react";
import { dayDropId } from "./DayNavigator";
import { usePathGeometryContext } from "@/lib/usePathGeometry";
import { pairKey } from "@/lib/pathPairs";
import { PathShiftRows } from "./PathShiftRows.prototype";
import { useShiftVariant } from "./PrototypeSwitcher.prototype";

interface Props {
  day: DerivedDay;
  draggingStop: ScheduledStop | null;
  draggingLocation: Location | null;
  stopDragId: (placementId: string) => string;
}

const LIGHT_DAY_THRESHOLD = 240;

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
  const trip = useTripStore((s) => s.trip);
  const setDayLabel = useTripStore((s) => s.setDayLabel);
  const focusMap = useTripStore((s) => s.focusMap);
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
  // Reflects what the Plan was actually built on (ADR-0023 §9, amended 2026-08-18): an unset
  // Activity still costs DEFAULT_VISIT_MINUTES in the solver, so the total must count it too, or
  // this figure would read lower than the Day the optimizer actually produced.
  const totalMinutes = day.stops.reduce((sum, s) => sum + resolveVisitDuration(s.location.visitDuration), 0);
  // Unlike the total above, this stays a raw check on purpose — "Light day" is a signal about
  // durations someone actually chose, and a Day made entirely of invented defaults isn't evidence
  // of anything.
  const anyHasDuration = day.stops.some((s) => s.location.visitDuration !== null);
  const isLightDay = anyHasDuration && totalMinutes < LIGHT_DAY_THRESHOLD && day.stops.length > 0;
  const nearbyAnchorLoc: Location | null = day.startAnchor ?? day.stops[0]?.location ?? null;
  // The metros this day touches, ordered by first appearance in the day's stops and uncapped
  // (#128 decision 6), read off the one shared cluster source — a badge click fits the metro
  // across the *whole* trip, not just this day's share of it (decision 2).
  const metros = (trip ? metrosOf(trip) : [])
    .map((m) => ({ metro: m, at: day.stops.findIndex((s) => m.locationIds.has(s.location.id)) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.metro);

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
          {metros.map((metro) => (
            <button
              key={metro.id}
              onClick={() => focusMap({ tier: "metro", metroId: metro.id })}
              title={`Show ${metro.label} on the map — all ${metro.stopCount} stop${metro.stopCount !== 1 ? "s" : ""} across the trip`}
              className="shrink-0 flex items-center gap-1 rounded-full border border-line-strong px-1.5 py-0.5 text-[11px] text-sub hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <MapPin className="w-3 h-3 text-faint" />
              {metro.label}
            </button>
          ))}
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
            connector when there's no non-lodging stop on the other side to search a corridor to.
            #139 PROTOTYPE fix: this used to be gated on `stops.length > 0` for every anchor-adjacent
            gap, so a day with only anchors (e.g. arrival + check-in, nothing scheduled yet) never
            got a connector at all even though a real Path exists between them — the bug the user
            caught on Day 1 of a real trip (Narita → hotel). Anchor-to-anchor is exactly as valid a
            gap as anchor-to-stop; it was just never given one. */}
        {day.startAnchor && day.checkInWaypoint && (
          <RouteConnector from={day.startAnchor} to={day.checkInWaypoint} date={day.date} />
        )}
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
        {/* #139 PROTOTYPE fix: the no-stops counterpart to the two blocks above — whichever anchor
            immediately precedes where stops would go (check-in if it exists, else start) still
            needs a connector to the end anchor when there are no stops to carry it there instead. */}
        {(day.checkInWaypoint ?? day.startAnchor) && day.stops.length === 0 && day.endAnchor && (
          <RouteConnector from={(day.checkInWaypoint ?? day.startAnchor)!} to={day.endAnchor} date={day.date} />
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

/** A day's projected bookend (ADR-0015, widened by ADR-0028): where you woke / sleep / dropped
 *  bags at a Lodging, or the trip's arrival/departure Transit Location. Both are derived from
 *  constraint fields, never a stored stop, so these rows are read-only anchors. */
function AnchorRow({ loc, role, date }: { loc: Lodging | Transit; role: "start" | "end" | "checkin"; date: string }) {
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const isEdge = loc.kind === "transit";
  const subtext = isEdge
    ? role === "start" ? "Arrive" : "Depart"
    : role === "checkin" ? "Check-in · drop bags" : role === "start" ? "Start of day" : "Overnight";
  const badge = isEdge ? (role === "start" ? "Arrival" : "Departure") : role === "checkin" ? "Check-in" : "Stay";

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
        {badge}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-body truncate text-ink flex items-center gap-1.5">
          {isEdge && <TrainFront className="w-3.5 h-3.5 shrink-0" />}
          {loc.name}
        </p>
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
 *  computed otherwise (the route endpoint would reject it), so there's nothing to offer.
 *
 *  Also where ADR-0026's self-heal (#171) surfaces: the one connector whose two ends match the
 *  last removal's healed pair shows what it costs to travel between them — the read-side half of
 *  "the gap closes" made visible, not just true underneath. */
function RouteConnector({ from, to, date }: { from: Location; to: Location; date: string }) {
  const setRouteSearch = useTripStore((s) => s.setRouteSearch);
  const healedPair = useTripStore((s) => s.healedPair);
  const trip = useTripStore((s) => s.trip);
  const setInspectedSurfacedTransit = useTripStore((s) => s.setInspectedSurfacedTransit);
  const { pathGeometry, roadProfile } = usePathGeometryContext();
  const variant = useShiftVariant();
  if (from.lat === null || to.lat === null) return null;

  const healed = healedPair && healedPair.fromLocationId === from.id && healedPair.toLocationId === to.id ? healedPair : null;

  // #139 PROTOTYPE: the row-per-Path shift sequence for this gap, read from the hoisted cache.
  const key = pairKey(roadProfile, {
    from: { lat: from.lat, lng: from.lng!, locationId: from.id },
    to: { lat: to.lat, lng: to.lng!, locationId: to.id },
  });
  const chain = pathGeometry.get(key);

  // #139 PROTOTYPE: always visible now, not hover-revealed — it anchors to the gap's one header
  // row (via `trailing`) instead of a separate row below, so hiding it never leaves a gap.
  const alongTheWay = (
    <span className="flex items-center gap-1.5 shrink-0">
      {healed && (
        <span
          title={
            healed.travelCost.basisOfCost === "straightLine"
              ? "Estimated as a straight line — no real route found for this pair"
              : `${Math.round(healed.travelCost.distanceMeters)}m, answered by ${healed.travelCost.answeredBy}`
          }
          className="flex items-center gap-1 px-2 py-0.5 text-meta rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800"
        >
          <Route className="w-3.5 h-3.5" />
          {formatDuration(Math.round(healed.travelCost.costAsMinutes))}
          {healed.travelCost.basisOfCost === "straightLine" && " (straight-line)"}
        </span>
      )}
      <button
        onClick={() => setRouteSearch({ from, to, date })}
        title="Find places along the way between these two stops"
        aria-label={`Find places along the way from ${from.name} to ${to.name}`}
        className="flex items-center gap-1 px-2 py-0.5 text-meta text-brand-600 dark:text-brand-400 rounded-full hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Route className="w-3.5 h-3.5" />
        Along the way
      </button>
    </span>
  );

  if (!trip) return null;
  return (
    <PathShiftRows
      chain={chain}
      tripId={trip.id}
      variant={variant}
      trailing={alongTheWay}
      onStationClick={setInspectedSurfacedTransit}
    />
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
  const focusMap = useTripStore((s) => s.focusMap);

  const loc = stop.location;
  const isHighlighted = highlightedLocationId === loc.id;
  const isInspected = inspectedLocationId === loc.id;
  const highlightRef = useRef<HTMLLIElement | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { kind: "stop", stop, date, order: index },
  });

  const hoursText = formatHoursSubtext(loc, dayOfWeek);
  // Resolved, not raw-or-dash: the total above already counts an unset duration as
  // DEFAULT_VISIT_MINUTES, so a per-stop "—" here would read as "not counted" when it is.
  const durText = formatDuration(resolveVisitDuration(loc.visitDuration));

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
        {/* Map link (#128 decision 7): flyTo this stop, opening the map if it's closed. Disabled
            without coordinates, same convention as Search beside it. */}
        <button
          onClick={(e) => { e.stopPropagation(); focusMap({ tier: "stop", locationId: loc.id }); }}
          disabled={loc.lat === null}
          title={loc.lat === null ? "No coordinates — run Enrich first" : "Show this stop on the map"}
          aria-label="Show on map"
          className="w-7 h-7 flex items-center justify-center rounded text-faint hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Crosshair className="w-4 h-4" />
        </button>
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
