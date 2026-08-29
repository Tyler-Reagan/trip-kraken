/**
 * ADR-0023 §7 — what we decide *before* asking VROOM anything. Three reasons, computed ourselves
 * with more specificity than VROOM could ever give a dropped stop: not yet geocoded (split into
 * `pending`/`failed` per #152), no lodging covers this area (ADR-0020's coverage detector,
 * unchanged), and closed on every Trip date.
 *
 * Per the 2026-08-12 amendment, a Location we can't place must be removed from the matrix, not
 * merely withheld from `jobs` — leaving it in the matrix would ask every registry provider,
 * including metered ones, to answer for a cell whose Location was never going anywhere. This
 * module's `placeable` output is exactly the survivor set `solver.ts` hands to `buildTravelMatrix`.
 *
 * Pure domain module — no VROOM vocabulary here (see `wire.ts`'s docblock for why "excluded" and
 * "stop" are avoided in favour of `Unplaced`/`Activity`/`Placement`).
 */

import type { IsoDate } from "@/types";
import { hasValidCoords } from "@/lib/geo";
import { clusterByMetro } from "@/lib/metroCluster";
import { dayWindowsFor } from "@/lib/vroom/timeWindows";
import type { LocationInput, Unplaced } from "@/lib/solver";

export interface PreflightResult {
  /** Survivors — these plus the geocoded lodgings are the matrix points `solver.ts` builds. */
  placeable: LocationInput[];
  unplaced: Unplaced[];
  /** Non-fatal conditions that don't disqualify any one Activity — e.g. a lodging still
   * enrichment-pending, so its Day has no anchor (#152). */
  warnings: string[];
  /** Every placeable Activity's metro-cluster ordinal, when metro clustering is active at all
   * (some lodging is geocoded). Absent from the map entirely when clustering never ran. */
  metroOf: Map<string, number>;
  /** Every geocoded lodging's covering metro ordinals — a lodging can cover more than one metro
   * cluster (two nearby-but-distinct destinations both within radius). `request.ts` unions this
   * per Day to derive `reachableMetros`. */
  lodgingMetros: Map<string, number[]>;
}

export function preflight(
  activities: LocationInput[],
  lodgings: LocationInput[],
  tripDates: IsoDate[],
  edges?: { arrival?: LocationInput; departure?: LocationInput },
): PreflightResult {
  const unplaced: Unplaced[] = [];
  const warnings: string[] = [];

  // Reason: not yet geocoded (#152's pending/failed split). Select the *reason* on enrichment
  // status; select the *exclusion itself* on coordinates — applyEnrichment never nulls a field,
  // and a "failed" row can still carry the imported pin's own valid coordinates
  // (findPlaceFromText's bias-radius rejection marks a row failed specifically to leave those
  // standing), so `failed` alone must never drop a perfectly routable row.
  const geocoded: LocationInput[] = [];
  for (const a of activities) {
    if (hasValidCoords(a)) {
      geocoded.push(a);
      continue;
    }
    if (a.enrichmentStatus === "failed") {
      unplaced.push({
        locationId: a.id,
        code: "ungeocoded-failed",
        reason:
          "We couldn't find this place. Fix the name or set its location.",
      });
    } else {
      unplaced.push({
        locationId: a.id,
        code: "ungeocoded-pending",
        reason:
          "Still looking this place up — try optimizing again in a moment.",
      });
    }
  }

  // A pending lodging is a missing Day Anchor, not just a missing candidate — #152's decided
  // answer is to warn, not block: optimize still runs, the Day falls back to no anchor.
  for (const l of lodgings) {
    if (!hasValidCoords(l) && l.enrichmentStatus === "pending") {
      warnings.push(
        `"${l.id}" is still being looked up — its days will have no anchor until it's found.`,
      );
    }
  }

  // An ungeocoded trip-edge Transit Location is the same shape of missing Anchor, one Day narrower
  // (ADR-0028 §4) — the identical "warn, don't block" answer #152 already settled for lodging:
  // optimize still runs, that Day falls back to its Lodging Anchor instead.
  //
  // Selected on coordinates alone, not gated to enrichmentStatus === "pending" the way #152's
  // lodging warning is: every write path that leaves a Location "pending" already carries valid
  // coordinates (Add Location and the My Maps import both supply lat/lng up front), so a
  // coordinate-less edge is reachable only at status "done" (never enrichable — no placeId, no
  // coordinates) or "failed". Gating on "pending" left this warning dead code — a real ungeocoded
  // edge fell back silently, with nothing to tell the user why.
  if (edges?.arrival && !hasValidCoords(edges.arrival)) {
    warnings.push(
      `"${edges.arrival.id}" has no coordinates — day 1 will start from lodging instead.`,
    );
  }
  if (edges?.departure && !hasValidCoords(edges.departure)) {
    warnings.push(
      `"${edges.departure.id}" has no coordinates — the last day will end at lodging instead.`,
    );
  }

  // Reason: no lodging covers this area of the trip (ADR-0020's coverage detector, unchanged). No
  // geocoded lodging at all skips metro logic entirely (the guard optimizer.ts:201 used to carry):
  // a trip with no geocoded lodging leaves every day eligible for everyone, today's behaviour.
  const geocodedLodgings = lodgings.filter(hasValidCoords);
  const metroOf = new Map<string, number>();
  const lodgingMetros = new Map<string, number[]>();
  let afterCoverage: LocationInput[] = geocoded;

  if (geocodedLodgings.length > 0) {
    const metros = clusterByMetro(geocoded, geocodedLodgings);
    const covered: LocationInput[] = [];
    metros.forEach((metro, ordinal) => {
      for (const l of metro.lodgings) {
        const ordinals = lodgingMetros.get(l.id) ?? [];
        ordinals.push(ordinal);
        lodgingMetros.set(l.id, ordinals);
      }
      if (metro.lodgings.length === 0) {
        for (const a of metro.activities) {
          unplaced.push({
            locationId: a.id,
            code: "no-lodging-coverage",
            reason: "No lodging covers this area of the trip.",
          });
        }
        return;
      }
      for (const a of metro.activities) {
        metroOf.set(a.id, ordinal);
        covered.push(a);
      }
    });
    afterCoverage = covered;
  }

  // Reason: closed on every trip date.
  const placeable: LocationInput[] = [];
  for (const a of afterCoverage) {
    const windows = dayWindowsFor(a, tripDates);
    if (windows !== null && windows.length === 0) {
      unplaced.push({
        locationId: a.id,
        code: "closed-all-days",
        reason: "Closed on every day of the trip.",
      });
      continue;
    }
    placeable.push(a);
  }

  return { placeable, unplaced, warnings, metroOf, lodgingMetros };
}
