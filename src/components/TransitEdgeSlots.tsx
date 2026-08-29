"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import {
  isActivity,
  tripEdgesOf,
  type IsoDate,
  type Location,
  type Transit,
  type TripWithDetails,
} from "@/types";
import { AssignExisting } from "./LodgingNightStrip";

/**
 * The trip's two edges (ADR-0028 §7): an Arriving row and a Departing row. They live in one card
 * rather than two, because they aren't two independent decisions the way two activities are — they
 * are one statement about the shape of the trip, and a shared frame says so. The group always
 * renders, even with both rows empty; an empty row is the only thing that can tell a traveller this
 * capability exists at all.
 *
 * Each row picks an existing Location and edits its time. The date component is never *entered*
 * here — it is composed server-side from the trip's own start/end date (ADR-0028 §3) — but it is
 * shown, because a slot that hides the one date it is about is needlessly abstract.
 *
 * The time commits on blur, never on change. `saveTransitEdge` ends in a full-trip `reload()`, and a
 * native time input fires `change` once per edited component, so the previous per-change handler
 * cost two or three complete trip reloads to enter a single time. The `draft !== time` guard means a
 * focus-then-blur with no edit writes nothing at all.
 *
 * Clearing the time field and removing the row are deliberately different actions: an empty field
 * saves the bare date ("time not known yet" — the native `--:--` already reads as unset), while the
 * X releases the edge entirely.
 */

const fmtEdgeDate = (d: IsoDate) =>
  new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/** The "HH:MM" portion of a stored edge value, or "" for a bare date / no time known. */
function timeOf(value: string | null): string {
  if (!value) return "";
  const t = value.indexOf("T");
  return t === -1 ? "" : value.slice(t + 1);
}

function EdgeRow({
  label,
  date,
  Icon,
  location,
  time,
  candidates,
  onAssign,
  onCommitTime,
  onClear,
}: {
  label: string;
  date: IsoDate;
  Icon: LucideIcon;
  location: Transit | null;
  time: string;
  candidates: Location[];
  onAssign: (locationId: string) => void;
  onCommitTime: (time: string) => void;
  onClear: () => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft !== null && draft !== time) onCommitTime(draft);
    setDraft(null);
  }

  return (
    <div className="flex items-center gap-3 p-3">
      <Icon
        className={`w-4 h-4 shrink-0 ${location ? "text-brand-600 dark:text-brand-400" : "text-faint"}`}
        aria-hidden
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-meta text-faint">{label}</p>
          <span className="text-[11px] text-faint tabular-nums">
            {fmtEdgeDate(date)}
          </span>
        </div>

        {assigning ? (
          <div className="mt-1.5">
            <AssignExisting
              activities={candidates}
              onAssign={(id) => {
                onAssign(id);
                setAssigning(false);
              }}
              onCancel={() => setAssigning(false)}
            />
          </div>
        ) : location ? (
          // The name is the control for changing the place. Previously the only way to swap it was
          // to clear the edge and start over.
          <button
            onClick={() => setAssigning(true)}
            className="-ml-1 px-1 py-0.5 rounded max-w-full text-left text-sm text-ink truncate block hover:bg-surface-3"
            title="Change place"
          >
            {location.name}
          </button>
        ) : (
          <button
            onClick={() => setAssigning(true)}
            disabled={candidates.length === 0}
            className="btn-secondary text-xs py-1 px-2.5 mt-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {candidates.length === 0 ? "Add a place first" : "Choose a place"}
          </button>
        )}
      </div>

      {!assigning && location && (
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="time"
            value={draft ?? time}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="input py-1 text-xs w-[92px]"
            aria-label={`${label} time`}
            title="Optional — leave blank if the time isn't known yet"
          />
          <button
            onClick={onClear}
            className="tap-target shrink-0 text-faint hover:text-danger-600 dark:hover:text-danger-400"
            aria-label={`Remove ${label.toLowerCase()}`}
            title={`Remove ${label.toLowerCase()}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function TransitSection({ trip }: { trip: TripWithDetails }) {
  const saveTransitEdge = useTripStore((s) => s.saveTransitEdge);

  const { arrival, departure } = tripEdgesOf(trip);

  // Excluded activities aren't offered — an edge, like a lodging booking, promotes a place *into*
  // active use (ADR-0015). A Location already holding the *other* edge is still a legitimate
  // candidate for this one: one airport for both legs is the common round-trip case (ADR-0028 §1).
  const activities = trip.locations.filter((l) => isActivity(l) && !l.excluded);
  const arrivalCandidates = departure ? [...activities, departure] : activities;
  const departureCandidates = arrival ? [...activities, arrival] : activities;

  return (
    <div className="card divide-y divide-line">
      <EdgeRow
        label="Arriving"
        date={trip.startDate}
        Icon={ArrowDownToLine}
        location={arrival}
        time={timeOf(arrival?.arriveAt ?? null)}
        candidates={arrivalCandidates}
        onAssign={(id) => saveTransitEdge(id, "arrival", "")}
        onCommitTime={(time) =>
          arrival && saveTransitEdge(arrival.id, "arrival", time)
        }
        onClear={() => arrival && saveTransitEdge(arrival.id, "arrival", null)}
      />
      <EdgeRow
        label="Departing"
        date={trip.endDate}
        Icon={ArrowUpFromLine}
        location={departure}
        time={timeOf(departure?.departAt ?? null)}
        candidates={departureCandidates}
        onAssign={(id) => saveTransitEdge(id, "departure", "")}
        onCommitTime={(time) =>
          departure && saveTransitEdge(departure.id, "departure", time)
        }
        onClear={() =>
          departure && saveTransitEdge(departure.id, "departure", null)
        }
      />
    </div>
  );
}
