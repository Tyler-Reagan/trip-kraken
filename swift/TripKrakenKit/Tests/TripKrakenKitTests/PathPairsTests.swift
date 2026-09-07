import Testing
import TripKrakenKit

private func activityAt(_ id: String, _ lat: Double?, _ lng: Double?) -> Activity {
    var base = makeBase(id: id)
    base.lat = lat
    base.lng = lng
    return Activity(base: base)
}

private func lodgingAt(_ id: String, _ lat: Double, _ lng: Double) -> Lodging {
    var base = makeBase(id: id)
    base.lat = lat
    base.lng = lng
    return Lodging(base: base, checkInDate: "2026-09-01", checkOutDate: "2026-09-03")
}

private func stop(_ loc: Activity, order: Int) -> ScheduledStop {
    ScheduledStop(placement: Placement(id: "p-\(loc.base.id)", tripId: "t1", locationId: loc.base.id, date: "2026-09-01", order: order), location: loc)
}

private func day(
    startAnchor: Anchor? = nil, checkInWaypoint: Lodging? = nil, stops: [ScheduledStop] = [], endAnchor: Anchor? = nil
) -> DerivedDay {
    DerivedDay(
        date: "2026-09-01", dayNumber: 1, label: nil, stops: stops, startAnchor: startAnchor, endAnchor: endAnchor,
        checkInWaypoint: checkInWaypoint
    )
}

private func shape(_ pairs: [PathPair]) -> [String] {
    pairs.map { "\($0.from.locationId ?? "?")>\($0.to.locationId ?? "?")" }
}

private func shapeLocPairs(_ pairs: [(from: Location, to: Location)]) -> [String] {
    pairs.map { "\($0.from.base.id)>\($0.to.base.id)" }
}

@Suite("pairsOfDay: the chain's composition and order")
struct PairsOfDayTests {
    @Test("a normal Day chains start Anchor -> stops -> end Anchor")
    func normalChain() {
        let hotel = lodgingAt("hotel", 35.0, 139.0)
        let d = day(
            startAnchor: .lodging(hotel),
            stops: [stop(activityAt("a1", 35.1, 139.1), order: 1), stop(activityAt("a2", 35.2, 139.2), order: 2)],
            endAnchor: .lodging(hotel)
        )
        #expect(shape(pairsOfDay(d)) == ["hotel>a1", "a1>a2", "a2>hotel"])
    }

    @Test("the check-in waypoint sits between the start Anchor and the first stop")
    func checkinWaypointOrder() {
        let d = day(
            startAnchor: .lodging(lodgingAt("old-hotel", 35.0, 139.0)),
            checkInWaypoint: lodgingAt("new-hotel", 35.5, 139.5),
            stops: [stop(activityAt("a1", 35.1, 139.1), order: 1)],
            endAnchor: .lodging(lodgingAt("new-hotel", 35.5, 139.5))
        )
        #expect(shape(pairsOfDay(d)) == ["old-hotel>new-hotel", "new-hotel>a1", "a1>new-hotel"])
    }

    @Test("one positioned entry and no Anchors yields no pairs")
    func onePositionedEntry() {
        #expect(pairsOfDay(day(stops: [stop(activityAt("a1", 35.1, 139.1), order: 1)])).isEmpty)
    }

    @Test("an empty Day yields no pairs")
    func emptyDay() {
        #expect(pairsOfDay(day()).isEmpty)
    }

    @Test("an ungeocoded Location drops out and its neighbours become adjacent")
    func ungeocodedDropsOut() {
        let d = day(
            startAnchor: .lodging(lodgingAt("hotel", 35.0, 139.0)),
            stops: [
                stop(activityAt("a1", 35.1, 139.1), order: 1),
                stop(activityAt("nowhere", nil, nil), order: 2),
                stop(activityAt("a2", 35.2, 139.2), order: 3),
            ]
        )
        #expect(shape(pairsOfDay(d)) == ["hotel>a1", "a1>a2"])
    }
}

