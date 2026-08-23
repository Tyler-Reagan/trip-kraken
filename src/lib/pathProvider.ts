/**
 * The path provider (ADR-0004, renamed by ADR-0022): every "how far / how long between two
 * places" query routes through this interface, so a real routing API can stand in for the default
 * straight-line math without touching any caller. Named for what it produces — a Path — not for
 * the cost field that used to be its whole shape. Each row of the provider registry
 * (`travelCostRegistry.ts`, ADR-0024) implements this; `buildTravelMatrix` is what the VROOM
 * request builder (`src/lib/vroom/request.ts`, ADR-0023) actually calls, never a `PathProvider`
 * directly — sequencing itself is VROOM's, not application code walking this interface in a loop.
 *
 * Async, deliberately: a real provider is inherently a network call. Building this synchronous
 * would force a breaking rework of every caller the moment a real provider needs it.
 *
 * `kinds` (ADR-0022 P2, revised by ADR-0024 §3) is a **static declaration of competence**, not a
 * traveler's willingness set — that concept is deleted. `buildTravelMatrix`
 * (`travelCostRegistry.ts`) intersects a request's kinds against each registry entry's declared
 * `kinds` before calling it, so a provider only ever sees kinds it claimed it can answer for; a
 * provider never has to infer or collapse a set it didn't ask for.
 */

import { type Path, type PathEndpoint, type PathKind, type TravelCost, makeTravelCost } from "@/types/path";
import { haversineMeters, type Point } from "@/lib/geo";

export interface PathProviderOptions {
  /** Representative departure datetime (ADR-0018) — timetables are calendar-dependent, so a real
   * transit provider needs a date, not just a time-of-day. One matrix is fetched per optimize run
   * at one representative datetime; providers that don't model time-of-day (haversine) ignore it. */
  departureTime?: Date;
  /** Whether the traveler holds a Japan Rail Pass (issue #211) — a graph-search constraint the
   * OSM-Japan provider alone acts on; every other provider ignores it, the same as
   * `departureTime` above. */
  hasJrPass?: boolean;
}

/** A provider's answer for one matrix cell, or `null` — an explicit decline (ADR-0024 §4). `null`
 * rather than `undefined`: `undefined` is what an unfilled array slot already is before anything
 * has run, so the composer needs a distinct value to say "this provider looked and declined." */
export type MatrixCell = TravelCost | null;

export interface PathProvider {
  /** Fetch every pairwise cost in one round trip (ADR-0004), for sequencing's inner loops. Any
   * cell may be `null` — the provider declining that specific pair, not an error. */
  costMatrix(points: Point[], kinds: PathKind[], opts?: PathProviderOptions): Promise<MatrixCell[][]>;
  /** One A-to-B journey as its constituent Paths (ADR-0021, ADR-0022) — for the final plan's
   * display only; called lazily at display time, never inside sequencing's construction/refinement
   * loops. `null` is a decline, the same as a `MatrixCell`. Every provider currently returns a
   * single-element array when it does answer (decomposition unimplemented, P1 of the ADR-0022
   * refactor). */
  describeJourney(from: PathEndpoint, to: PathEndpoint, kinds: PathKind[], opts?: PathProviderOptions): Promise<Path[] | null>;
}

// Average city travel speed for estimating durations (20 km/h) — unchanged from the pre-O2 constant.
const AVG_SPEED_M_PER_S = (20 * 1000) / 3600;

function haversineCost(from: Point, to: Point): TravelCost {
  const distanceMeters = haversineMeters(from, to);
  return makeTravelCost(distanceMeters, distanceMeters / AVG_SPEED_M_PER_S, "straightLine", "haversine");
}

/**
 * Default provider (ADR-0004): straight-line distance + one fixed speed — the same numbers the
 * pre-O2 optimizer produced. `mode` is accepted (interface contract) but ignored here; giving each
 * mode its own speed is a real quality change, deliberately not bundled into this slice (and still
 * not: #162 tracks the same gap under ADR-0023's VROOM swap — a straight-line fallback cell is
 * cheaper than the routes it replaces, so the optimizer is actively attracted to degraded pairs).
 * `describeJourney` always returns a single `UnknownPath`: no route
 * was computed, so there is no honest kind to report (ADR-0022). This is the registry's terminal
 * entry (ADR-0024 §4) — it never declines, which is what the composer relies on to guarantee
 * completion.
 */
export const haversineProvider: PathProvider = {
  async costMatrix(points) {
    return points.map((p) => points.map((q) => haversineCost(p, q)));
  },
  async describeJourney(from, to) {
    return [{ from, to, travelCost: haversineCost(from, to) }];
  },
};
