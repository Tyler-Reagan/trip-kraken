"use client";

import { useState } from "react";
import type { TripWithDetails, ItineraryDay, ItineraryStop } from "@/types";
import DayCard from "./DayCard";

interface Props {
  trip: TripWithDetails;
  onMoveStop: (stopId: string, targetDayId: string, targetOrder: number) => void;
  onReload: () => void;
  highlightedLocationId?: string | null;
  onHighlightClear?: () => void;
}

export default function ItineraryView({
  trip,
  onMoveStop,
  onReload,
  highlightedLocationId,
  onHighlightClear,
}: Props) {
  const [dragging, setDragging] = useState<ItineraryStop | null>(null);

  function handleDragStart(stop: ItineraryStop) {
    setDragging(stop);
  }

  function handleDrop(targetDay: ItineraryDay, targetOrder: number) {
    if (!dragging) return;
    onMoveStop(dragging.id, targetDay.id, targetOrder);
    setDragging(null);
  }

  return (
    <div className="space-y-4">
      {trip.days.map((day) => (
        <DayCard
          key={day.id}
          day={day}
          trip={trip}
          draggingStop={dragging}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          onReload={onReload}
          highlightedLocationId={highlightedLocationId}
          onHighlightClear={onHighlightClear}
        />
      ))}
    </div>
  );
}
