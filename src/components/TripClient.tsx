"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import type { TripWithDetails } from "@/types";
import { useTripStore } from "@/store/tripStore";
import OptimizeModal from "./OptimizeModal";
import LocationSidebar from "./LocationSidebar";
import ItineraryView from "./ItineraryView";
import AddLocationModal from "./AddLocationModal";
import NearbyDrawer from "./NearbyDrawer";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type ActiveView = "itinerary" | "map";

interface Props {
  trip: TripWithDetails;
}

export default function TripClient({ trip: initial }: Props) {
  // Initialise the store synchronously on first render so children see
  // the correct trip data without waiting for a useEffect.
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    useTripStore.setState({
      trip: initial,
      tripId: initial.id,
      showOptimize: !initial.numDays,
      activeView: "itinerary",
      selectedDayNumber: null,
      nearbyAnchor: null,
      highlightedLocationId: null,
      showLocationDrawer: false,
    });
  }

  // Use initial as fallback — store is set synchronously above but guard for SSR edge cases
  const trip = useTripStore((s) => s.trip) ?? initial;
  const activeView = useTripStore((s) => s.activeView);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const nearbyAnchor = useTripStore((s) => s.nearbyAnchor);
  const showOptimize = useTripStore((s) => s.showOptimize);
  const showAddLocation = useTripStore((s) => s.showAddLocation);
  const showLocationDrawer = useTripStore((s) => s.showLocationDrawer);

  const isEnriching = useTripStore((s) => s.isEnriching);
  const enrichProgress = useTripStore((s) => s.enrichProgress);
  const enrich = useTripStore((s) => s.enrich);

  const setActiveView = useTripStore((s) => s.setActiveView);
  const setSelectedDayNumber = useTripStore((s) => s.setSelectedDayNumber);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setShowAddLocation = useTripStore((s) => s.setShowAddLocation);
  const setShowLocationDrawer = useTripStore((s) => s.setShowLocationDrawer);

  const hasItinerary = trip?.days.length > 0;
  const enrichableCount = trip?.locations.filter(
    (l) => l.lat !== null && l.lng !== null && (l.openTime === null || l.placeId === null)
  ).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{trip?.name}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {trip?.locations.length} locations
            {trip?.numDays ? ` · ${trip?.numDays} days` : ""}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowAddLocation(true)} className="btn-secondary text-sm">
            + Add location
          </button>
          <button
            onClick={enrich}
            disabled={isEnriching || enrichableCount === 0}
            className="btn-secondary text-sm disabled:opacity-40"
            title="Fetch opening hours, phone, and ratings from Google Places"
          >
            {isEnriching
              ? "Enriching…"
              : enrichProgress
                ? `${enrichProgress.enriched}/${enrichProgress.total} enriched`
                : `Enrich (${enrichableCount})`}
          </button>
          <button onClick={() => setShowOptimize(true)} className="btn-primary text-sm">
            {hasItinerary ? "Re-optimize" : "Plan itinerary"}
          </button>
        </div>
      </div>

      {/* View tabs + day filter */}
      {hasItinerary && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
            {(["itinerary", "map"] as ActiveView[]).map((view) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors capitalize
                  ${activeView === view
                    ? "bg-brand-600 dark:bg-brand-500 text-white"
                    : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
              >
                {view === "itinerary" ? "Itinerary" : "Map"}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedDayNumber(null)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors
                ${selectedDayNumber === null
                  ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
            >
              All days
            </button>
            {trip?.days.map((day) => (
              <button
                key={day.id}
                onClick={() =>
                  setSelectedDayNumber(selectedDayNumber === day.dayNumber ? null : day.dayNumber)
                }
                className={`px-3 py-1 text-xs rounded-full border transition-colors
                  ${selectedDayNumber === day.dayNumber
                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                    : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
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
        <div className="card p-8 text-center text-gray-500 dark:text-gray-400 space-y-3">
          <p className="text-4xl">🗺️</p>
          <p className="font-medium">No itinerary yet</p>
          <p className="text-sm">
            Click <strong className="text-gray-700 dark:text-gray-200">Plan itinerary</strong> to
            cluster your locations into days.
          </p>
        </div>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          {hasItinerary && activeView === "itinerary" && (
            <div className="flex gap-6 items-start">
              {/* Desktop sidebar */}
              <aside className="hidden lg:block w-72 shrink-0">
                <LocationSidebar />
              </aside>

              <div className="flex-1 min-w-0 space-y-4">
                <ItineraryView />

                {/* Mobile: open location drawer */}
                <button
                  onClick={() => setShowLocationDrawer(true)}
                  className="lg:hidden w-full btn-secondary text-sm"
                >
                  View locations
                </button>
              </div>
            </div>
          )}

          {hasItinerary && activeView === "map" && <MapView />}
        </div>

        {/* Nearby drawer — inline side panel */}
        {nearbyAnchor && <NearbyDrawer />}
      </div>

      {/* Mobile location drawer */}
      {showLocationDrawer && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setShowLocationDrawer(false)}
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-black/50" />
        </div>
      )}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 lg:hidden transition-transform duration-300
          ${showLocationDrawer ? "translate-y-0" : "translate-y-full"}`}
      >
        <LocationSidebar isDrawer onCloseDrawer={() => setShowLocationDrawer(false)} />
      </div>

      {showOptimize && <OptimizeModal />}
      {showAddLocation && <AddLocationModal />}
    </div>
  );
}
