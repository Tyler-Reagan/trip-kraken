"use client";

import { DndContext, DragOverlay, KeyboardSensor, pointerWithin, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useState } from "react";
import { deriveDays, isActivity, type ScheduledStop, type Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import DayCard from "./DayCard";
import UnassignedCard from "./UnassignedCard";

type DragItem =
  | { kind: "stop"; stop: ScheduledStop }
  | { kind: "location"; location: Location };

/** Every draggable/droppable id is namespaced by kind so dnd-kit's flat id space (shared across
 *  placements and locations) can't collide, and `onDragEnd` can tell drop targets apart. */
const stopDragId = (placementId: string) => `stop:${placementId}`;
const locationDragId = (locationId: string) => `location:${locationId}`;
export const dayDropId = (date: string) => `day:${date}`;
export const UNASSIGNED_DROP_ID = "unassigned";

export default function ScheduleView() {
  const trip = useTripStore((s) => s.trip);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const movePlacement = useTripStore((s) => s.movePlacement);
  const removePlacement = useTripStore((s) => s.removePlacement);
  const addPlacement = useTripStore((s) => s.addPlacement);

  const [dragging, setDragging] = useState<DragItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!trip) return null;

  const days = deriveDays(trip);
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
    const overId = event.over?.id;
    if (!active || !overId) return;

    if (overId === UNASSIGNED_DROP_ID) {
      if (active.kind === "stop") removePlacement(active.stop.placement.id);
      return;
    }

    // Dropped on a day (empty space, or past the last stop) → append to the end. Dropped on
    // another stop → take that stop's slot, pushing it (and everything after) down.
    const overData = event.over?.data.current as { date: string; order: number } | undefined;
    if (!overData) return;

    if (active.kind === "stop") movePlacement(active.stop.placement.id, overData.date, overData.order);
    else addPlacement(active.location.id, overData.date, overData.order);
  }

  const filter = selectedDayNumber;
  const showUnassigned = filter === null || filter === "unassigned";
  const visibleDays =
    filter === null ? days : filter === "unassigned" ? [] : days.filter((d) => d.dayNumber === filter);

  const draggingStop = dragging?.kind === "stop" ? dragging.stop : null;
  const draggingLocation = dragging?.kind === "location" ? dragging.location : null;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {showUnassigned && (
          <UnassignedCard
            locations={unscheduledLocations}
            draggingStop={draggingStop}
            dragId={locationDragId}
          />
        )}
        {visibleDays.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            draggingStop={draggingStop}
            draggingLocation={draggingLocation}
            stopDragId={stopDragId}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingStop && (
          <div className="card px-3 py-2 shadow-lg text-sm font-medium text-ink rotate-1">
            {draggingStop.location.name}
          </div>
        )}
        {draggingLocation && (
          <div className="card px-3 py-2 shadow-lg text-sm font-medium text-ink rotate-1">
            {draggingLocation.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
