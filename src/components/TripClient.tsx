"use client";

import { useEffect, useMemo, useRef } from "react";
import { deriveTripPlanDays, numDaysOf, type TripWithDetails } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { usePathGeometry, PathGeometryProvider } from "@/lib/usePathGeometry";
import OptimizeModal from "./OptimizeModal";
import LocationInspector from "./LocationInspector";
import InspectorPopover from "./InspectorPopover";
import AddLocationModal from "./AddLocationModal";
import MapPopupWindow from "./MapPopupWindow";
import Manifest from "./Manifest";
import DayNavigator from "./DayNavigator";
import TransitEstimateCaveat from "./TransitEstimateCaveat";
import DistantMetroWarning from "./DistantMetroWarning";
import EnrichmentFailureNotice from "./EnrichmentFailureNotice";

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
      focusTarget: null,
      autoFocusArmed: true,
      discoveryMode: null,
      nearbySearchLocation: null,
      routeSearch: null,
      highlightedLocationId: null,
      highlightedPathId: null,
      inspectedLocationId: null,
      inspectedSurfacedTransit: null,
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
  const pollEnrichment = useTripStore((s) => s.pollEnrichment);

  const setActiveSurface = useTripStore((s) => s.setActiveSurface);
  const setMapPopupOpen = useTripStore((s) => s.setMapPopupOpen);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setShowAddLocation = useTripStore((s) => s.setShowAddLocation);
  const setTransitCaveatDismissed = useTripStore((s) => s.setTransitCaveatDismissed);

  const hasPlan = trip.placements.length > 0;
  // ADR-0019's accepted v1 limitation applies whenever a plan exists: rail/bus are always in the
  // kinds a matrix sources (ADR-0024 §3, optimize.ts), so every plan potentially touches the
  // estimated-timing transit provider now that `allowedPathKinds` (a per-Trip opt-out that no UI
  // ever set) is gone. Behaviour-identical to the old expression, which always resolved to "rail"
  // in practice since the column was always null.
  const showTransitCaveat = hasPlan && !trip.transitCaveatDismissed;
  const pendingCount = trip.locations.filter((l) => l.enrichmentStatus === "pending").length;
  const numDays = numDaysOf(trip.startDate, trip.endDate);

  useEffect(() => {
    pollEnrichment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const surfaces: { id: ActiveSurface; label: string }[] = [
    { id: "itinerary", label: "Itinerary" },
    { id: "places", label: "Places" },
  ];

  // Hoisted from MapView (ADR-0036, #139) so DayCard's sidebar shift rows and MapView's StopPanel
  // share one pair-keyed cache (usePathGeometry's own doc comment) instead of each fetching
  // separately.
  const days = useMemo(() => deriveTripPlanDays(trip), [trip]);
  const roadProfile = trip.roadProfile;
  const pathGeometry = usePathGeometry(trip.id, days, roadProfile, trip.legModePins);

  // Bottom padding on the wrapper below reserves room for the fixed discovery tray so it never
  // covers the unassigned pool at the end of the page.
  return (
    <PathGeometryProvider value={{ pathGeometry, roadProfile }}>
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
          {/* Pending rows self-recover on server startup (ADR-0009, #124). The `failed`-only retry
              a human triggers now lives in `EnrichmentFailureNotice`, next to the names of the
              places it would retry — a toolbar button had nowhere to say which those were. */}
          <button onClick={() => setShowOptimize(true)} className="btn-primary text-sm">
            {hasPlan ? "Re-optimize" : "Plan itinerary"}
          </button>
        </div>
      </div>

      {/* Both are pre-optimize signals, on both surfaces regardless of whether a plan exists: the
          point of each is catching something before the user (re-)optimizes. Failures come first —
          a place with no coordinates is also a place the metro detector below can't see. */}
      <EnrichmentFailureNotice />
      <DistantMetroWarning />

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
        // items-start only once this is a row: in the stacked column below `lg` it makes the
        // Manifest shrink to its content width and hug the left instead of filling. The inspector
        // carries its own `self-start`, so the container never needed it for that.
        <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
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
    </PathGeometryProvider>
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
