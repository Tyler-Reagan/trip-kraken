/// The detector for: does a trip's included Activities span 2+ metro-scale clusters the lodging
/// timeline doesn't already explain? Reuses `clusterByMetro` — the same detector the optimizer's
/// own pre-flight coverage check and the map's metro tabs use — rather than a second,
/// independently-tuned heuristic.
///
/// "Pre-optimize" means before any Day exists to read stops from, so this clusters over every
/// included Location directly. `metrosOf` (`TripMetros.swift`) clusters over the *placed* stops
/// instead — the right tool for map/day navigation, empty and useless before a first optimize,
/// which is exactly when this warning needs to fire.

public struct UncoveredMetro: Sendable, Hashable {
    public var label: String
    public var activityCount: Int

    public init(label: String, activityCount: Int) {
        self.label = label
        self.activityCount = activityCount
    }
}

/// Nil when there's nothing to say: fewer than 2 clusters (ordinary single-metro spread, however
/// wide), or every cluster already has a covering lodging — a deliberate multi-city trip with a
/// hotel booked in each city is not a problem, and warning about it would be noise.
public func detectUncoveredSplit(_ trip: TripWithDetails) -> [UncoveredMetro]? {
    let activities = trip.locations.compactMap(\.asActivity).filter { !$0.base.excluded }
    let lodgings = trip.locations.compactMap(\.asLodging)
    let clusters = clusterByMetro(activities: activities, lodgings: lodgings)
    guard clusters.count >= 2 else { return nil }

    let uncovered = clusters.filter { $0.lodgings.isEmpty }
    guard !uncovered.isEmpty else { return nil }

    return uncovered.map { UncoveredMetro(label: metroLabel(activities: $0.activities, lodgings: $0.lodgings), activityCount: $0.activities.count) }
}