@Suite("pairKey: what invalidates a held answer")
struct PairKeyTests {
    @Test func exactFormatAndDirectionAndProfile() {
        let p = PathPair(from: PathEndpoint(lat: 35.0, lng: 139.0), to: PathEndpoint(lat: 35.1, lng: 139.1))
        #expect(pairKey(profile: .walking, pair: p, journeyRoadKinds: []) == "walking:139.000000,35.000000>139.100000,35.100000")
        #expect(pairKey(profile: .walking, pair: p, journeyRoadKinds: []) != pairKey(profile: .driving, pair: p, journeyRoadKinds: []))

        let reversed = PathPair(from: p.to, to: p.from)
        #expect(pairKey(profile: .walking, pair: p, journeyRoadKinds: []) != pairKey(profile: .walking, pair: reversed, journeyRoadKinds: []))

        let moved = PathPair(from: PathEndpoint(lat: 35.0, lng: 139.0), to: PathEndpoint(lat: 35.100001, lng: 139.1))
        #expect(pairKey(profile: .walking, pair: p, journeyRoadKinds: []) != pairKey(profile: .walking, pair: moved, journeyRoadKinds: []))

        let sameCoordsOtherLocation = PathPair(
            from: PathEndpoint(lat: 35.0, lng: 139.0, locationId: "x"), to: PathEndpoint(lat: 35.1, lng: 139.1, locationId: "y")
        )
        #expect(
            pairKey(profile: .walking, pair: p, journeyRoadKinds: [])
                == pairKey(profile: .walking, pair: sameCoordsOtherLocation, journeyRoadKinds: []),
            "identity plays no part when neither has a chosen kind"
        )
    }

    @Test("fixed precision absorbs float drift")
    func floatDrift() {
        let direct = PathPair(from: PathEndpoint(lat: 35.1, lng: 139.0), to: PathEndpoint(lat: 35.2, lng: 139.0))
        let summed = PathPair(from: PathEndpoint(lat: 35.0 + 0.1, lng: 139.0), to: PathEndpoint(lat: 0.1 + 35.1, lng: 139.0))
        #expect(pairKey(profile: .walking, pair: direct, journeyRoadKinds: []) == pairKey(profile: .walking, pair: summed, journeyRoadKinds: []))
    }

    @Test("a chosen kind invalidates the unchosen answer, unordered")
    func chosenKindInvalidates() {
        let p = PathPair(from: PathEndpoint(lat: 35.0, lng: 139.0, locationId: "x"), to: PathEndpoint(lat: 35.1, lng: 139.1, locationId: "y"))
        let chosen = JourneyRoadKind(id: "k1", tripId: "t1", locationAId: "x", locationBId: "y", kind: .driving)

        #expect(pairKey(profile: .walking, pair: p, journeyRoadKinds: [chosen]) != pairKey(profile: .walking, pair: p, journeyRoadKinds: []))
        #expect(pairKey(profile: .walking, pair: p, journeyRoadKinds: [chosen]).hasSuffix(":driving"))
        #expect(pairKey(profile: .walking, pair: PathPair(from: p.to, to: p.from), journeyRoadKinds: [chosen]).hasSuffix(":driving"))

        let unrelated = JourneyRoadKind(id: "k2", tripId: "t1", locationAId: "x", locationBId: "z", kind: .driving)
        #expect(pairKey(profile: .walking, pair: p, journeyRoadKinds: [unrelated]) == pairKey(profile: .walking, pair: p, journeyRoadKinds: []))

        let noLocationId = PathPair(from: PathEndpoint(lat: 35.0, lng: 139.0), to: PathEndpoint(lat: 35.1, lng: 139.1))
        #expect(
            pairKey(profile: .walking, pair: noLocationId, journeyRoadKinds: [chosen])
                == pairKey(profile: .walking, pair: noLocationId, journeyRoadKinds: [])
        )
    }
}

@Suite("withJourneyRoadKind")
struct WithJourneyRoadKindTests {
    @Test("a choice excludes rail/bus entirely, not just the road element")
    func choiceExcludesTransit() {
        #expect(withJourneyRoadKind([.rail, .bus, .walking], chosen: .driving) == [.driving])
        #expect(withJourneyRoadKind([.rail, .walking], chosen: .driving) == [.driving])
    }

    @Test("no choice, no change")
    func noChoiceNoChange() {
        #expect(withJourneyRoadKind([.rail, .bus, .walking], chosen: nil) == [.rail, .bus, .walking])
    }
}

@Suite("uniquePairsOfDays: one lookup per distinct pair")
struct UniquePairsOfDaysTests {
    @Test("a pair shared across Days is looked up once")
    func sharedAcrossDays() {
        let hotel = lodgingAt("hotel", 35.0, 139.0)
        let a1 = activityAt("a1", 35.1, 139.1)
        let days = [
            day(startAnchor: .lodging(hotel), stops: [stop(a1, order: 1)], endAnchor: .lodging(hotel)),
            day(startAnchor: .lodging(hotel), stops: [stop(a1, order: 1)], endAnchor: .lodging(hotel)),
        ]
        #expect(shape(uniquePairsOfDays(days, profile: .walking, journeyRoadKinds: [])) == ["hotel>a1", "a1>hotel"])
    }

