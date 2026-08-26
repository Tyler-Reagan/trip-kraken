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
import { Route, TrainFront, PersonStanding, CarFront, ChevronRight, ChevronDown } from "lucide-react";
import { isRailPath, type Path, type RoadProfile } from "@/types/path";
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

/** Whether one Path needs the "extra fare applies" marker (issue #211/#212): an objective fact
 * about the service (set on the Path regardless of the traveler's own hasJrPass), but only worth
 * telling a traveler who actually declared a Pass — otherwise they are just paying the ordinary
 * Nozomi/Mizuho fare like anyone else, and the marker would read as a non-sequitur. The one place
 * this predicate is evaluated — `chainHasSupplement` and `ShiftRow` both call it rather than each
 * re-deriving it. */
function needsSupplementMarker(path: Path, hasJrPass: boolean): boolean {
  return hasJrPass && path.kind === "rail" && path.jrPassSupplementRequired === true;
}

/** Whether any rail Path in the chain needs the marker — so a collapsed header still says so
 * rather than hiding it behind a manual expand (issue #212). */
function chainHasSupplement(chain: Path[], hasJrPass: boolean): boolean {
  return chain.some((p) => needsSupplementMarker(p, hasJrPass));
}

/**
 * Whether a Journey's road-kind toggle (issue #217/#218/#219, renamed #223 — see
 * `pathPairs.ts`'s `withJourneyRoadKind` for why "pin"/"leg" are wrong here) would do anything on
 * this gap: only when nothing in the chain is currently rail-covered — choosing walk/drive for a
 * rail-covered Journey has no effect until rail declines that cell (#218's "first capable provider
 * wins each cell"), and the toggle shouldn't silently offer a no-op.
 *
 * **This operates at the Journey level, not the shift level** — it decides which kind a whole
 * gap resolves to when no shift in it is rail-covered; it cannot retarget one shift within an
 * otherwise-rail Journey (e.g., "drive to the station, keep the train"). That finer-grained control
 * is real, wanted, and explicitly out of scope here — tracked separately at
 * [#225](https://github.com/Tyler-Reagan/trip-kraken/issues/225).
 *
 * Undetectable the same way for a *bus*-covered Journey: `path-geometry`'s route deliberately never
 * asks Google (ADR-0029 §2, to avoid billing it on every map load), so a bus-covered Journey renders
 * here as an ordinary OSRM/haversine answer — the same blind spot that route's own doc already
 * names for geometry, inherited here rather than re-solved. Toggling such a Journey is a quiet no-op
 * until google declines it, same as it already silently is for `roadProfile` today.
 */
function roadKindApplies(chain: Path[]): boolean {
  return !chain.some(isRailPath);
}

/**
 * The walk/drive toggle for one Journey (#219, corrected #223 — this used to be framed as an
 * optional "pin," which implied guarding a value against change; it's a plain two-way toggle
 * between kinds, always in one of the two states). Two icon buttons rather than a tri-state
 * dropdown, matching `OptimizeModal`'s segmented `roadProfile` control at a size that fits a shift
 * row.
 *
 * `kind` is the Journey's *effective* kind — an explicit choice if one is stored, else the Trip's
 * `roadProfile` default — resolved by the caller and always non-null, so the button matching
 * what's actually in effect is highlighted from mount, not only after a click (#223's other
 * correction: the old version could show neither button highlighted for an untouched Journey,
 * because it never received enough information to know the effective kind at all).
 *
 * Clicking the inactive button switches to it (writes an explicit choice); clicking the already-
 * active button clears any explicit choice, letting the Journey resume tracking the Trip default
 * if it later changes. The tooltip doesn't distinguish "explicit choice" from "Trip default" —
 * from the rider's side there's no meaningful difference between the two, only which kind is
 * currently in effect; that distinction is this component's own implementation detail, not
 * something to surface as a concept.
 */
