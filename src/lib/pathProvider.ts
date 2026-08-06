/**
 * The path provider (ADR-0004, renamed by ADR-0022): every "how far / how long between two
 * places" query the optimizer's sequencing phase makes routes through this interface, so a real
 * routing API can replace the default straight-line math later without touching any caller. Named
 * for what it produces — a Path — not for the cost field that used to be its whole shape.
 *
 * Async, deliberately: a real provider is inherently a network call. Building this synchronous now
 * would force a breaking rework of every caller exactly when it matters most — when a real provider
 * actually gets added (O1-O3 grill, docs/optimizer-rebuild.md, 2026-07-06).
 *
 * NOT used by the optimizer's clustering step (kMeans/seedCentroids in optimizer.ts) — a clustering
 * centroid is a synthetic averaged point, not a real place, so "how do I travel to this made-up
 * point" isn't a meaningful provider query. Clustering stays on its own local distance math.
 *
 * `kinds` (ADR-0022 P2) is a **willingness set**, not a constraint (ADR-0022, revised) — the
 * orchestrator (`optimize.ts`) threads a Trip's whole `allowedPathKinds` through, unresolved, and
 * each provider decides for itself how to spend it: a provider limited to one query per request
 * (Google's matrix takes exactly one `travelMode`) picks its own single kind by a documented
 * precedence; a provider with only one kind to offer (OSM-Japan) ignores the set entirely.
 */

import { type Path, type PathEndpoint, type PathKind, type TravelCost, makeTravelCost } from "@/types/path";
import { haversineMeters, type Point } from "@/lib/geo";

export interface PathProviderOptions {
  /** Representative departure datetime (ADR-0018) — timetables are calendar-dependent, so a real
   * transit provider needs a date, not just a time-of-day. One matrix is fetched per optimize run
   * at one representative datetime; providers that don't model time-of-day (haversine) ignore it. */
  departureTime?: Date;
}

export interface PathProvider {
  /** Fetch every pairwise cost in one round trip (ADR-0004), for sequencing's inner loops. */
  costMatrix(points: Point[], kinds: PathKind[], opts?: PathProviderOptions): Promise<TravelCost[][]>;
  /** One A-to-B journey as its constituent Paths (ADR-0021, ADR-0022) — for the final plan's
   * display only; called lazily at display time, never inside sequencing's construction/refinement
   * loops. Every provider currently returns a single-element array (decomposition unimplemented,
   * P1 of the ADR-0022 refactor); a straight-line fallback is always exactly one `UnknownPath`. */
  describeJourney(from: PathEndpoint, to: PathEndpoint, kinds: PathKind[], opts?: PathProviderOptions): Promise<Path[]>;
}

// Average city travel speed for estimating durations (20 km/h) — unchanged from the pre-O2 constant.
const AVG_SPEED_M_PER_S = (20 * 1000) / 3600;

function haversineCost(from: Point, to: Point): TravelCost {
  const distanceMeters = haversineMeters(from, to);
  return makeTravelCost(distanceMeters, distanceMeters / AVG_SPEED_M_PER_S, "straightLine");
}

/**
 * Default provider (ADR-0004): straight-line distance + one fixed speed — the same numbers the
 * pre-O2 optimizer produced. `mode` is accepted (interface contract) but ignored here; giving each
 * mode its own speed is a real quality change (category A, docs/optimizer-rebuild.md), deliberately
 * not bundled into this slice. `describeJourney` always returns a single `UnknownPath`: no route
 * was computed, so there is no honest kind to report (ADR-0022).
 */
export const haversineProvider: PathProvider = {
  async costMatrix(points) {
    return points.map((p) => points.map((q) => haversineCost(p, q)));
  },
  async describeJourney(from, to) {
    return [{ from, to, travelCost: haversineCost(from, to) }];
  },
};
