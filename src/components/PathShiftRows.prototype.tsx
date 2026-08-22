"use client";

/**
 * #139 PROTOTYPE — throwaway. Answers the reconciled decision's one open question: what a
 * row-per-Path shift list feels like once rendered, and how it settles when its data goes stale.
 * See https://github.com/Tyler-Reagan/trip-kraken/issues/139#issuecomment-5374766195 for the spec
 * this implements. Three variants, switchable via `?variant=A|B|C` on the trip page — see
 * `PrototypeSwitcher.prototype.tsx`. The user has picked C; A/B stay wired for comparison but are
 * no longer being refined. Not production code: no tests, minimal error handling, and it will be
 * deleted (or rewritten properly) once folded in for real.
 */

import { useState } from "react";
import { Route, TrainFront, PersonStanding, ChevronRight, ChevronDown } from "lucide-react";
import type { Path, PathEndpoint } from "@/types/path";
import type { Transit } from "@/types";
import { formatDuration } from "@/lib/visitDuration";

export type ShiftVariant = "A" | "B" | "C";

/** PROTOTYPE-ONLY stand-in for a real fix: `transitGraphIngest.ts`'s `lineNameOf`/`stationNameOf`
 * now prefer OSM's `name:en` tag (already changed, see that file) — every tag the parser reads is
 * already captured, `name:en` was just never consulted. That only takes effect once
 * `db/transit-japan.db` is rebuilt by `scripts/ingest-transit-graph.sh`, which downloads a fresh
 * Geofabrik Japan extract and re-runs `osmium` — a heavier, network-dependent step, not something
 * to run just to preview a UI change. This table exists solely so this prototype can be judged in
 * English right now; delete it the moment a real re-ingest makes it redundant. */
const LATIN_NAME: Record<string, string> = {
  "池袋": "Ikebukuro",
  "新宿": "Shinjuku",
  "高円寺": "Koenji",
  "JR埼京線": "JR Saikyo Line",
  "JR中央線（下り）": "JR Chuo Line (Outbound)",
};
function latinize(name: string): string {
  return LATIN_NAME[name] ?? name;
}

/** Mirrors `surfacedTransit.ts`'s own private check (not exported) — both ends of a transfer's own
 * walking Path carry the station *cluster*'s name, which is the reliable signal a rail Path's
 * boarding/alighting ends don't share. */
function isTransferWalk(path: Path): boolean {
  return path.kind === "walking" && !!path.from.stationName && !!path.to.stationName;
}

export function surfacedTransitFor(endpoint: PathEndpoint, tripId: string): Transit {
  return {
    id: `surfaced-transit:${endpoint.lat.toFixed(6)},${endpoint.lng.toFixed(6)}`,
    tripId,
    kind: "transit",
    authored: false,
    name: endpoint.stationName!,
    lat: endpoint.lat,
    lng: endpoint.lng,
    arriveAt: null,
    departAt: null,
    address: null,
    placeId: null,
    excluded: false,
    note: null,
    rating: null,
    reviewCount: null,
    categories: null,
    visitDuration: null,
    openTime: null,
    closeTime: null,
    hoursJson: null,
    phone: null,
    enrichmentStatus: "done",
    enrichmentError: null,
  };
}

function iconFor(path: Path) {
  if (path.kind === "rail") return TrainFront;
  if (path.kind === "walking") return PersonStanding;
  return Route;
}

function labelFor(path: Path): string {
  if (path.kind === "rail") return latinize(path.lineName);
  if (isTransferWalk(path)) return `Change at ${latinize(path.from.stationName!)}`;
  if (path.kind === "walking" && path.to.stationName) return `Walk to ${latinize(path.to.stationName)}`;
  if (path.kind === "walking" && path.from.stationName) return `Walk from ${latinize(path.from.stationName)}`;
  return path.kind ?? "Unknown";
}

