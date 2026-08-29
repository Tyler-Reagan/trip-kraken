/**
 * The one rule for which Location bookends a Day (ADR-0028). Two call sites need it —
 * `deriveTripPlanDays` (`@/types`, projecting the stored Plan for the Timeline and Map) and
 * `buildSolverInputDays` (`@/lib/vroom/request`, building the solver's request input) — and they
 * are not merged, because one returns Locations for rendering and the other returns matrix
 * indices. This function is the seam that keeps them agreeing: each caller resolves its own
 * lodging/edge ids in its own idiom and hands them here, rather than reimplementing which one
 * wins.
 *
 * The edges are unique by construction (ADR-0028 §2) — at most one Location per Trip carries
 * `arriveAt`, one carries `departAt` — so there is no earliest/latest tie-break to get wrong, only
 * a question of which day the edge applies to.
 */
export function anchorsOnDate(input: {
  dayNumber: number;
  numDays: number;
  wokeLodgingId: string | null;
  sleepLodgingId: string | null;
  arrivalId: string | null;
  departureId: string | null;
}): { startId: string | null; endId: string | null } {
  const {
    dayNumber,
    numDays,
    wokeLodgingId,
    sleepLodgingId,
    arrivalId,
    departureId,
  } = input;

  // Day 1 starts at the arrival when one is designated — filling a slot that is otherwise always
  // empty, since no Lodging night covers "the night before day 1".
  const startId =
    dayNumber === 1 && arrivalId != null ? arrivalId : wokeLodgingId;

  // The last Day ends at the departure when one is designated. Otherwise, the pre-existing
  // travel-day condition: an end anchor only when the Lodging you sleep at differs from the one
  // you woke at (mid-trip nights when they match produce no end anchor at all).
  const travelled = sleepLodgingId != null && sleepLodgingId !== wokeLodgingId;
  const endId =
    dayNumber === numDays && departureId != null
      ? departureId
      : travelled
        ? sleepLodgingId
        : null;

  return { startId, endId };
}
