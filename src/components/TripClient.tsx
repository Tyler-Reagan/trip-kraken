"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { TripWithDetails } from "@/types";
import OptimizeModal from "./OptimizeModal";
import LocationSidebar from "./LocationSidebar";
import ItineraryView from "./ItineraryView";
import AddLocationModal from "./AddLocationModal";

// deck.gl and maplibre-gl use browser-only APIs — never SSR
const MapView = dynamic(() => import("./MapView"), { ssr: false });

type ActiveView = "itinerary" | "map";

interface Props {
  trip: TripWithDetails;
}

export default function TripClient({ trip: initial }: Props) {
  const [trip, setTrip] = useState<TripWithDetails>(initial);
  const [showOptimize, setShowOptimize] = useState(!initial.numDays);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("itinerary");
  const [highlightedLocationId, setHighlightedLocationId] = useState<string | null>(null);
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);

  async function reload() {
    const res = await fetch(`/api/trips/${trip.id}`);
    if (res.ok) setTrip(await res.json());
  }

  async function toggleExcluded(locationId: string, excluded: boolean) {
    await fetch(`/api/trips/${trip.id}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excluded }),
    });
    await reload();
  }

  async function moveStop(
    stopId: string,
    targetDayId: string,
    targetOrder: number
  ) {
    await fetch(`/api/trips/${trip.id}/stops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stopId, targetDayId, targetOrder }),
    });
    await reload();
  }

  // Clicking a map pin highlights the stop in the itinerary and switches to it
  function handleMapLocationClick(locationId: string) {
    setHighlightedLocationId(locationId);
    setActiveView("itinerary");
  }

  const hasItinerary = trip.days.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{trip.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {trip.locations.length} locations
            {trip.numDays ? ` · ${trip.numDays} days` : ""}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowAddLocation(true)}
            className="btn-secondary text-sm"
          >
            + Add location
          </button>
          <button
            onClick={() => setShowOptimize(true)}
            className="btn-primary text-sm"
          >
            {hasItinerary ? "Re-optimize" : "Plan itinerary"}
          </button>
        </div>
      </div>

      {/* View tabs + day filter — only shown when itinerary exists */}
      {hasItinerary && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* View switcher */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
            {(["itinerary", "map"] as ActiveView[]).map((view) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors capitalize
                  ${activeView === view
                    ? "bg-brand-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
              >
                {view === "itinerary" ? "Itinerary" : "Map"}
              </button>
            ))}
          </div>

          {/* Day filter */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedDayNumber(null)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors
                ${selectedDayNumber === null
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
            >
              All days
            </button>
            {trip.days.map((day) => (
              <button
                key={day.id}
                onClick={() =>
                  setSelectedDayNumber(
                    selectedDayNumber === day.dayNumber ? null : day.dayNumber
                  )
                }
                className={`px-3 py-1 text-xs rounded-full border transition-colors
                  ${selectedDayNumber === day.dayNumber
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
              >
                Day {day.dayNumber}
                {day.label ? ` – ${day.label}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasItinerary && (
        <div className="card p-8 text-center text-gray-500 space-y-3">
          <p className="text-4xl">🗺️</p>
          <p className="font-medium">No itinerary yet</p>
          <p className="text-sm">
            Click <strong>Plan itinerary</strong> to cluster your locations into
            days.
          </p>
        </div>
      )}

      {hasItinerary && activeView === "itinerary" && (
        <div className="flex gap-6 items-start">
          {/* Location sidebar */}
          <aside className="hidden lg:block w-72 shrink-0">
            <LocationSidebar
              locations={trip.locations}
              onToggle={toggleExcluded}
            />
          </aside>

          {/* Itinerary */}
          <div className="flex-1 min-w-0">
            <ItineraryView
              trip={trip}
              onMoveStop={moveStop}
              onReload={reload}
              highlightedLocationId={highlightedLocationId}
              onHighlightClear={() => setHighlightedLocationId(null)}
            />
          </div>
        </div>
      )}

      {hasItinerary && activeView === "map" && (
        <MapView
          trip={trip}
          selectedDayNumber={selectedDayNumber}
          highlightedLocationId={highlightedLocationId}
          onLocationClick={handleMapLocationClick}
        />
      )}

      {showOptimize && (
        <OptimizeModal
          trip={trip}
          onClose={() => setShowOptimize(false)}
          onOptimized={(updated) => {
            setTrip(updated);
            setShowOptimize(false);
          }}
        />
      )}

      {showAddLocation && (
        <AddLocationModal
          tripId={trip.id}
          onClose={() => setShowAddLocation(false)}
          onAdded={() => {
            setShowAddLocation(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
