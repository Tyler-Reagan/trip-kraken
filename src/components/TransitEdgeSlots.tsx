"use client";

import { useState } from "react";
import { TrainFront, X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { isActivity, isTransit, type Location, type Transit, type TripWithDetails } from "@/types";
import { AssignExisting } from "./LodgingNightStrip";

/**
 * The trip's two edges (ADR-0028 §7): an Arriving slot and a Departing slot in the Manifest's
 * Transit group, mirroring the Lodging night strip's purpose-built gesture rather than a generic
 * field editor. The group always renders, even empty — an empty slot is the only thing that can
 * tell a traveller this capability exists at all. Each slot picks an existing Location and edits
 * its time; the date component is never entered here, only composed server-side from the trip's
 * own start/end date (ADR-0028 §3).
 */

/** The "HH:MM" portion of a stored edge value, or "" for a bare date / no time known. */
function timeOf(value: string | null): string {
  if (!value) return "";
  const t = value.indexOf("T");
  return t === -1 ? "" : value.slice(t + 1);
}

function EdgeSlot({
  label,
  location,
  fieldOf,
  candidates,
  onAssign,
  onTimeChange,
  onClear,
}: {
  label: string;
  location: Transit | null;
  fieldOf: (l: Transit) => string | null;
  candidates: Location[];
  onAssign: (locationId: string) => void;
  onTimeChange: (time: string) => void;
  onClear: () => void;
}) {
  const [assigning, setAssigning] = useState(false);

  if (!location) {
    return (
      <div className="card p-3 space-y-2">
        <p className="text-xs text-faint flex items-center gap-1.5">
          <TrainFront className="w-3.5 h-3.5 shrink-0" />
          {label}
        </p>
        {assigning ? (
          <AssignExisting
            activities={candidates}
            onAssign={(id) => {
              onAssign(id);
              setAssigning(false);
            }}
            onCancel={() => setAssigning(false)}
          />
        ) : (
          <button
            onClick={() => setAssigning(true)}
            disabled={candidates.length === 0}
            className="text-xs text-faint hover:text-brand-600 dark:hover:text-brand-400 underline underline-offset-2 disabled:no-underline disabled:hover:text-faint disabled:cursor-not-allowed"
          >
            {candidates.length === 0 ? "Add a place first" : "Assign a place →"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card p-3 flex items-center gap-2">
      <TrainFront className="w-4 h-4 shrink-0 text-sub" />
      <div className="flex-1 min-w-0">
        <p className="text-meta text-faint">{label}</p>
        <span className="text-sm text-ink truncate block">{location.name}</span>
      </div>
      <input
        type="time"
        value={timeOf(fieldOf(location))}
        onChange={(e) => onTimeChange(e.target.value)}
        className="input py-1 text-xs w-24"
        aria-label={`${label} time`}
        title="Optional — leave blank if the time isn't known yet"
      />
      <button
        onClick={onClear}
        className="text-faint hover:text-danger-600 dark:hover:text-danger-400 p-0.5 shrink-0"
        aria-label={`Clear ${label.toLowerCase()}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function TransitSection({ trip }: { trip: TripWithDetails }) {
  const saveTransitEdge = useTripStore((s) => s.saveTransitEdge);

  const arrival = trip.locations.find((l): l is Transit => isTransit(l) && l.arriveAt != null) ?? null;
  const departure = trip.locations.find((l): l is Transit => isTransit(l) && l.departAt != null) ?? null;

  // Excluded activities aren't offered — an edge, like a lodging booking, promotes a place *into*
  // active use (ADR-0015). A Location already holding the *other* edge is still a legitimate
  // candidate for this one: one airport for both legs is the common round-trip case (ADR-0028 §1).
  const activities = trip.locations.filter((l) => isActivity(l) && !l.excluded);
  const arrivalCandidates = departure ? [...activities, departure] : activities;
  const departureCandidates = arrival ? [...activities, arrival] : activities;

  return (
    <div className="space-y-2">
      <EdgeSlot
        label="Arriving"
        location={arrival}
        fieldOf={(l) => l.arriveAt}
        candidates={arrivalCandidates}
        onAssign={(id) => saveTransitEdge(id, "arrival", "")}
        onTimeChange={(time) => arrival && saveTransitEdge(arrival.id, "arrival", time)}
        onClear={() => arrival && saveTransitEdge(arrival.id, "arrival", null)}
      />
      <EdgeSlot
        label="Departing"
        location={departure}
        fieldOf={(l) => l.departAt}
        candidates={departureCandidates}
        onAssign={(id) => saveTransitEdge(id, "departure", "")}
        onTimeChange={(time) => departure && saveTransitEdge(departure.id, "departure", time)}
        onClear={() => departure && saveTransitEdge(departure.id, "departure", null)}
      />
    </div>
  );
}
