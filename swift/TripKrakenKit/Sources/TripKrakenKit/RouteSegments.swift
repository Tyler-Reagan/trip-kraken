import Foundation

// The map's *decisions*, not its drawing (ADR-0039 keeps drawing itself out of this pure module).
// Ports `MapView.tsx`'s route-building loop (`:340-420`) and its bounds-fitting inputs
// (`pointsOfDay`, `:149-157`) minus every MapLibre-specific concern.

/// Shortest stretch between two of a Path's spans still worth drawing dashed (ADR-0030 §9). Sized
/// to absorb a router's snap offset (OSRM snaps under ~35 m) and nothing else — a real missing
/// stretch (an untraced ride edge) is a whole inter-station hop, far larger in scale.
public let gapMinMeters = 50.0

/// One drawable line. `dashed` is provenance, never emphasis (ADR-0029 §3): a dashed segment is a
/// stretch that was not routed, at every length.
public struct RouteSegment: Sendable, Hashable {
    public var coordinates: [Point]
    public var dashed: Bool
    public var dayNumber: Int
    /// `pathShiftId` identity — nil for a whole-pair straight line with no Path behind it.
    public var pathId: String?

    public init(coordinates: [Point], dashed: Bool, dayNumber: Int, pathId: String?) {
        self.coordinates = coordinates
        self.dashed = dashed
        self.dayNumber = dayNumber
        self.pathId = pathId
    }
}

private func point(_ endpoint: PathEndpoint) -> Point {
    Point(lat: endpoint.lat, lng: endpoint.lng)
}

/// GeoJSON coordinate order is `[lng, lat]`.
private func point(_ coordinate: [Double]) -> Point {
    Point(lat: coordinate[1], lng: coordinate[0])
}

private func endpoint(_ coordinate: [Double]) -> PathEndpoint {
    PathEndpoint(lat: coordinate[1], lng: coordinate[0])
}

/// Port of `MapView.tsx`'s route-building loop (`:340-420`). `geometry` is keyed by `pairKey`; a
/// key that is absent *or* maps to an empty array draws one dashed straight line for the whole
/// pair — the renderer does not need the answered-vs-unanswered distinction, only a fetcher does.
/// Spans are never bridged with invented lines: each real span is drawn solid, and every stretch
/// between spans (or between a Path's declared endpoint and its nearest span) is its own dashed
/// gap, suppressed under `gapMinMeters`.
public func routeSegmentsOfDay(
    _ day: DerivedDay, profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind],
    geometry: [String: [Path]]
) -> [RouteSegment] {
    var segments: [RouteSegment] = []

    func drawStraight(_ from: PathEndpoint, _ to: PathEndpoint, pathId: String?) {
        segments.append(
            RouteSegment(coordinates: [point(from), point(to)], dashed: true, dayNumber: day.dayNumber, pathId: pathId)
        )
    }

    func drawGap(_ from: PathEndpoint, _ to: PathEndpoint, pathId: String?) {
        guard haversineMeters(point(from), point(to)) >= gapMinMeters else { return }
        drawStraight(from, to, pathId: pathId)
    }

    for pair in pairsOfDay(day) {
        let key = pairKey(profile: profile, pair: pair, journeyRoadKinds: journeyRoadKinds)
        let paths = geometry[key] ?? []

        guard !paths.isEmpty else {
            drawStraight(pair.from, pair.to, pathId: nil)
            continue
        }

        for (index, path) in paths.enumerated() {
            let pathId = pathShiftId(key, index: index)
            let spans = path.base.geometry ?? []
            guard !spans.isEmpty else {
                drawGap(path.base.from, path.base.to, pathId: pathId)
                continue
            }

            var cursor = path.base.from
            for span in spans {
                guard let first = span.coordinates.first, let last = span.coordinates.last else { continue }
                drawGap(cursor, endpoint(first), pathId: pathId)
                segments.append(
                    RouteSegment(coordinates: span.coordinates.map(point), dashed: false, dayNumber: day.dayNumber, pathId: pathId)
                )
                cursor = endpoint(last)
            }
            drawGap(cursor, path.base.to, pathId: pathId)
        }
    }

    return segments
}

// MARK: - Bounds

// `LocationBase` already carries the two optional coordinate fields `Geocodable` asks for, so it
// can feed the existing `boundsOf` directly rather than needing a parallel implementation.
extension LocationBase: Geocodable {}

/// Every point one Day actually draws: its stops plus its two Anchors. `checkInWaypoint` is
/// deliberately excluded, matching `pointsOfDay` (`MapView.tsx:149-157`) — a bag-drop waypoint
/// doesn't widen the Day's camera extent.
public func boundsOfDay(_ day: DerivedDay) -> Bounds? {
    boundsOf(pointsOfDay(day))
}

public func boundsOfDays(_ days: [DerivedDay]) -> Bounds? {
    boundsOf(days.flatMap(pointsOfDay))
}

private func pointsOfDay(_ day: DerivedDay) -> [LocationBase] {
    var bases = day.stops.map(\.location.base)
    if let start = day.startAnchor { bases.append(start.base) }
    if let end = day.endAnchor { bases.append(end.base) }
    return bases
}

// MARK: - Emphasis

/// How loudly a Day draws, relative to whichever Day is active and whichever Metro is browsed.
/// Port of `alphaFor` (`MapView.tsx:281-286`): the active Day always wins; a sibling Day sharing the
/// browsed Metro is toned down but still visible; everything else recedes furthest. What a tier
/// actually looks like (opacity values) is the app's business, not this module's — this only names
/// the three states a rendering surface picks from.
public enum EmphasisTier: Sendable, Hashable {
    case active, metro, rest
}

public func emphasisTier(dayNumber: Int, activeDayNumber: Int?, browsedDayNumbers: Set<Int>) -> EmphasisTier {
    if dayNumber == activeDayNumber { return .active }
    if browsedDayNumbers.contains(dayNumber) { return .metro }
    return .rest
}
