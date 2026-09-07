/// Shared metro-scale clustering — geo-groups a trip's activity Locations into distinct metro
/// clusters and matches each to every covering lodging within a metro-scale radius. One detector
/// locks the optimizer's coverage check, the post-import wizard's per-metro prompts, and the map's
/// metro tabs onto the same result, so no second heuristic re-derives this.
///
/// Single-linkage clustering by radius, not k-means: there is no known cluster count in advance,
/// and a metro's stops should merge as one group regardless of how many there are.
///
/// Generic over the point shape, not pinned to `Activity`/`Lodging`, so this stays testable with
/// plain fixtures the way `metroCluster.test.ts` exercises it — mirroring the TS original's own
/// generic parameterization, kept here even though this Swift codebase (ADR-0038) has only the one
/// real caller shape so far.

/// Anything that may or may not have real coordinates yet.
public protocol Geocodable {
    var lat: Double? { get }
    var lng: Double? { get }
}

extension Activity: Geocodable {
    public var lat: Double? { base.lat }
    public var lng: Double? { base.lng }
}

extension Lodging: Geocodable {
    public var lat: Double? { base.lat }
    public var lng: Double? { base.lng }
}

/// Distance below which two locations count as the same metro rather than distinct destinations.
/// Wide enough to span one metro's spread (central city to its suburbs) but well under the gap
/// between actually-distant destinations (Osaka↔Tokyo, ~400km). Single source of truth: no caller
/// defines its own threshold.
public let metroClusterRadiusMeters = 75_000.0

public struct MetroCluster<A: Geocodable, L: Geocodable> {
    /// May be **empty**: a lodging covering no activity-founded metro founds its own (ADR-0020,
    /// amended 2026-08-17), and a metro you sleep in with nothing planned yet has no activities at
    /// all. Consumers must not assume `activities.first` exists.
    public var activities: [A]
    public var centroid: Point
    /// Every lodging within `metroClusterRadiusMeters` of the centroid — a metro can have more than
    /// one covering lodging (e.g. a mid-stay hotel change), so this is never collapsed to "the"
    /// lodging. Empty when no lodging in the trip reaches it.
    public var lodgings: [L]
}

private func pointOf<T: Geocodable>(_ item: T) -> Point? {
    guard let lat = item.lat, let lng = item.lng else { return nil }
    let p = Point(lat: lat, lng: lng)
    return p.hasValidCoords ? p : nil
}

private func centroidOf(_ points: [Point]) -> Point {
    precondition(!points.isEmpty)
    return Point(
        lat: points.reduce(0) { $0 + $1.lat } / Double(points.count),
        lng: points.reduce(0) { $0 + $1.lng } / Double(points.count)
    )
}

private struct Placed<T> {
    var item: T
    var point: Point
}

private func placed<T: Geocodable>(_ items: [T]) -> [Placed<T>] {
    items.compactMap { item in pointOf(item).map { Placed(item: item, point: $0) } }
}

/// Single-linkage grouping at `metroClusterRadiusMeters` — one member within the radius pulls the
/// whole group in, so a metro's spread merges regardless of how many members it has. Shared by both
/// founding passes below so they can't drift into two thresholds.
private func groupByProximity<T>(_ items: [Placed<T>]) -> [[Placed<T>]] {
    var remaining = items
    var groups: [[Placed<T>]] = []

    while !remaining.isEmpty {
        var bucket = [remaining.removeFirst()]
        var grew = true
        while grew {
            grew = false
            for i in stride(from: remaining.count - 1, through: 0, by: -1) {
                if bucket.contains(where: { haversineMeters($0.point, remaining[i].point) <= metroClusterRadiusMeters }) {
                    bucket.append(remaining.remove(at: i))
                    grew = true
                }
            }
        }
        groups.append(bucket)
    }

    return groups
}

/// Groups a trip's Locations into metros (ADR-0020, amended 2026-08-17). Locations without real
/// coordinates (not yet geocoded) are dropped — they carry no geography to group on.
///
/// Two founding passes, in this order, and the order is the point:
///
/// 1. **Activities found metros**, each matched to every lodging within the radius of its
///    centroid — a metro can have several (a mid-stay hotel change), so this is never collapsed to
///    "the" lodging.
/// 2. **A lodging covering none of them founds its own**, merging with other such lodgings. A place
///    you sleep is a destination whether or not anything is planned there yet.
///
/// Running the second pass over what the first one left, rather than seeding one pass with both
/// kinds, is what keeps it safe: a lodging sitting between two activity groups would **bridge**
/// them into a single metro under single-linkage. Pass 2 cannot bridge, because the groups it might
/// have bridged are closed.
///
/// TS tracks "already covered" lodgings by object-reference identity, which Swift's value-type
/// structs don't have; this tracks the same set by index into `validLodgings` instead.
public func clusterByMetro<A: Geocodable, L: Geocodable>(
    activities: [A], lodgings: [L]
) -> [MetroCluster<A, L>] {
    let validLodgings = Array(placed(lodgings).enumerated())

    typealias ActivityFounded = (activities: [A], centroid: Point, lodgingIndices: [Int])

    let activityFounded: [ActivityFounded] = groupByProximity(placed(activities)).map { group in
        let centroid = centroidOf(group.map(\.point))
        let matched = validLodgings.filter { haversineMeters($0.element.point, centroid) <= metroClusterRadiusMeters }
        return (activities: group.map(\.item), centroid: centroid, lodgingIndices: matched.map(\.offset))
    }

    let coveredIndices = Set(activityFounded.flatMap(\.lodgingIndices))
    let uncoveredLodgings = validLodgings
        .filter { !coveredIndices.contains($0.offset) }
        .map(\.element)

    let lodgingFounded: [MetroCluster<A, L>] = groupByProximity(uncoveredLodgings).map { group in
        MetroCluster(activities: [], centroid: centroidOf(group.map(\.point)), lodgings: group.map(\.item))
    }

    // Activity-founded first, so an existing trip's ordinals don't shift when a lodging-founded
    // metro appears — callers use the index as a stable ordinal.
    let activityClusters = activityFounded.map { founded in
        MetroCluster<A, L>(
            activities: founded.activities, centroid: founded.centroid,
            lodgings: founded.lodgingIndices.map { validLodgings[$0].element.item }
        )
    }
    return activityClusters + lodgingFounded
}
