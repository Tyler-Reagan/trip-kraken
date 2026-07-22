"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { animated, to, useTransition, Globals } from "@react-spring/web";
import { deriveDays, isActivity, type DerivedDay, type NearbyPlace, type ScheduledStop, type Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { dayColorCss } from "@/lib/dayColors";
import DayCard from "./DayCard";
import UnassignedCard from "./UnassignedCard";
import DiscoveryTray from "./DiscoveryTray";

type DragItem =
  | { kind: "stop"; stop: ScheduledStop }
  | { kind: "location"; location: Location }
  | { kind: "place"; place: NearbyPlace };

/** Every draggable/droppable id is namespaced by kind so dnd-kit's flat id space (shared across
 *  placements, locations, and discovery results) can't collide, and `onDragEnd` can tell drop
 *  targets apart. */
const stopDragId = (placementId: string) => `stop:${placementId}`;
const locationDragId = (locationId: string) => `location:${locationId}`;
export const placeDragId = (placeId: string) => `place:${placeId}`;
export const dayDropId = (date: string) => `day:${date}`;
export const UNASSIGNED_DROP_ID = "unassigned";

// The focal-stack geometry (#134): the active day centered, exactly one neighbor peeking each
// side, nothing further mounted. Only transform/opacity are springed — never layout properties.
type StackRole = "prev" | "active" | "next";
const ROLE_TARGET: Record<StackRole, { x: number; y: number; scale: number; opacity: number }> = {
  prev: { x: -330, y: 16, scale: 0.82, opacity: 0.6 },
  active: { x: 0, y: 0, scale: 1, opacity: 1 },
  next: { x: 330, y: 16, scale: 0.82, opacity: 0.6 },
};

const EDGE_ZONE_PX = 70;
const DWELL_MS = 450;
const COOLDOWN_MS = 350;

/**
 * The itinerary's day-navigator shell (#134): a focal-stack carousel over the trip's days with a
 * per-day index strip, plus the unassigned pool and the discovery tray. Owns the itinerary's one
 * DndContext, so stops, unassigned locations, and discovery results all share a drag vocabulary —
 * including drag-to-edge dwell-paging, which lets any of them travel to a day that isn't mounted.
 */
export default function DayNavigator() {
  const trip = useTripStore((s) => s.trip);
  const activeDayNumber = useTripStore((s) => s.activeDayNumber);
  const setActiveDayNumber = useTripStore((s) => s.setActiveDayNumber);
  const movePlacement = useTripStore((s) => s.movePlacement);
  const removePlacement = useTripStore((s) => s.removePlacement);
  const addPlacement = useTripStore((s) => s.addPlacement);
  const addDiscoveredPlace = useTripStore((s) => s.addDiscoveredPlace);

  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dwellSide, setDwellSide] = useState<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<1 | -1>(1);
  const dwellTimerRef = useRef<{ side: "left" | "right"; id: ReturnType<typeof setTimeout> } | null>(null);
  const cooldownRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Respect reduced-motion: the dwell/cooldown logic still runs, paging just resolves instantly.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    Globals.assign({ skipAnimation: mq.matches });
  }, []);

  const days = trip ? deriveDays(trip) : [];
  const activeIdx = Math.max(0, Math.min(days.length - 1, days.findIndex((d) => d.dayNumber === activeDayNumber)));

  function go(nextIdx: number) {
    const clamped = Math.max(0, Math.min(days.length - 1, nextIdx));
    if (clamped === activeIdx) return;
    directionRef.current = clamped > activeIdx ? 1 : -1;
    setActiveDayNumber(days[clamped].dayNumber);
  }

  function clearDwell() {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current.id);
    dwellTimerRef.current = null;
    setDwellSide(null);
  }

  // Drag-to-edge dwell paging (#134): a passive observer of any live drag — it never competes
  // with dnd-kit's PointerSensor, it only watches the pointer while a drag is held and pages
  // when it dwells in an edge zone, so an item can cross several days without releasing.
  const isDragging = dragging !== null;
  useEffect(() => {
    if (!isDragging) { clearDwell(); return; }

    function armDwell(side: "left" | "right") {
      if (cooldownRef.current) return;
      if (dwellTimerRef.current?.side === side) return;
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current.id);
      setDwellSide(side);
      const id = setTimeout(() => {
        dwellTimerRef.current = null;
        setDwellSide(null);
        go(activeIdx + (side === "left" ? -1 : 1));
        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, COOLDOWN_MS);
      }, DWELL_MS);
      dwellTimerRef.current = { side, id };
    }

    function onMove(e: PointerEvent) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Only page while the pointer is vertically within the stack — dragging along the
      // discovery tray's own edge shouldn't flip days.
      if (e.clientY < rect.top || e.clientY > rect.bottom) { clearDwell(); return; }
      if (e.clientX < rect.left + EDGE_ZONE_PX && activeIdx > 0) armDwell("left");
      else if (e.clientX > rect.right - EDGE_ZONE_PX && activeIdx < days.length - 1) armDwell("right");
      else clearDwell();
    }

    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, activeIdx, days.length]);

  const visible = [activeIdx - 1, activeIdx, activeIdx + 1]
    .filter((i) => i >= 0 && i < days.length)
    .map((i) => days[i]);

  const roleOf = (day: DerivedDay) => {
    const d = days.indexOf(day) - activeIdx;
    return d === -1 ? "prev" : d === 0 ? "active" : "next";
  };

  const transitions = useTransition(visible, {
    keys: (d) => d.date,
    from: () => ({ x: directionRef.current * 660, y: 24, scale: 0.7, opacity: 0 }),
    enter: (d) => ROLE_TARGET[roleOf(d)],
    update: (d) => ROLE_TARGET[roleOf(d)],
    leave: () => ({ x: -directionRef.current * 660, y: 24, scale: 0.7, opacity: 0 }),
    config: { tension: 300, friction: 30 },
  });

  if (!trip) return null;

  const placedIds = new Set(trip.placements.map((p) => p.locationId));
  // Only activities are placed; lodging/transit are projected, never in the unscheduled pool.
  const unscheduledLocations = trip.locations.filter((l) => isActivity(l) && !placedIds.has(l.id));

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragItem | undefined;
    if (data) setDragging(data);
  }

  function handleDragEnd(event: DragEndEvent) {
    const active = dragging;
    setDragging(null);
    clearDwell();
    const overId = event.over?.id;
    if (!active || !overId) return;

    if (overId === UNASSIGNED_DROP_ID) {
      if (active.kind === "stop") removePlacement(active.stop.placement.id);
      // A discovery result dropped on the pool joins the trip unscheduled.
      else if (active.kind === "place") addDiscoveredPlace(active.place, null);
      return;
    }

    // Dropped on a day (empty space, or past the last stop) → append to the end. Dropped on
    // another stop → take that stop's slot, pushing it (and everything after) down.
    const overData = event.over?.data.current as { date: string; order: number } | undefined;
    if (!overData) return;

    if (active.kind === "stop") movePlacement(active.stop.placement.id, overData.date, overData.order);
    else if (active.kind === "location") addPlacement(active.location.id, overData.date, overData.order);
    else addDiscoveredPlace(active.place, overData.date, overData.order);
  }

  const dragLabel =
    dragging?.kind === "stop" ? dragging.stop.location.name
    : dragging?.kind === "location" ? dragging.location.name
    : dragging?.kind === "place" ? dragging.place.name
    : null;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {/* Index strip: jump straight to any day without paging through the ones between. */}
        <div className="flex gap-1.5 flex-wrap justify-center">
          {days.map((day, i) => {
            const isActive = i === activeIdx;
            const color = dayColorCss(day.dayNumber);
            return (
              <button
                key={day.date}
                onClick={() => go(i)}
                style={isActive ? { backgroundColor: `color-mix(in oklab, ${color} 25%, transparent)`, borderColor: color } : undefined}
                className={`w-8 h-8 rounded-full text-xs font-semibold border flex items-center justify-center transition-colors ${
                  isActive ? "text-ink" : "bg-surface-2 text-sub border-line-strong hover:bg-surface-3"
                }`}
                title={`Day ${day.dayNumber}${day.label ? " – " + day.label : ""} · ${day.stops.length} stop${day.stops.length !== 1 ? "s" : ""}`}
              >
                {day.dayNumber}
              </button>
            );
          })}
        </div>

        {/* Focal stack: only prev/active/next are ever mounted. */}
        <div ref={containerRef} className="relative flex items-start justify-center h-[520px]">
          {isDragging && (
            <>
              <div className={`absolute left-0 top-0 bottom-0 w-[70px] rounded-l-lg transition-colors pointer-events-none z-20 ${dwellSide === "left" ? "bg-brand-400/20" : ""}`} />
              <div className={`absolute right-0 top-0 bottom-0 w-[70px] rounded-r-lg transition-colors pointer-events-none z-20 ${dwellSide === "right" ? "bg-brand-400/20" : ""}`} />
            </>
          )}

          <button
            onClick={() => go(activeIdx - 1)}
            disabled={activeIdx === 0}
            aria-label="Previous day"
            className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center disabled:opacity-30 hover:bg-surface-3"
          >
            ←
          </button>

          {transitions((style, day) => {
            const role = roleOf(day);
            return (
              <animated.div
                key={day.date}
                className="absolute w-[480px] max-w-[85%] h-[500px] overflow-y-auto rounded-xl"
                style={{
                  zIndex: role === "active" ? 10 : 5,
                  opacity: style.opacity,
                  transform: to([style.x, style.y, style.scale], (x, y, scale) => `translate(${x}px, ${y}px) scale(${scale})`),
                }}
              >
                <DayCard day={day} draggingStop={dragging?.kind === "stop" ? dragging.stop : null} draggingLocation={dragging?.kind === "location" ? dragging.location : null} stopDragId={stopDragId} />
              </animated.div>
            );
          })}

          <button
            onClick={() => go(activeIdx + 1)}
            disabled={activeIdx === days.length - 1}
            aria-label="Next day"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-surface-2 border border-line-strong flex items-center justify-center disabled:opacity-30 hover:bg-surface-3"
          >
            →
          </button>
        </div>

        <UnassignedCard
          locations={unscheduledLocations}
          draggingStop={dragging?.kind === "stop" ? dragging.stop : null}
          dragId={locationDragId}
        />
      </div>

      <DiscoveryTray />

      <DragOverlay dropAnimation={null}>
        {dragLabel && (
          <div className="card px-3 py-2 shadow-lg text-sm font-medium text-ink rotate-1">{dragLabel}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
