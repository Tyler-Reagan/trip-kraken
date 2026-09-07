// Ported from `src/lib/anchors.ts`. The one rule for which Location bookends a Day (ADR-0028). Two
// call sites need it in the TS original — projecting the stored Plan for the Timeline/Map, and
// building the solver's request input — and they are not merged, because one returns Locations for
// rendering and the other returns matrix indices. This function is the seam that keeps them
// agreeing: each caller resolves its own lodging/edge ids in its own idiom and hands them here,
// rather than reimplementing which one wins.
//
// The edges are unique by construction (ADR-0028 §2) — at most one Location per Trip carries
// `arriveAt`, one carries `departAt` — so there is no earliest/latest tie-break to get wrong, only a
// question of which day the edge applies to.

/// How an Anchor row is labeled for display. One wording for the same fact regardless of which
/// screen renders it: a Lodging you woke at or return to overnight, or the Trip's designated
/// arrival/departure edge (ADR-0028) reads by whichever of the two it is, never both.
public enum AnchorRole: Sendable, Hashable {
    case start, checkin, end
}

public func anchorSubtext(role: AnchorRole, location: Location) -> String {
    if role == .checkin { return "Check-in · drop bags" }
    let isEdge = location.asTransit != nil
    if role == .start { return isEdge ? "Arrive" : "Start of day" }
    return isEdge ? "Depart" : "Overnight"
}

public func anchorsOnDate(
    dayNumber: Int, numDays: Int, wokeLodgingId: String?, sleepLodgingId: String?,
    arrivalId: String?, departureId: String?
) -> (startId: String?, endId: String?) {
    // Day 1 starts at the arrival when one is designated — filling a slot that is otherwise always
    // empty, since no Lodging night covers "the night before day 1".
    let startId = (dayNumber == 1 && arrivalId != nil) ? arrivalId : wokeLodgingId

    // The last Day ends at the departure when one is designated. Otherwise, the pre-existing
    // travel-day condition: an end anchor only when the Lodging you sleep at differs from the one
    // you woke at (mid-trip nights when they match produce no end anchor at all).
    let travelled = sleepLodgingId != nil && sleepLodgingId != wokeLodgingId
    let endId: String? =
        (dayNumber == numDays && departureId != nil) ? departureId : (travelled ? sleepLodgingId : nil)

    return (startId, endId)
}