    @Test("distinct pairs across Days are all kept, in first-seen order")
    func distinctPairsKept() {
        let h = lodgingAt("h", 35.0, 139.0)
        let days = [
            day(startAnchor: .lodging(h), stops: [stop(activityAt("a1", 35.1, 139.1), order: 1)]),
            day(startAnchor: .lodging(h), stops: [stop(activityAt("a2", 35.2, 139.2), order: 1)]),
        ]
        #expect(shape(uniquePairsOfDays(days, profile: .walking, journeyRoadKinds: [])) == ["h>a1", "h>a2"])
    }

    @Test("a Trip with no Days needs no lookups")
    func noDays() {
        #expect(uniquePairsOfDays([], profile: .walking, journeyRoadKinds: []).isEmpty)
    }
}

@Suite("dayChainEntries / dayChainPairs")
struct DayChainTests {
    @Test("a normal Day's entries: start Anchor, stops, end Anchor")
    func normalEntries() {
        let hotel = lodgingAt("hotel", 35.0, 139.0)
        let d = day(
            startAnchor: .lodging(hotel),
            stops: [stop(activityAt("a1", 35.1, 139.1), order: 1), stop(activityAt("a2", 35.2, 139.2), order: 2)],
            endAnchor: .lodging(hotel)
        )
        #expect(dayChainEntries(d).map(\.role) == [.start, .stop, .stop, .end])
        #expect(shapeLocPairs(dayChainPairs(d)) == ["hotel>a1", "a1>a2", "a2>hotel"])
    }

    @Test("regression: a Day with only anchors and no stops still gets a connector between them")
    func onlyAnchorsNoStops() {
        let d = day(startAnchor: .lodging(lodgingAt("narita", 35.0, 139.0)), checkInWaypoint: lodgingAt("hotel", 35.5, 139.5))
        #expect(shapeLocPairs(dayChainPairs(d)) == ["narita>hotel"])
    }

    @Test("all three anchor kinds with no stops gets both connectors")
    func allAnchorKindsNoStops() {
        let d = day(
            startAnchor: .lodging(lodgingAt("narita", 35.0, 139.0)), checkInWaypoint: lodgingAt("hotel", 35.5, 139.5),
            endAnchor: .lodging(lodgingAt("hotel", 35.5, 139.5))
        )
        #expect(shapeLocPairs(dayChainPairs(d)) == ["narita>hotel", "hotel>hotel"])
    }

    @Test("an ungeocoded stop is still an entry, and still produces a pair")
    func ungeocodedStopStillAnEntry() {
        let d = day(startAnchor: .lodging(lodgingAt("hotel", 35.0, 139.0)), stops: [stop(activityAt("nowhere", nil, nil), order: 1)])
        #expect(dayChainEntries(d).map(\.role) == [.start, .stop])
        #expect(shapeLocPairs(dayChainPairs(d)) == ["hotel>nowhere"])
    }
}

@Suite("journeyRoadKindFor")
struct JourneyRoadKindForTests {
    @Test func unordered() {
        let kinds = [JourneyRoadKind(id: "k1", tripId: "t1", locationAId: "a", locationBId: "b", kind: .driving)]
        #expect(journeyRoadKindFor(kinds, "a", "b")?.kind == .driving, "found in stored order")
        #expect(journeyRoadKindFor(kinds, "b", "a")?.kind == .driving, "found in reversed order")
        #expect(journeyRoadKindFor(kinds, "a", "c") == nil)
        #expect(journeyRoadKindFor([], "a", "b") == nil)
    }
}

@Suite("resolveJourneyKindToggle")
struct ResolveJourneyKindToggleTests {
    @Test func explicitChoiceWinsOverDefault() {
        let kinds = [JourneyRoadKind(id: "k1", tripId: "t1", locationAId: "a", locationBId: "b", kind: .driving)]
        #expect(resolveJourneyKindToggle(journeyRoadKinds: kinds, roadProfile: .walking, fromId: "a", toId: "b", onKindChange: { _ in })?.kind == .driving)
        #expect(resolveJourneyKindToggle(journeyRoadKinds: kinds, roadProfile: .walking, fromId: "a", toId: "c", onKindChange: { _ in })?.kind == .walking)
        #expect(resolveJourneyKindToggle(journeyRoadKinds: [], roadProfile: .walking, fromId: "hotel", toId: "hotel", onKindChange: { _ in }) == nil)
    }

    @Test("onKindChange is wired through unchanged")
    func onKindChangeWiredThrough() {
        var received: (String, String, RoadProfile?)?
        resolveJourneyKindToggle(journeyRoadKinds: [], roadProfile: .walking, fromId: "a", toId: "b") { kind in
            received = ("a", "b", kind)
        }?.onKindChange(.driving)
        #expect(received?.0 == "a")
        #expect(received?.1 == "b")
        #expect(received?.2 == .driving)
    }
}
