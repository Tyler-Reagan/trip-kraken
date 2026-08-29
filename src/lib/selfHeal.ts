/**
 * ADR-0026's self-heal, the pure half (#171): given the trip as it stood *before* an activity
 * Placement was removed, finds the one new pair its removal creates — the two neighbors it stood
 * between, now adjacent — or decides there is nothing to heal. The network half (the actual
 * `describeJourney` lookup) lives in the DELETE route, which is the one place this module's
 * output ever reaches a provider.
 *
 * `removePlacement` (`db/index.ts`) never renumbers `order` on the Placements it leaves behind
 * (ADR-0026 §1 — "the gap closes, no other Placement moves"), so a removed Placement's own
 * `date`/`order`, read *before* the delete, is the only way to find which two remaining Placements
 * it stood between. Reading it after would already be too late — the row is gone.
 */

import { isActivity, type TripWithDetails } from "@/types";
import { journeyRoadKindFor, withJourneyRoadKind } from "@/lib/pathPairs";
import type { PathEndpoint, PathKind } from "@/types/path";

export interface HealablePair {
  from: PathEndpoint & { locationId: string };
  to: PathEndpoint & { locationId: string };
  /** The removed Placement's own date — the healed lookup's representative day, same convention
   * `optimize.ts` uses (a single representative datetime per lookup, not per-Placement timing
   * that isn't persisted). */
  date: string;
}

/**
 * `null` covers every case ADR-0026 §4 puts out of self-heal's scope, in the order checked:
 * - the Placement wasn't found (already gone, or never existed)
 * - its Location isn't an activity (a lodging/transit Placement, if one ever existed — self-heal
 *   is activity-only; a lost lodging Anchor needs a re-run, not a local repair)
 * - it was first or last in its Day — the new neighbor is a projected Anchor, not a Placement, and
 *   an Anchor's position is a constraint-level fact, never a local edit
 * - either neighbor's Location has no coordinates yet — nothing to look a route up between
 */
export function findHealablePair(
  before: TripWithDetails,
  removedPlacementId: string,
): HealablePair | null {
  const removed = before.placements.find((p) => p.id === removedPlacementId);
  if (!removed) return null;

  const removedLocation = before.locations.find(
    (l) => l.id === removed.locationId,
  );
  if (!removedLocation || !isActivity(removedLocation)) return null;

  const sameDay = before.placements.filter(
    (p) => p.date === removed.date && p.id !== removed.id,
  );
  const predecessor = sameDay
    .filter((p) => p.order < removed.order)
    .sort((a, b) => b.order - a.order)[0];
  const successor = sameDay
    .filter((p) => p.order > removed.order)
    .sort((a, b) => a.order - b.order)[0];
  if (!predecessor || !successor) return null;

  const fromLoc = before.locations.find((l) => l.id === predecessor.locationId);
  const toLoc = before.locations.find((l) => l.id === successor.locationId);
  if (!fromLoc || fromLoc.lat == null || fromLoc.lng == null) return null;
  if (!toLoc || toLoc.lat == null || toLoc.lng == null) return null;

  return {
    from: { lat: fromLoc.lat, lng: fromLoc.lng, locationId: fromLoc.id },
    to: { lat: toLoc.lat, lng: toLoc.lng, locationId: toLoc.id },
    date: removed.date,
  };
}

/** The same road-kind selection `optimize.ts` uses for a full solve (ADR-0024 §3) — a healed
 * pair's cost is answered by the same registry rows a re-optimize would use for that Trip, not a
 * separate rule that could disagree with it. Also honors this Journey's chosen road kind (#223),
 * the same substitution `path-geometry`'s route applies to its own base list — a removal that
 * heals a Journey with a chosen kind must not silently report the Trip-default kind's cost instead. */
export function healKinds(
  trip: TripWithDetails,
  locationIdA: string,
  locationIdB: string,
): PathKind[] {
  const chosen = journeyRoadKindFor(
    trip.journeyRoadKinds,
    locationIdA,
    locationIdB,
  );
  return withJourneyRoadKind(["rail", "bus", trip.roadProfile], chosen);
}
