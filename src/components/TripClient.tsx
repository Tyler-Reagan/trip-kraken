"use client";

import { useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { TripWithDetails } from "@/types";
import { useTripStore } from "@/store/tripStore";
import OptimizeModal from "./OptimizeModal";
import ScheduleView from "./ScheduleView";
import LocationInspector from "./LocationInspector";
import AddLocationModal from "./AddLocationModal";
import NearbyDrawer from "./NearbyDrawer";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type ActiveView = "itinerary" | "map";

interface Props {
  trip: TripWithDetails;
}

export default function TripClient({ trip: initial }: Props) {
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
      inspectedLocationId: null,
    });
  }

  const trip = useTripStore((s) => s.trip) ?? initial;
  const activeView = useTripStore((s) => s.activeView);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const nearbyAnchor = useTripStore((s) => s.nearbyAnchor);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const showOptimize = useTripStore((s) => s.showOptimize);
  const showAddLocation = useTripStore((s) => s.showAddLocation);

  const isEnriching = useTripStore((s) => s.isEnriching);
  const enrichProgress = useTripStore((s) => s.enrichProgress);
  const enrich = useTripStore((s) => s.enrich);
  const pollEnrichment = useTripStore((s) => s.pollEnrichment);

  const setActiveView = useTripStore((s) => s.setActiveView);
  const setSelectedDayNumber = useTripStore((s) => s.setSelectedDayNumber);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setShowAddLocation = useTripStore((s) => s.setShowAddLocation);

  const hasItinerary = trip?.days.length > 0;
  const pendingCount = trip?.locations.filter((l) => l.enrichmentStatus === "pending").length ?? 0;
  const failedCount = trip?.locations.filter((l) => l.enrichmentStatus === "failed").length ?? 0;

  const unscheduledCount = hasItinerary
    ? (() => {
        const scheduled = new Set(trip.days.flatMap((d) => d.stops.map((s) => s.locationId)));
        return trip.locations.filter((l) => !scheduled.has(l.id)).length;
      })()
    : 0;

  useEffect(() => {
    pollEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {pendingCount > 0 && (
            <span className="text-sm text-gray-400 dark:text-gray-500 animate-pulse self-center">
              Enriching {pendingCount}…
            </span>
          )}
          {failedCount > 0 && (
            <button
              onClick={enrich}
              disabled={isEnriching}
              className="btn-secondary text-sm disabled:opacity-40"
              title="Retry fetching details for locations where enrichment failed"
            >
              {isEnriching
                ? enrichProgress
                  ? `${enrichProgress.enriched}/${enrichProgress.total} retried`
                  : "Retrying…"
                : `Retry (${failedCount})`}
            </button>
          )}
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
            {/* Unassigned filter */}
            <button
              onClick={() => setSelectedDayNumber(selectedDayNumber === "unassigned" ? null : "unassigned")}
              className={`px-3 py-1 text-xs rounded-full border transition-colors
                ${selectedDayNumber === "unassigned"
                  ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
            >
              Unassigned{unscheduledCount > 0 ? ` ●${unscheduledCount}` : ""}
            </button>

            {/* All filter */}
            <button
              onClick={() => setSelectedDayNumber(null)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors
                ${selectedDayNumber === null
                  ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
            >
              All
            </button>

            {/* Per-day filters */}
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
                {day.stops.length > 0 ? ` ●${day.stops.length}` : ""}
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
          {hasItinerary && activeView === "itinerary" && <ScheduleView />}
          {hasItinerary && activeView === "map" && <MapView />}
        </div>

        {/* Right panels — both mount independently; Inspector shifts inward when Nearby opens */}
        {inspectedLocationId && <LocationInspector />}
        {nearbyAnchor && <NearbyDrawer />}
      </div>

      {showOptimize && <OptimizeModal />}
      {showAddLocation && <AddLocationModal />}
    </div>
  );
}