function JourneyKindToggle({
  kind, onKindChange,
}: {
  kind: RoadProfile;
  onKindChange: (kind: RoadProfile | null) => void;
}) {
  const buttonClass = (active: boolean) =>
    `p-1 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
      active ? "text-brand-600 dark:text-brand-400 bg-surface-2" : "text-faint hover:text-sub hover:bg-surface-2"
    }`;
  return (
    <span className="flex items-center gap-0.5 shrink-0" role="group" aria-label="This Journey's road kind">
      <button
        type="button"
        onClick={() => onKindChange(kind === "walking" ? null : "walking")}
        aria-pressed={kind === "walking"}
        title={kind === "walking" ? "Walking" : "Switch this Journey to walking"}
        className={buttonClass(kind === "walking")}
      >
        <PersonStanding className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onKindChange(kind === "driving" ? null : "driving")}
        aria-pressed={kind === "driving"}
        title={kind === "driving" ? "Driving" : "Switch this Journey to driving"}
        className={buttonClass(kind === "driving")}
      >
        <CarFront className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

/** One shift row — the content template every variant shares. Field-driven, not kind-branched: a
 * row shows whatever the Path actually has (line name, station name, Basis marker, duration).
 * Typography matches `AnchorRow`'s subtext (`text-meta`, `w-3.5 h-3.5` icon) — this list sits
 * directly between full Location rows and should read as a subordinate member of the same family,
 * not a different, denser component. */
function ShiftRow({
  path, transitById, onStationClick, onHoverChange, shiftId, highlighted, supplementApplies, endContent, as: Row,
}: {
  path: Path;
  transitById: Map<string, Transit>;
  onStationClick: (t: Transit) => void;
  onHoverChange?: (id: string | null) => void;
  shiftId: string;
  highlighted: boolean;
  /** Pre-resolved by `PathShiftRows` (`needsSupplementMarker`), the same way `highlighted` is —
   * this row never re-derives it from a raw `hasJrPass`. */
  supplementApplies: boolean;
  /** The gap's kind toggle and/or `trailing`, folded onto this row instead of a separate header
   * (#219 follow-up) — only ever passed to the last row of a non-collapsible chain; see
   * `PathShiftRows` below for why. */
  endContent?: React.ReactNode;
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
      className={`relative flex items-center gap-2 py-1 pl-5 pr-2.5 text-meta text-sub select-none ${highlighted ? "bg-surface-2" : ""}`}
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
      {supplementApplies && (
        <span
          className="text-amber-700 dark:text-amber-400 shrink-0"
          title="Nozomi/Mizuho aren't covered by a JR Pass outright — ridable with a separate supplement ticket"
        >
          extra fare applies
        </span>
      )}
      {endContent}
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
  /** Whether the traveler declared a JR Pass (issue #211/#212) — gates the "extra fare applies"
   * marker on a Nozomi/Mizuho shift row. The underlying fact is always on the Path; this is what
   * decides whether showing it makes sense to *this* trip. */
  hasJrPass: boolean;
  /** The walk/drive kind toggle (issue #217/#219), or `undefined` when this gap can't carry a
   * choice at all — a zero-length "same Location" gap (ADR-0036's checkin→end-anchor case, `hotel>
   * hotel` in `pathPairs.test.ts`) has no real Journey to choose a kind for, so the caller omits
   * this rather than `PathShiftRows` re-deriving `from.id === to.id` from information it isn't
   * otherwise given. Still gated on the chain not being rail-covered (`roadKindApplies`) even when
   * present. */
  kindToggle?: {
    /** This Journey's *effective* kind — an explicit choice if one is stored, else the Trip's
     * `roadProfile` default — resolved by the caller (`journeyRoadKindFor(...) ?? roadProfile`)
     * since only it holds both the Trip's `journeyRoadKinds` list and `roadProfile` itself.
     * Always a real kind, never `null` — the toggle highlights whichever is actually in effect. */
    kind: RoadProfile;
    /** Sets or clears this Journey's explicit choice (#217's API via the store). `null` clears,
     * returning the Journey to tracking the Trip default. */
    onKindChange: (kind: RoadProfile | null) => void;
  };
  /** `DayCard`'s list is a real `<ol>`; `MapView`'s `StopPanel` is plain `<div>`/`<button>` rows
   * with no list semantics at all — an `<li>` there would be invalid markup. Default `"li"`. */
  as?: "li" | "div";
}

/**
 * Renders one Location-to-Location gap. A chain long enough to be worth collapsing gets a
 * persistent header row (the collapse toggle, the kind toggle, and `trailing`); a short chain (1-2
 * shifts — the common plain walk/drive Journey) has no header at all, since there's nothing to
 * collapse — the kind toggle and `trailing` fold onto its last shift row instead (#219 follow-up),
 * so a plain Journey reads as the one row it visually is rather than an empty control row stacked
 * over its content. `chain`'s three states are exactly the three states a real drag/reorder
 * produces: not yet requested, requested and resolved-empty, or a real chain.
 */
export default function PathShiftRows({
  chain, tripId, pairKey, trailing, onStationClick, onHoverChange, highlightedPathId, hasJrPass,
  kindToggle, as = "li",
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
    return trailing ? <Row className="flex items-center justify-end py-1 pr-2.5">{trailing}</Row> : null;
  }

  if (chain === undefined) {
    return (
      <Row className="flex items-center gap-2 py-1 pl-5 pr-2.5">
        <span className="h-3.5 w-3.5 rounded-full bg-surface-2 animate-pulse shrink-0" />
        <span className="h-2.5 w-28 rounded bg-surface-2 animate-pulse" />
        <span className="flex-1" />
        {trailing}
      </Row>
    );
  }

  if (chain.length === 0) return trailing ? <Row className="flex items-center justify-end py-1 pr-2.5">{trailing}</Row> : null;

  // A long chain collapses behind a persistent header row with a re-openable toggle, since it
  // genuinely needs one — the chevron and the "N shifts" summary are real content the collapsed
  // state depends on. A short chain (1-2 shifts, the common plain walk/drive Journey) has nothing
  // to collapse, so it skips the header entirely rather than stacking a second, otherwise-empty row
  // above its own content just to hold the kind toggle and `trailing` (#219 follow-up) — those
  // fold onto the chain's last row instead via `ShiftRow`'s `endContent`. Expanding a long chain
  // never indents the revealed rows — it reveals more flat rows at the same list level, not a
  // hierarchy.
  const collapsible = chain.length > 2;
  const showRows = !collapsible || expanded;
  const kindControl = kindToggle && roadKindApplies(chain) ? <JourneyKindToggle {...kindToggle} /> : null;
  const mergedEnd =
    !collapsible && (kindControl || trailing) ? (
      <span className="flex items-center gap-1.5 shrink-0">
        {kindControl}
        {trailing}
      </span>
    ) : null;

  return (
    <>
      {collapsible && (
        <Row className="flex items-center gap-1 py-1 pr-2.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 pl-1 min-w-0 text-meta text-sub hover:text-ink rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {expanded
              ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-brand-500 dark:text-brand-400" />
              : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-brand-500 dark:text-brand-400" />}
            <span className="truncate">{summaryOf(chain)} <span className="text-faint">· {chain.length} shifts</span></span>
            {!expanded && chainHasSupplement(chain, hasJrPass) && (
              <span
                className="text-amber-700 dark:text-amber-400 shrink-0"
                title="Nozomi/Mizuho aren't covered by a JR Pass outright — ridable with a separate supplement ticket"
              >
                extra fare applies
              </span>
            )}
          </button>
          <span className="flex-1 min-w-2" />
          {kindControl}
          {trailing}
        </Row>
      )}
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
            supplementApplies={needsSupplementMarker(path, hasJrPass)}
            endContent={mergedEnd && i === chain.length - 1 ? mergedEnd : null}
            as={as}
          />
        );
      })}
    </>
  );
}
