"use client";

import { useEffect, useRef } from "react";
import { numDaysOf, type TripWithDetails } from "@/types";
import { useTripStore } from "@/store/tripStore";
import OptimizeModal from "./OptimizeModal";
import LocationInspector from "./LocationInspector";
import AddLocationModal from "./AddLocationModal";
import Manifest from "./Manifest";

interface Props {
  trip: TripWithDetails;
}

const fmt = (d: string) =>
  new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function TripClient({ trip: initial }: Props) {
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    useTripStore.setState({
      trip: initial,
      tripId: initial.id,
      showOptimize: false,
      inspectedLocationId: null,
    });
  }

  const trip = useTripStore((s) => s.trip) ?? initial;
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const showOptimize = useTripStore((s) => s.showOptimize);
  const showAddLocation = useTripStore((s) => s.showAddLocation);

  const isEnriching = useTripStore((s) => s.isEnriching);
  const enrichProgress = useTripStore((s) => s.enrichProgress);
  const enrich = useTripStore((s) => s.enrich);
  const pollEnrichment = useTripStore((s) => s.pollEnrichment);

  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setShowAddLocation = useTripStore((s) => s.setShowAddLocation);

  const hasPlan = trip.placements.length > 0;
  const pendingCount = trip.locations.filter((l) => l.enrichmentStatus === "pending").length;
  const failedCount = trip.locations.filter((l) => l.enrichmentStatus === "failed").length;
  const numDays = numDaysOf(trip.startDate, trip.endDate);

  useEffect(() => {
    pollEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{trip.name}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {trip.locations.length} location{trip.locations.length !== 1 ? "s" : ""}
            {` · ${fmt(trip.startDate)} → ${fmt(trip.endDate)} · ${numDays} day${numDays !== 1 ? "s" : ""}`}
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
            {hasPlan ? "Re-optimize" : "Plan itinerary"}
          </button>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          <Manifest />
          {/* The day-by-day Timeline lands in D5; until then the plan is summarized. */}
          {hasPlan && (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Itinerary planned · {trip.placements.length} stop{trip.placements.length !== 1 ? "s" : ""} across the trip.
            </p>
          )}
        </div>

        {inspectedLocationId && <LocationInspector />}
      </div>

      {showOptimize && <OptimizeModal />}
      {showAddLocation && <AddLocationModal />}
    </div>
  );
}
