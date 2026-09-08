import Testing
import TripKrakenKit

// All fixture coordinates sit on the equator (lat 0) so haversine distance reduces to
// `lngDelta * 111_320` meters, keeping the gap-threshold math easy to verify by hand.

private func endpointAt(_ lng: Double, id: String? = nil) -> PathEndpoint {
    PathEndpoint(lat: 0, lng: lng, locationId: id)
}

private func span(_ startLng: Double, _ endLng: Double) -> PathGeometry {
    PathGeometry(coordinates: [[startLng, 0], [endLng, 0]])
}

private func walkingPath(from: PathEndpoint, to: PathEndpoint, geometry: [PathGeometry]?) -> Path {
    let cost = TravelCost(distanceMeters: 1, durationSeconds: 1, basisOfCost: .routingService, answeredBy: .osrm)
    return .walking(WalkingPath(base: PathBase(from: from, to: to, travelCost: cost, geometry: geometry)))
}

private func activityAt(_ id: String, _ lng: Double) -> Activity {
    var base = makeBase(id: id)
    base.lat = 0
    base.lng = lng
    return Activity(base: base)
}

private func stop(_ activity: Activity, order: Int) -> ScheduledStop {
    ScheduledStop(
        placement: Placement(id: "p-\(activity.base.id)", tripId: "t1", locationId: activity.base.id, date: "2026-09-01", order: order),
        location: activity
    )
}

private func twoStopDay(fromLng: Double = 0, toLng: Double = 0.01) -> DerivedDay {
    let a = stop(activityAt("a", fromLng), order: 0)
    let b = stop(activityAt("b", toLng), order: 1)
    return DerivedDay(date: "2026-09-01", dayNumber: 3, label: nil, stops: [a, b], startAnchor: nil, endAnchor: nil, checkInWaypoint: nil)
}

@Suite("routeSegmentsOfDay")
struct RouteSegmentsOfDayTests {
    @Test("no held geometry draws one dashed straight line per pair, with no pathId")
    func noHeldGeometry() {
        let segments = routeSegmentsOfDay(twoStopDay(), profile: .walking, journeyRoadKinds: [], geometry: [:])
        #expect(segments.count == 1)
        #expect(segments[0].dashed)
        #expect(segments[0].pathId == nil)
        #expect(segments[0].dayNumber == 3)
    }

    @Test("a real span far from both endpoints draws gap, span, gap")
    func gapSpanGap() {
        let day = twoStopDay(fromLng: 0, toLng: 0.01)
        let pair = pairsOfDay(day)[0]
        let key = pairKey(profile: .walking, pair: pair, journeyRoadKinds: [])
        // Span sits well inside [0, 0.01] — ~333m from each endpoint, comfortably over the 50m floor.
        let path = walkingPath(from: pair.from, to: pair.to, geometry: [span(0.003, 0.006)])

        let segments = routeSegmentsOfDay(day, profile: .walking, journeyRoadKinds: [], geometry: [key: [path]])

        #expect(segments.map(\.dashed) == [true, false, true], "leading gap, real span, trailing gap")
        #expect(segments.allSatisfy { $0.pathId == pathShiftId(key, index: 0) }, "every piece of one Path shares its shift id")
    }

    @Test("a sub-50m gap is not emitted")
    func subThresholdGapSuppressed() {
        let day = twoStopDay(fromLng: 0, toLng: 0.01)
        let pair = pairsOfDay(day)[0]
        let key = pairKey(profile: .walking, pair: pair, journeyRoadKinds: [])
        // Span starts/ends ~11m from each endpoint (0.0001 deg) — under the router-snap floor.
        let path = walkingPath(from: pair.from, to: pair.to, geometry: [span(0.0001, 0.0099)])

        let segments = routeSegmentsOfDay(day, profile: .walking, journeyRoadKinds: [], geometry: [key: [path]])

        #expect(segments.map(\.dashed) == [false], "both gaps are under threshold; only the span itself draws")
    }

