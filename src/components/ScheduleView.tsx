"use client";

import { useState } from "react";
import { deriveDays, isActivity, type DerivedDay, type ScheduledStop, type Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import DayCard from "./DayCard";
import UnassignedCard from "./UnassignedCard";

type DragItem =
  | { kind: "stop"; stop: ScheduledStop }
  | { kind: "location"; location: Location };

export default function ScheduleView() {
  const trip = useTripStore((s) => s.trip);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const movePlacement = useTripStore((s) => s.movePlacement);
  const removePlacement = useTripStore((s) => s.removePlacement);
  const addPlacement = useTripStore((s) => s.addPlacement);

  const [dragging, setDragging] = useState<DragItem | null>(null);

  if (!trip) return null;

  const days = deriveDays(trip);
  const placedIds = new Set(trip.placements.map((p) => p.locationId));
  // Only activities are placed; lodging/transit are projected, never in the unscheduled pool.
  const unscheduledLocations = trip.locations.filter((l) => isActivity(l) && !placedIds.has(l.id));

  function handleDrop(targetDay: DerivedDay, targetOrder: number) {
    if (!dragging) return;
    if (dragging.kind === "stop") movePlacement(dragging.stop.placement.id, targetDay.date, targetOrder);
    else addPlacement(dragging.location.id, targetDay.date, targetOrder);
    setDragging(null);
  }

  function handleDropUnassigned() {
    if (dragging?.kind === "stop") removePlacement(dragging.stop.placement.id);
    setDragging(null);
  }

  const filter = selectedDayNumber;
  const showUnassigned = filter === null || filter === "unassigned";
  const visibleDays =
    filter === null ? days : filter === "unassigned" ? [] : days.filter((d) => d.dayNumber === filter);

  const draggingStop = dragging?.kind === "stop" ? dragging.stop : null;
  const draggingLocation = dragging?.kind === "location" ? dragging.location : null;

  return (
    <div className="space-y-4">
      {showUnassigned && (
        <UnassignedCard
          locations={unscheduledLocations}
          draggingStop={draggingStop}
          onDragStartLocation={(location) => setDragging({ kind: "location", location })}
          onDropStop={handleDropUnassigned}
        />
      )}
      {visibleDays.map((day) => (
        <DayCard
          key={day.date}
          day={day}
          draggingStop={draggingStop}
          draggingLocation={draggingLocation}
          onDragStart={(stop) => setDragging({ kind: "stop", stop })}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}
