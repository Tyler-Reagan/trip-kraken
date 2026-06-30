"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { deriveDays, numDaysOf, type TripWithDetails } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { dayColorCss } from "@/lib/dayColors";
import OptimizeModal from "./OptimizeModal";
import LocationInspector from "./LocationInspector";
import AddLocationModal from "./AddLocationModal";
import NearbyDrawer from "./NearbyDrawer";
import Manifest from "./Manifest";
import ScheduleView from "./ScheduleView";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type ActiveSurface = "itinerary" | "places";

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
      // Itinerary is the first-class surface — land there once a plan exists, otherwise
      // start in Places (the staging step that produces the plan).
      activeSurface: initial.placements.length > 0 ? "itinerary" : "places",
      mapShown: true,
      mapExpanded: false,
      selectedDayNumber: null,
      nearbySearchLocation: null,
      highlightedLocationId: null,
      inspectedLocationId: null,
    });
  }

  const trip = useTripStore((s) => s.trip) ?? initial;
  const activeSurface = useTripStore((s) => s.activeSurface);
  const selectedDayNumber = useTripStore((s) => s.selectedDayNumber);
  const nearbySearchLocation = useTripStore((s) => s.nearbySearchLocation);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const mapShown = useTripStore((s) => s.mapShown);
  const mapExpanded = useTripStore((s) => s.mapExpanded);
  const showOptimize = useTripStore((s) => s.showOptimize);
  const showAddLocation = useTripStore((s) => s.showAddLocation);

  const isEnriching = useTripStore((s) => s.isEnriching);
  const enrichProgress = useTripStore((s) => s.enrichProgress);
  const enrich = useTripStore((s) => s.enrich);
  const pollEnrichment = useTripStore((s) => s.pollEnrichment);

  const setActiveSurface = useTripStore((s) => s.setActiveSurface);
  const setSelectedDayNumber = useTripStore((s) => s.setSelectedDayNumber);
  const setMapShown = useTripStore((s) => s.setMapShown);
  const setMapExpanded = useTripStore((s) => s.setMapExpanded);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setShowAddLocation = useTripStore((s) => s.setShowAddLocation);

  const days = deriveDays(trip);
  const hasPlan = trip.placements.length > 0;
  const pendingCount = trip.locations.filter((l) => l.enrichmentStatus === "pending").length;
  const failedCount = trip.locations.filter((l) => l.enrichmentStatus === "failed").length;
  const numDays = numDaysOf(trip.startDate, trip.endDate);
  const unscheduledCount = trip.locations.filter((l) => l.kind === "activity" && !l.excluded).length -
    new Set(trip.placements.map((p) => p.locationId)).size;

  useEffect(() => {
    pollEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The companion region beside the itinerary shows one thing at a time, by priority:
  // an active Nearby search, else an inspected location, else the map at rest. A panel
  // takes precedence over the map and forces the region open even when the map is hidden.
  const companion: "nearby" | "inspector" | "map" | null =
    nearbySearchLocation ? "nearby"
    : inspectedLocationId ? "inspector"
    : mapShown ? "map"
    : null;
  // Full-bleed only applies to the resting map, never over a panel.
  const expanded = mapExpanded && companion === "map";

  const surfaces: { id: ActiveSurface; label: string }[] = [
    { id: "itinerary", label: "Itinerary" },
    { id: "places", label: "Places" },
  ];

  const dayChip = "inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors";
  const dayChipIdle =
    "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800";
  const metaActive =
    "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100";

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

      {/* Surface switch · day filter (itinerary) · map controls (itinerary) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
          {surfaces.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSurface(s.id)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors
                ${activeSurface === s.id
                  ? "bg-brand-600 dark:bg-brand-500 text-white"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {activeSurface === "itinerary" && hasPlan && (
          <>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setSelectedDayNumber(selectedDayNumber === "unassigned" ? null : "unassigned")}
                className={`${dayChip} ${selectedDayNumber === "unassigned" ? metaActive : dayChipIdle}`}
              >
                Unassigned{unscheduledCount > 0 ? ` · ${unscheduledCount}` : ""}
              </button>
              <button
                onClick={() => setSelectedDayNumber(null)}
                className={`${dayChip} ${selectedDayNumber === null ? metaActive : dayChipIdle}`}
              >
                All
              </button>
              {days.map((day) => {
                const active = selectedDayNumber === day.dayNumber;
                const color = dayColorCss(day.dayNumber);
                return (
                  <button
                    key={day.date}
                    onClick={() => setSelectedDayNumber(active ? null : day.dayNumber)}
                    style={active ? { backgroundColor: `color-mix(in oklab, ${color} 20%, transparent)`, borderColor: color } : undefined}
                    className={`${dayChip} ${active ? "text-gray-900 dark:text-gray-100 font-medium" : dayChipIdle}`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
                    Day {day.dayNumber}
                    {day.stops.length > 0 ? ` · ${day.stops.length}` : ""}
                    {day.label ? ` – ${day.label}` : ""}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-1 sm:ml-auto shrink-0">
              <button onClick={() => setMapShown(!mapShown)} className="btn-ghost">
                {mapShown ? "Hide map" : "Show map"}
              </button>
              {companion === "map" && (
                <button onClick={() => setMapExpanded(!mapExpanded)} className="btn-ghost">
                  {expanded ? "Collapse" : "Expand"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Body */}
      {activeSurface === "places" ? (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0">
            <Manifest />
          </div>
          {inspectedLocationId && (
            <div className="w-full lg:w-[360px] shrink-0 lg:sticky lg:top-6 self-start">
              <LocationInspector />
            </div>
          )}
        </div>
      ) : !hasPlan ? (
        <NoPlanHint />
      ) : expanded ? (
        <MapView heightClass="h-[calc(100vh-13rem)]" />
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0 space-y-4">
            <ScheduleView />
          </div>
          {companion && (
            <div className="w-full lg:w-[360px] shrink-0 lg:sticky lg:top-6 self-start">
              {companion === "nearby" && <NearbyDrawer />}
              {companion === "inspector" && <LocationInspector />}
              {companion === "map" && <MapView />}
            </div>
          )}
        </div>
      )}

      {showOptimize && <OptimizeModal />}
      {showAddLocation && <AddLocationModal />}
    </div>
  );
}

function NoPlanHint() {
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setActiveSurface = useTripStore((s) => s.setActiveSurface);
  return (
    <div className="card p-8 text-center text-gray-500 dark:text-gray-400 space-y-2">
      <p className="font-medium text-gray-700 dark:text-gray-200">No itinerary yet</p>
      <p className="text-sm">
        Add places under{" "}
        <button onClick={() => setActiveSurface("places")} className="text-brand-600 dark:text-brand-400 hover:underline">
          Places
        </button>
        , then{" "}
        <button onClick={() => setShowOptimize(true)} className="text-brand-600 dark:text-brand-400 hover:underline">
          plan the itinerary
        </button>{" "}
        to cluster them into days.
      </p>
    </div>
  );
}
