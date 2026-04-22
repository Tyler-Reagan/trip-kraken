"use client";

import { useState } from "react";
import type { ItineraryDay, ItineraryStop, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import DayCard from "./DayCard";
import UnassignedCard from "./UnassignedCard";

type DragItem =
  | { kind: "stop"; stop: ItineraryStop }
  | { kind: "location"; location: Location };

export default function ScheduleView() {
  const trip = useTripStore((s) => s.trip);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const moveStop = useTripStore((s) => s.moveStop);
  const removeStop = useTripStore((s) => s.removeStop);
  const addLocationToDay = useTripStore((s) => s.addLocationToDay);

  const [dragging, setDragging] = useState<DragItem | null>(null);

  if (!trip) return null;

  const scheduledLocationIds = new Set(
    trip.days.flatMap((d) => d.stops.map((s) => s.locationId))
  );
  const unscheduledLocations = trip.locations.filter(
    (l) => !scheduledLocationIds.has(l.id)
  );

  function handleDragStartStop(stop: ItineraryStop) {
    setDragging({ kind: "stop", stop });
  }

  function handleDragStartLocation(loc: Location) {
    setDragging({ kind: "location", location: loc });
  }

  function handleDrop(targetDay: ItineraryDay, targetOrder: number) {
    if (!dragging) return;
    if (dragging.kind === "stop") {
      moveStop(dragging.stop.id, targetDay.id, targetOrder);
    } else {
      addLocationToDay(dragging.location.id, targetDay.id);
    }
    setDragging(null);
  }

  function handleDropUnassigned() {
    if (!dragging || dragging.kind !== "stop") return;
    removeStop(dragging.stop.id);
    setDragging(null);
  }

  const filter = selectedDayNumber;
  const showUnassigned = filter === null || filter === "unassigned";
  const visibleDays: ItineraryDay[] =
    filter === null
      ? trip.days
      : filter === "unassigned"
        ? []
        : trip.days.filter((d) => d.dayNumber === filter);

  const draggingStop = dragging?.kind === "stop" ? dragging.stop : null;
  const draggingLocation = dragging?.kind === "location" ? dragging.location : null;

  return (
    <div className="space-y-4">
      {showUnassigned && (
        <UnassignedCard
          locations={unscheduledLocations}
          draggingStop={draggingStop}
          onDragStartLocation={handleDragStartLocation}
          onDropStop={handleDropUnassigned}
        />
      )}
      {visibleDays.map((day) => (
        <DayCard
          key={day.id}
          day={day}
          draggingStop={draggingStop}
          draggingLocation={draggingLocation}
          onDragStart={handleDragStartStop}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}
