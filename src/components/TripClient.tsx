"use client";

import { useEffect, useRef } from "react";
import { numDaysOf, type TripWithDetails } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { resolvePrimaryMode } from "@/lib/travelMode";
import OptimizeModal from "./OptimizeModal";
import LocationInspector from "./LocationInspector";
import InspectorPopover from "./InspectorPopover";
import AddLocationModal from "./AddLocationModal";
import MapPopupWindow from "./MapPopupWindow";
import Manifest from "./Manifest";
import DayNavigator from "./DayNavigator";
import TransitEstimateCaveat from "./TransitEstimateCaveat";

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
      activeDayNumber: 1,
      mapPopupOpen: false,
      discoveryMode: null,
      nearbySearchLocation: null,
      routeSearch: null,
      highlightedLocationId: null,
      inspectedLocationId: null,
    });
  }

  const trip = useTripStore((s) => s.trip) ?? initial;
  const activeSurface = useTripStore((s) => s.activeSurface);
  const discoveryMode = useTripStore((s) => s.discoveryMode);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const mapPopupOpen = useTripStore((s) => s.mapPopupOpen);
  const showOptimize = useTripStore((s) => s.showOptimize);
  const showAddLocation = useTripStore((s) => s.showAddLocation);

  const isEnriching = useTripStore((s) => s.isEnriching);
  const enrichProgress = useTripStore((s) => s.enrichProgress);
  const enrich = useTripStore((s) => s.enrich);
  const pollEnrichment = useTripStore((s) => s.pollEnrichment);

  const setActiveSurface = useTripStore((s) => s.setActiveSurface);
  const setMapPopupOpen = useTripStore((s) => s.setMapPopupOpen);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setShowAddLocation = useTripStore((s) => s.setShowAddLocation);
  const setTransitCaveatDismissed = useTripStore((s) => s.setTransitCaveatDismissed);

  const hasPlan = trip.placements.length > 0;
  // ADR-0019's accepted v1 limitation only applies when transit is actually in play (#88) — a
  // driving/walking-only Trip never touches an estimated-timing transit provider.
  const showTransitCaveat =
    hasPlan && !trip.transitCaveatDismissed && resolvePrimaryMode(trip.allowedModes) === "transit";
  const pendingCount = trip.locations.filter((l) => l.enrichmentStatus === "pending").length;
  const failedCount = trip.locations.filter((l) => l.enrichmentStatus === "failed").length;
  const numDays = numDaysOf(trip.startDate, trip.endDate);

  useEffect(() => {
    pollEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const surfaces: { id: ActiveSurface; label: string }[] = [
    { id: "itinerary", label: "Itinerary" },
    { id: "places", label: "Places" },
  ];

  return (
    // Bottom padding reserves room for the fixed discovery tray so it never covers the
    // unassigned pool at the end of the page.
    <div className={`space-y-6 ${discoveryMode ? "pb-56" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-ink">{trip.name}</h1>
          <p className="text-body text-sub mt-0.5">
            <span className="text-numeral">{trip.locations.length}</span> location
            {trip.locations.length !== 1 ? "s" : ""} ·{" "}
            {fmt(trip.startDate)} → {fmt(trip.endDate)} ·{" "}
            <span className="text-numeral">{numDays}</span> day{numDays !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowAddLocation(true)} className="btn-secondary text-sm">
            + Add location
          </button>
          {pendingCount > 0 && !isEnriching && (
            <span className="text-sm text-faint animate-pulse self-center">
              Enriching {pendingCount}…
            </span>
          )}
          {(failedCount > 0 || pendingCount > 0) && (
            <button
              onClick={enrich}
              disabled={isEnriching}
              className="btn-secondary text-sm disabled:opacity-40"
              title="Retry fetching details for locations still missing them — pending items can get stuck here after a server restart drops the in-memory enrichment queue"
            >
              {isEnriching
                ? enrichProgress
                  ? `${enrichProgress.enriched}/${enrichProgress.total} retried`
                  : "Retrying…"
                : `Retry (${failedCount + pendingCount})`}
            </button>
          )}
          <button onClick={() => setShowOptimize(true)} className="btn-primary text-sm">
            {hasPlan ? "Re-optimize" : "Plan itinerary"}
          </button>
        </div>
      </div>

      {/* Surface switch · map popup toggle (itinerary) */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-line border-line-strong overflow-hidden shrink-0">
          {surfaces.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSurface(s.id)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors
                ${activeSurface === s.id
                  ? "bg-brand-600 dark:bg-brand-500 text-white"
                  : "bg-surface text-sub hover:bg-surface-2"
                }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {activeSurface === "itinerary" && hasPlan && (
          <button onClick={() => setMapPopupOpen(!mapPopupOpen)} className="btn-ghost ml-auto">
            {mapPopupOpen ? "Hide map" : "Map"}
          </button>
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
      ) : (
        <div className="space-y-4">
          {showTransitCaveat && (
            <TransitEstimateCaveat onDismiss={() => setTransitCaveatDismissed(true)} />
          )}
          <DayNavigator />
        </div>
      )}

      {/* Floating layers (#134): the inspector popover anchors to the clicked row; the map is
          a popup window rather than a layout region. */}
      {activeSurface === "itinerary" && <InspectorPopover />}
      <MapPopupWindow />

      {showOptimize && <OptimizeModal />}
      {showAddLocation && <AddLocationModal />}
    </div>
  );
}

function NoPlanHint() {
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setActiveSurface = useTripStore((s) => s.setActiveSurface);
  return (
    <div className="card p-8 text-center text-sub space-y-2">
      <p className="font-medium text-ink">No itinerary yet</p>
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
