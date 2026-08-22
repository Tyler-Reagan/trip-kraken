"use client";

/**
 * The itinerary's row-per-Path shift list (ADR-0036, #139) — every Location-to-Location gap in a
 * Day renders one row per Path in that gap's chain: a plain walk is a chain of length 1 (today's
 * shape, unchanged), a rail Journey decomposes (ADR-0032) into access walk → rail Path(s) →
 * transfer walk(s) → egress walk, each its own row. Shared between `DayCard`'s sidebar list and
 * `MapView`'s `StopPanel` — `as` is polymorphic (`<li>`/`<div>`) since the two hosts have different
 * list semantics.
 */

import { useMemo, useState } from "react";
import { Route, TrainFront, PersonStanding, ChevronRight, ChevronDown } from "lucide-react";
import type { Path } from "@/types/path";
import type { Transit } from "@/types";
import { surfacedTransitOf, surfacedTransitIdOf, isTransferWalk } from "@/lib/surfacedTransit";
import { pathShiftId } from "@/lib/pathPairs";
import { formatDuration } from "@/lib/visitDuration";

function iconFor(path: Path) {
  if (path.kind === "rail") return TrainFront;
  if (path.kind === "walking") return PersonStanding;
  return Route;
}

function labelFor(path: Path): string {
  if (path.kind === "rail") return path.lineName;
  if (isTransferWalk(path)) return `Change at ${path.from.stationName}`;
  if (path.kind === "walking" && path.to.stationName) return `Walk to ${path.to.stationName}`;
  if (path.kind === "walking" && path.from.stationName) return `Walk from ${path.from.stationName}`;
  return path.kind ?? "Unknown";
}

function summaryOf(chain: Path[]): string {
  const lineNames = chain.filter((p) => p.kind === "rail").map((p) => p.lineName);
  return lineNames.length > 0 ? lineNames.join(" → ") : `${chain.length} shifts`;
}

/** One shift row — the content template every variant shares. Field-driven, not kind-branched: a
 * row shows whatever the Path actually has (line name, station name, Basis marker, duration).
 * Typography matches `AnchorRow`'s subtext (`text-meta`, `w-3.5 h-3.5` icon) — this list sits
 * directly between full Location rows and should read as a subordinate member of the same family,
 * not a different, denser component. */
function ShiftRow({
  path, transitById, onStationClick, onHoverChange, shiftId, highlighted, as: Row,
}: {
  path: Path;
  transitById: Map<string, Transit>;
  onStationClick: (t: Transit) => void;
  onHoverChange?: (id: string | null) => void;
  shiftId: string;
  highlighted: boolean;
  as: "li" | "div";
}) {
  const Icon = iconFor(path);
  const straightLine = path.travelCost.basisOfCost === "straightLine";
  const clickableStation = isTransferWalk(path) ? path.from : null;
  const clickableTransit = clickableStation
    ? transitById.get(surfacedTransitIdOf(clickableStation.lat, clickableStation.lng))
    : undefined;

  return (
    <Row
      className={`relative flex items-center gap-2 py-1 pl-5 text-meta text-sub select-none ${highlighted ? "bg-surface-2" : ""}`}
      onMouseEnter={onHoverChange ? () => onHoverChange(shiftId) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(null) : undefined}
    >
      <span className="absolute left-[7px] top-0 bottom-0 w-px bg-line" aria-hidden />
      <span className="absolute left-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface ring-1 ring-line">
        <Icon className="w-2.5 h-2.5 shrink-0 text-brand-500 dark:text-brand-400" />
      </span>
      {clickableTransit ? (
        <button
          data-inspect-anchor={clickableTransit.id}
          onClick={() => onStationClick(clickableTransit)}
          className="font-semibold text-ink hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {labelFor(path)}
        </button>
      ) : (
        <span className="text-ink">{labelFor(path)}</span>
      )}
      <span className="flex-1" />
      <span className="text-numeral text-faint shrink-0">{formatDuration(Math.round(path.travelCost.costAsMinutes))}</span>
      {straightLine && <span className="text-faint shrink-0">(straight-line)</span>}
    </Row>
  );
}

