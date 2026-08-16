"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ScheduledStop, Location } from "@/types";
import type { Unplaced } from "@/lib/solver";
import { useTripStore } from "@/store/tripStore";
import { CalendarOff, Clock, GripVertical, HelpCircle, MapPinOff, PackageX, Search, Trash2, type LucideIcon } from "lucide-react";
import { dayColorCss, dayTextColor } from "@/lib/dayColors";
import { UNASSIGNED_DROP_ID } from "./DayNavigator";

interface Props {
  locations: Location[];
  /** Reasons from the last optimize run (#120), keyed by locationId — ADR-0023 §7's pre-flight
   *  exclusions plus VROOM's own reasonless `unassigned[]`. Distinct from `loc.excluded`: that's
   *  the user's own choice to ignore a Location, this is the optimizer trying and failing. */
  unplacedByLocationId: Map<string, Unplaced>;
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

/**
 * One human category per Unplaced entry (#109) — coarser than `Unplaced.code`/`diagnosis.cause`
 * on purpose. A trip-level summary needs a handful of buckets a traveller recognizes at a glance,
 * not the solver's fine-grained taxonomy (`day-full` vs `day-too-short` are the same story to a
 * user: this day couldn't take it).
 *
 * `ungeocoded-pending`/`ungeocoded-failed` are deliberately absent: `UnassignedRow` already shows
 * those via the enrichment dot/exclaim next to the name, and a second icon here would say the same
 * thing twice.
 */
type Category = { icon: LucideIcon; label: string };

function categoryOf(u: Unplaced): Category | null {
  switch (u.code) {
    case "no-lodging-coverage":
      return { icon: MapPinOff, label: "No nearby lodging" };
    case "closed-all-days":
      return { icon: CalendarOff, label: "Closed the whole trip" };
    case "solver":
      switch (u.diagnosis?.cause) {
        case "out-of-reach":
          return { icon: MapPinOff, label: "Too far from every day" };
        case "day-full":
        case "day-too-short":
          return { icon: PackageX, label: "No day has room" };
        case "after-closing":
        case "before-opening":
          return { icon: Clock, label: "Hours don't line up" };
        default:
          return { icon: HelpCircle, label: "Couldn't fit anywhere" };
      }
    default:
      return null;
  }
}

/** A one-line rollup, grouped into the same coarse buckets `categoryOf` shows per-row (#109's
 * "day- and/or trip-level summary" criterion) — omitted entirely when there's nothing to say. */
function UnplacedSummary({ items }: { items: Unplaced[] }) {
  const counted = items.filter((u) => !u.code.startsWith("ungeocoded"));
  if (counted.length === 0) return null;

  const byLabel = new Map<string, number>();
  for (const u of counted) {
    const label = categoryOf(u)?.label ?? "Couldn't fit anywhere";
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }

  return (
    <p className="text-xs text-faint">
      {[...byLabel].map(([label, count], i) => (
        <span key={label}>
          {i > 0 && " · "}
          {count} {label.toLowerCase()}
        </span>
      ))}
    </p>
  );
}

export default function UnassignedCard({ locations, unplacedByLocationId, draggingStop, dragId, schedulable = true }: Props) {
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

      <UnplacedSummary items={locations.flatMap((l) => unplacedByLocationId.get(l.id) ?? [])} />

      {locations.length === 0 ? (
        <p className="text-sm text-faint italic py-1 text-center">
          Drag stops here to unschedule them
        </p>
      ) : (
        <ul className="space-y-2">
          {locations.map((loc) => (
            <UnassignedRow
              key={loc.id}
              id={dragId(loc.id)}
              loc={loc}
              unplaced={unplacedByLocationId.get(loc.id) ?? null}
              schedulable={schedulable}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The per-row indicator (#109): an icon naming the cause in human terms, `unplaced.reason`'s
 * ready-made sentence (already carries the magnitude in minutes where the diagnosis has one — see
 * `diagnosisReason` in `vroom/plan.ts`), and — only when the diagnosis names one — a day badge
 * colored the same as that day everywhere else in the app (`dayColorCss`), so "day 2" reads as the
 * same day 2 the map and timeline already taught the user to recognize. */
function UnplacedReason({ unplaced }: { unplaced: Unplaced }) {
  const category = categoryOf(unplaced);
  const Icon = category?.icon;
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-1">
      {Icon && <Icon className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />}
      <span>
        {unplaced.diagnosis && (
          <span
            className="inline-block w-3.5 h-3.5 rounded-full text-center mr-1 align-text-bottom text-[9px] font-bold leading-[14px]"
            style={{ backgroundColor: dayColorCss(unplaced.diagnosis.dayNumber), color: dayTextColor(unplaced.diagnosis.dayNumber) }}
            title={`Day ${unplaced.diagnosis.dayNumber}`}
          >
            {unplaced.diagnosis.dayNumber}
          </span>
        )}
        {unplaced.reason}
      </span>
    </p>
  );
}

function UnassignedRow({
  id,
  loc,
  unplaced,
  schedulable,
}: {
  id: string;
  loc: Location;
  unplaced: Unplaced | null;
  schedulable: boolean;
}) {
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
      data-inspect-anchor={loc.id}
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
        {/* #120: an Excluded location (the user's own choice) and an Unplaced one (the optimizer
            tried and failed) read as different problems — never the same generic gap. */}
        {loc.excluded ? (
          <p className="text-xs text-faint italic mt-0.5">Excluded — won&apos;t be scheduled</p>
        ) : unplaced ? (
          <UnplacedReason unplaced={unplaced} />
        ) : (
          <p className="text-xs text-faint mt-0.5">
            {hoursText} · {durText}
          </p>
        )}
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
