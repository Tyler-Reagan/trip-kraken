"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ScheduledStop, Location } from "@/types";
import { useTripStore } from "@/store/tripStore";
import { GripVertical, Search, Trash2 } from "lucide-react";
import { UNASSIGNED_DROP_ID } from "./ScheduleView";

interface Props {
  locations: Location[];
  draggingStop: ScheduledStop | null;
  dragId: (locationId: string) => string;
  /** False before the first optimize: there are no days to drag a location onto yet. */
  schedulable?: boolean;
}

function formatHoursSubtext(loc: Location): string {
  if (!loc.openTime && !loc.closeTime) return "No hours";
  if (loc.openTime === "00:00" && loc.closeTime === "23:59") return "Always open";
  return `${loc.openTime ?? "?"}–${loc.closeTime ?? "?"}`;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function UnassignedCard({ locations, draggingStop, dragId, schedulable = true }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: UNASSIGNED_DROP_ID });
  const isDragTarget = isOver && draggingStop !== null;

  return (
    <div
      ref={setNodeRef}
      className={`card p-4 space-y-3 border-dashed transition-all
        ${isDragTarget ? "ring-2 ring-brand-400 bg-brand-50 dark:bg-brand-950/20" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-faint">
          Unassigned
        </span>
        <span className="text-xs text-faint">
          {locations.length} location{locations.length !== 1 ? "s" : ""}
        </span>
      </div>

      {locations.length === 0 ? (
        <p className="text-sm text-faint italic py-1 text-center">
          Drag stops here to unschedule them
        </p>
      ) : (
        <ul className="space-y-2">
          {locations.map((loc) => (
            <UnassignedRow key={loc.id} id={dragId(loc.id)} loc={loc} schedulable={schedulable} />
          ))}
        </ul>
      )}
    </div>
  );
}

function UnassignedRow({ id, loc, schedulable }: { id: string; loc: Location; schedulable: boolean }) {
  const tripId = useTripStore((s) => s.tripId);
  const reload = useTripStore((s) => s.reload);
  const setNearbySearchLocation = useTripStore((s) => s.setNearbySearchLocation);
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { kind: "location", location: loc },
    disabled: !schedulable,
  });

  const isInspected = inspectedLocationId === loc.id;
  const hoursText = formatHoursSubtext(loc);
  const durText = loc.visitDuration !== null ? formatDuration(loc.visitDuration) : "—";

  async function doRemoveLocation() {
    await fetch(`/api/trips/${tripId}/locations/${loc.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <li
      ref={setNodeRef}
      {...(schedulable ? { ...attributes, ...listeners } : {})}
      className={`group flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all select-none
        ${schedulable ? "touch-none" : ""}
        ${isDragging ? "opacity-40" : ""}
        ${isInspected
          ? "bg-surface-2 border-line border-line-strong"
          : "border-transparent hover:bg-surface-2 hover:border-line-strong"
        }`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        setInspectedLocationId(isInspected ? null : loc.id);
      }}
    >
      {/* Drag handle — only meaningful once there are days to drag onto */}
      {schedulable && (
        <span
          className="shrink-0 text-ghost cursor-grab active:cursor-grabbing mt-0.5 select-none"
          title="Drag to a day to schedule"
        >
          <GripVertical className="w-4 h-4" />
        </span>
      )}

      {/* Name + subtext */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium text-ink truncate">{loc.name}</p>
          {loc.enrichmentStatus === "pending" && (
            <span className="text-[10px] text-faint animate-pulse shrink-0">···</span>
          )}
          {loc.enrichmentStatus === "failed" && (
            <span className="text-[10px] text-amber-500 shrink-0 font-bold" title="Enrichment failed">!</span>
          )}
        </div>
        <p className="text-xs text-faint mt-0.5">
          {hoursText} · {durText}
        </p>
      </div>

      {/* Action buttons */}
      <div className="shrink-0 flex items-center gap-0.5 hover-reveal transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); setNearbySearchLocation(loc, null); }}
          disabled={loc.lat === null}
          title={loc.lat === null ? "No coordinates — run Enrich first" : "Find nearby places anchored to this location"}
          aria-label="Find nearby places"
          className="w-7 h-7 flex items-center justify-center rounded text-faint hover:text-brand-600 dark:hover:text-brand-400 hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); doRemoveLocation(); }}
          title="Remove location from trip"
          aria-label="Remove location"
          className="w-7 h-7 flex items-center justify-center rounded text-faint hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
}