interface PathShiftRowsProps {
  /** undefined = still loading, null = resolved-no-route, Path[] = resolved chain. */
  chain: Path[] | null | undefined;
  tripId: string;
  /** The gap's own `pairKey` — combined with each shift's index (`pathShiftId`) to give every row
   * a stable identity for hover-highlight and for looking up transit stations by coordinate. */
  pairKey: string;
  /** Rendered at the right of the gap's one persistent header row — the "along the way" search
   * trigger. It stays a per-gap affordance, not a per-shift one, and is always visible (not
   * hover-revealed), so a collapsed summary and its action sit on one aligned row. */
  trailing?: React.ReactNode;
  /** What clicking a transfer station's name does — surface-specific. `DayCard`'s sidebar opens
   * the shared `InspectorPopover` (there's no map to focus there); `MapView`'s `StopPanel` instead
   * flies the camera to it (`onFocus`) — the same click-to-focus behavior every other row in that
   * panel already has. */
  onStationClick: (t: Transit) => void;
  /** Only `StopPanel` wires this — hovering a shift row highlights its span on the map canvas.
   * `DayCard`'s sidebar has no canvas to highlight against, so it leaves this undefined. */
  onHoverChange?: (id: string | null) => void;
  highlightedPathId?: string | null;
  /** `DayCard`'s list is a real `<ol>`; `MapView`'s `StopPanel` is plain `<div>`/`<button>` rows
   * with no list semantics at all — an `<li>` there would be invalid markup. Default `"li"`. */
  as?: "li" | "div";
}

/**
 * Renders one Location-to-Location gap: a persistent header row (a collapse toggle once the chain
 * is long enough to be worth collapsing, plus whatever `trailing` content the caller wants aligned
 * to it) and, below it, the shift rows themselves when applicable. `chain`'s three states are
 * exactly the three states a real drag/reorder produces: not yet requested, requested and
 * resolved-empty, or a real chain.
 */
export default function PathShiftRows({
  chain, tripId, pairKey, trailing, onStationClick, onHoverChange, highlightedPathId, as = "li",
}: PathShiftRowsProps) {
  const [expanded, setExpanded] = useState(false);
  const Row = as;

  const transitById = useMemo(
    () => new Map(surfacedTransitOf(chain ?? [], tripId).map((t) => [t.id, t])),
    [chain, tripId]
  );

  if (chain === null) {
    // Resolved-no-route: no shift content, same as "non-transit Paths render nothing new" —
    // but `trailing` (the along-the-way button) still needs a row to sit on.
    return trailing ? <Row className="flex items-center justify-end py-1">{trailing}</Row> : null;
  }

  if (chain === undefined) {
    return (
      <Row className="flex items-center gap-2 py-1 pl-5">
        <span className="h-3.5 w-3.5 rounded-full bg-surface-2 animate-pulse shrink-0" />
        <span className="h-2.5 w-28 rounded bg-surface-2 animate-pulse" />
        <span className="flex-1" />
        {trailing}
      </Row>
    );
  }

  if (chain.length === 0) return trailing ? <Row className="flex items-center justify-end py-1">{trailing}</Row> : null;

  // A long chain collapses behind a persistent header row with a re-openable toggle. Short chains
  // (nothing worth collapsing) skip the toggle and just show their row(s) under a plain header, so
  // the along-the-way button still has one consistent row to align against. Expanding never
  // indents the revealed rows — it reveals more flat rows at the same list level, not a hierarchy.
  const collapsible = chain.length > 2;
  const showRows = !collapsible || expanded;

  return (
    <>
      <Row className="flex items-center gap-1 py-1">
        {collapsible && (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 pl-1 min-w-0 text-meta text-sub hover:text-ink rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {expanded
              ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-brand-500 dark:text-brand-400" />
              : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-brand-500 dark:text-brand-400" />}
            <span className="truncate">{summaryOf(chain)} <span className="text-faint">· {chain.length} shifts</span></span>
          </button>
        )}
        <span className="flex-1 min-w-2" />
        {trailing}
      </Row>
      {showRows && chain.map((path, i) => {
        const shiftId = pathShiftId(pairKey, i);
        return (
          <ShiftRow
            key={i}
            path={path}
            transitById={transitById}
            onStationClick={onStationClick}
            onHoverChange={onHoverChange}
            shiftId={shiftId}
            highlighted={highlightedPathId === shiftId}
            as={as}
          />
        );
      })}
    </>
  );
}