    @Test("two spans draw gap, span, gap, span, gap — spans are never bridged")
    func twoSpansNeverBridged() {
        let day = twoStopDay(fromLng: 0, toLng: 0.02)
        let pair = pairsOfDay(day)[0]
        let key = pairKey(profile: .walking, pair: pair, journeyRoadKinds: [])
        let path = walkingPath(from: pair.from, to: pair.to, geometry: [span(0.003, 0.006), span(0.014, 0.017)])

        let segments = routeSegmentsOfDay(day, profile: .walking, journeyRoadKinds: [], geometry: [key: [path]])

        #expect(
            segments.map(\.dashed) == [true, false, true, false, true],
            "the property that breaks if the span walk is ever \"simplified\" into one bridged line"
        )
    }

    @Test("a Path with no spans at all emits at most one gap for its whole length")
    func noSpansAtAll() {
        let day = twoStopDay(fromLng: 0, toLng: 0.01)
        let pair = pairsOfDay(day)[0]
        let key = pairKey(profile: .walking, pair: pair, journeyRoadKinds: [])
        let path = walkingPath(from: pair.from, to: pair.to, geometry: nil)

        let segments = routeSegmentsOfDay(day, profile: .walking, journeyRoadKinds: [], geometry: [key: [path]])

        #expect(segments.map(\.dashed) == [true])
    }

    @Test("a Path with no spans and endpoints under threshold emits nothing")
    func noSpansUnderThreshold() {
        let day = twoStopDay(fromLng: 0, toLng: 0.0001)
        let pair = pairsOfDay(day)[0]
        let key = pairKey(profile: .walking, pair: pair, journeyRoadKinds: [])
        let path = walkingPath(from: pair.from, to: pair.to, geometry: nil)

        let segments = routeSegmentsOfDay(day, profile: .walking, journeyRoadKinds: [], geometry: [key: [path]])

        #expect(segments.isEmpty)
    }
}

@Suite("boundsOfDay")
struct BoundsOfDayTests {
    private func anchorLodging(_ id: String, _ lat: Double, _ lng: Double) -> Anchor {
        var base = makeBase(id: id)
        base.lat = lat
        base.lng = lng
        return .lodging(Lodging(base: base, checkInDate: "2026-09-01", checkOutDate: "2026-09-03"))
    }

    @Test("includes both anchors and stops")
    func includesAnchorsAndStops() {
        let day = DerivedDay(
            date: "2026-09-01", dayNumber: 1, label: nil,
            stops: [stop(activityAt("mid", 5), order: 0)],
            startAnchor: anchorLodging("start", 0, 0), endAnchor: anchorLodging("end", 10, 10),
            checkInWaypoint: nil
        )
        let bounds = boundsOfDay(day)
        #expect(bounds?.southwest.lat == 0)
        #expect(bounds?.northeast.lat == 10)
    }

    @Test("excludes checkInWaypoint")
    func excludesCheckInWaypoint() {
        var farAway = makeBase(id: "waypoint")
        farAway.lat = 89
        farAway.lng = 179
        let waypoint = Lodging(base: farAway, checkInDate: "2026-09-01", checkOutDate: "2026-09-03")
        let day = DerivedDay(
            date: "2026-09-01", dayNumber: 1, label: nil,
            stops: [stop(activityAt("mid", 5), order: 0)],
            startAnchor: anchorLodging("start", 0, 0), endAnchor: anchorLodging("end", 10, 10),
            checkInWaypoint: waypoint
        )
        let bounds = boundsOfDay(day)
        #expect(bounds?.northeast.lat != 89, "the waypoint's extreme coordinate must not leak into the bounds")
    }

    @Test("nil for a day with no coordinates at all")
    func nilWhenUngeocoded() {
        let day = DerivedDay(date: "2026-09-01", dayNumber: 1, label: nil, stops: [], startAnchor: nil, endAnchor: nil, checkInWaypoint: nil)
        #expect(boundsOfDay(day) == nil)
    }

    @Test("a single point yields a zero-extent box")
    func singlePoint() {
        let day = DerivedDay(
            date: "2026-09-01", dayNumber: 1, label: nil, stops: [stop(activityAt("only", 5), order: 0)],
            startAnchor: nil, endAnchor: nil, checkInWaypoint: nil
        )
        let bounds = boundsOfDay(day)
        #expect(bounds?.southwest == bounds?.northeast)
    }
}

@Suite("emphasisTier")
struct EmphasisTierTests {
    @Test("the active day always wins")
    func activeWins() {
        #expect(emphasisTier(dayNumber: 2, activeDayNumber: 2, browsedDayNumbers: [2, 3]) == .active)
    }

    @Test("a sibling in the browsed metro is toned down but not rest")
    func metroSibling() {
        #expect(emphasisTier(dayNumber: 3, activeDayNumber: 2, browsedDayNumbers: [2, 3]) == .metro)
    }

    @Test("anything outside both recedes to rest")
    func rest() {
        #expect(emphasisTier(dayNumber: 7, activeDayNumber: 2, browsedDayNumbers: [2, 3]) == .rest)
    }
}