/** One shift row — the content template every variant shares. Field-driven, not kind-branched: a
 * row shows whatever the Path actually has (line name, station name, Basis marker, duration).
 * Typography matches `AnchorRow`'s subtext (`text-meta`, `w-3.5 h-3.5` icon) rather than inventing
 * a smaller scale of its own — this list sits directly between full Location rows and should read
 * as a subordinate member of the same family, not a different, denser component.
 *
 * `onStationClick` is caller-supplied rather than hardcoded: `DayCard`'s sidebar opens the shared
 * `InspectorPopover` (there's no map to focus there); `MapView`'s `StopPanel` instead calls
 * `onFocus` to fly the camera to it — the same click-to-focus behavior every other row in that
 * panel already has. One row template, two surfaces, each wiring its own click per its own
 * existing convention (mirrors how `StopRow` and `PanelStopRow` already differ on a plain Location). */
function ShiftRow({
  path, tripId, onStationClick, as: Row,
}: { path: Path; tripId: string; onStationClick: (t: Transit) => void; as: "li" | "div" }) {
  const Icon = iconFor(path);
  const straightLine = path.travelCost.basisOfCost === "straightLine";
  const clickableStation = isTransferWalk(path) ? path.from : null;

  return (
    <Row className="relative flex items-center gap-2 py-1 pl-5 text-meta text-sub select-none">
      <span className="absolute left-[7px] top-0 bottom-0 w-px bg-line" aria-hidden />
      <span className="absolute left-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-surface ring-1 ring-line">
        <Icon className="w-2.5 h-2.5 shrink-0 text-brand-500 dark:text-brand-400" />
      </span>
      {clickableStation ? (
        <button
          data-inspect-anchor={`surfaced-transit:${clickableStation.lat.toFixed(6)},${clickableStation.lng.toFixed(6)}`}
          onClick={() => onStationClick(surfacedTransitFor(clickableStation, tripId))}
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

function summaryOf(chain: Path[]): string {
  const lineNames = chain.filter((p) => p.kind === "rail").map((p) => latinize((p as { lineName: string }).lineName));
  return lineNames.length > 0 ? lineNames.join(" → ") : `${chain.length} shifts`;
}

interface PathGapProps {
  chain: Path[] | null | undefined; // undefined = still loading, null = resolved-no-route, Path[] = resolved chain
  tripId: string;
  variant: ShiftVariant;
  /** Rendered at the right of the gap's one persistent header row — the "along the way" search
   * trigger, per the reconciled decision: it stays a per-gap affordance, not a per-shift one, and
   * (per this round's refinement) always visible rather than hover-revealed, so a variant-C
   * collapsed summary and its action sit on one aligned row instead of leaving a gap when hidden. */
  trailing?: React.ReactNode;
  /** What clicking a transfer station's name does — surface-specific, see `ShiftRow`'s own doc. */
  onStationClick: (t: Transit) => void;
  /** `DayCard`'s list is a real `<ol>`; `MapView`'s `StopPanel` is plain `<div>`/`<button>` rows
   * with no list semantics at all — an `<li>` there would be invalid markup. Default `"li"`. */
  as?: "li" | "div";
}

/**
 * Renders one Location-to-Location gap: a persistent header row (variant C's collapse toggle plus
 * whatever `trailing` content the caller wants aligned to it) and, below it, the shift rows
 * themselves when applicable. `chain`'s three states are exactly the three states a real
 * drag/reorder produces: not yet requested, requested and resolved-empty, or a real chain.
 */
export function PathShiftRows({ chain, tripId, variant, trailing, onStationClick, as = "li" }: PathGapProps) {
  const [expanded, setExpanded] = useState(false);
  const Row = as;

  if (chain === null) {
    // Resolved-no-route: no shift content, same as today's "non-transit Paths render nothing new"
    // rule — but `trailing` (the along-the-way button) still needs a row to sit on.
    return trailing ? <Row className="flex items-center justify-end py-1">{trailing}</Row> : null;
  }

  if (chain === undefined) {
    // B: pop-in — no placeholder while loading. A and C both show a loading state.
    if (variant === "B") return trailing ? <Row className="flex items-center justify-end py-1">{trailing}</Row> : null;
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

  // C: a long chain collapses behind a persistent header row with a re-openable toggle. Short
  // chains (nothing worth collapsing) skip the toggle and just show their row(s) under a plain
  // header, so the along-the-way button still has one consistent row to align against.
  const collapsible = variant === "C" && chain.length > 2;
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
      {showRows && chain.map((path, i) => (
        <ShiftRow key={i} path={path} tripId={tripId} onStationClick={onStationClick} as={as} />
      ))}
    </>
  );
}
