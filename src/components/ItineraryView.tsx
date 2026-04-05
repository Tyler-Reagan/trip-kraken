"use client";

import { useState } from "react";
import type { ItineraryDay, ItineraryStop } from "@/types";
import { useTripStore } from "@/store/tripStore";
import DayCard from "./DayCard";

export default function ItineraryView() {
  const trip = useTripStore((s) => s.trip);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const [dragging, setDragging] = useState<ItineraryStop | null>(null);

  if (!trip) return null;

  function handleDragStart(stop: ItineraryStop) {
    setDragging(stop);
  }

  function handleDrop(targetDay: ItineraryDay, targetOrder: number) {
    if (!dragging) return;
    useTripStore.getState().moveStop(dragging.id, targetDay.id, targetOrder);
    setDragging(null);
  }

  const visibleDays = selectedDayNumber
    ? trip.days.filter((d) => d.dayNumber === selectedDayNumber)
    : trip.days;

  return (
    <div className="space-y-4">
      {visibleDays.map((day) => (
        <DayCard
          key={day.id}
          day={day}
          draggingStop={dragging}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}
