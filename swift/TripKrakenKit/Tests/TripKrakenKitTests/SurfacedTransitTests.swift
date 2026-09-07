import Testing
import TripKrakenKit

private let tripId = "trip-1"

private func point(_ lat: Double, _ lng: Double, stationName: String? = nil, locationId: String? = nil) -> PathEndpoint {
    PathEndpoint(lat: lat, lng: lng, locationId: locationId, stationName: stationName)
}

private func walk(_ from: PathEndpoint, _ to: PathEndpoint) -> Path {
    .walking(WalkingPath(base: PathBase(from: from, to: to, travelCost: TravelCost(distanceMeters: 100, durationSeconds: 60, basisOfCost: .straightLine, answeredBy: .osmJapan))))
}

private func rail(_ from: PathEndpoint, _ to: PathEndpoint, lineName: String = "Test Line") -> Path {
    .rail(RailPath(base: PathBase(from: from, to: to, travelCost: TravelCost(distanceMeters: 1000, durationSeconds: 120, basisOfCost: .railNetwork, answeredBy: .osmJapan)), lineName: lineName))
}

@Suite("surfacedTransitOf")
struct SurfacedTransitOfTests {
    @Test("a walk-only Journey with no station surfaces nothing")
    func noStationNoSurface() {
        let hotel = point(35.0, 139.0, locationId: "hotel")
        let activity = point(35.1, 139.1, locationId: "activity")
        #expect(surfacedTransitOf([walk(hotel, activity)], tripId: tripId).isEmpty)
    }

    @Test("one rail leg, no transfer: boarding and alighting stations both surface")
    func boardingAndAlighting() {
        let hotel = point(35.0, 139.0, locationId: "hotel")
        let shibuya = point(35.1, 139.1, stationName: "Shibuya")
        let yoyogi = point(35.2, 139.2, stationName: "Yoyogi")
        let meijiJingu = point(35.3, 139.3, locationId: "meiji-jingu")
        let chain = [walk(hotel, shibuya), rail(shibuya, yoyogi), walk(yoyogi, meijiJingu)]

        let surfaced = surfacedTransitOf(chain, tripId: tripId)
        #expect(surfaced.map(\.base.name).sorted() == ["Shibuya", "Yoyogi"])
        for t in surfaced {
            #expect(t.authored == false)
            #expect(t.base.tripId == tripId)
            #expect(t.base.enrichmentStatus == .done)
            #expect(t.arriveAt == nil)
            #expect(t.base.placeId == nil)
        }
    }

    @Test("a single rail leg's own ends must not leak, even if both carry a stationName")
    func singleLegEndsExcluded() {
        let tokyo = point(35.0, 139.0, stationName: "Tokyo")
        let shinOsaka = point(34.0, 135.0, stationName: "Shin-Osaka")
        let surfaced = surfacedTransitOf([rail(tokyo, shinOsaka, lineName: "Shinkansen")], tripId: tripId)
        #expect(surfaced.isEmpty, "the journey's own ends are excluded by position")
    }

    @Test("a real transfer walk: the cluster name wins over each rail leg's individual name")
    func transferClusterNameWins() {
        let tokyo = point(35.0, 139.0, stationName: "Tokyo")
        let akihabaraIndividual = point(35.1, 139.1, stationName: "Akihabara")
        let akihabaraCluster = point(35.1, 139.1, stationName: "Akihabara Iwamotocho")
        let iwamotochoCluster = point(35.15, 139.15, stationName: "Akihabara Iwamotocho")
        let iwamotochoIndividual = point(35.15, 139.15, stationName: "Iwamotocho")
        let asakusa = point(35.2, 139.2, stationName: "Asakusa")
        let destination = point(35.3, 139.3, locationId: "destination")

        let chain: [Path] = [
            rail(tokyo, akihabaraIndividual, lineName: "Line A"),
            walk(akihabaraCluster, iwamotochoCluster),
            rail(iwamotochoIndividual, asakusa, lineName: "Line B"),
            walk(asakusa, destination),
        ]

        let surfaced = surfacedTransitOf(chain, tripId: tripId)
        let byCoord = Dictionary(uniqueKeysWithValues: surfaced.map { ("\($0.base.lat!),\($0.base.lng!)", $0.base.name) })
        #expect(surfaced.count == 3, "Akihabara-side, Iwamotocho-side, and Asakusa all surface")
        #expect(byCoord["35.1,139.1"] == "Akihabara Iwamotocho")
        #expect(byCoord["35.15,139.15"] == "Akihabara Iwamotocho")
        #expect(byCoord["35.2,139.2"] == "Asakusa")
    }

    @Test("a zero-distance transfer collapses to one surfaced entry, cluster name winning")
    func zeroDistanceTransferCollapses() {
        let shinjuku = point(35.0, 139.0, stationName: "Shinjuku")
        let yoyogiIndividual = point(35.1, 139.1, stationName: "Yoyogi")
        let yoyogiCluster = point(35.1, 139.1, stationName: "Yoyogi (transfer)")
        let akihabara = point(35.2, 139.2, stationName: "Akihabara")

        let chain: [Path] = [
            rail(shinjuku, yoyogiIndividual, lineName: "Line A"),
            walk(yoyogiCluster, yoyogiCluster),
            rail(yoyogiIndividual, akihabara, lineName: "Line B"),
        ]

        let surfaced = surfacedTransitOf(chain, tripId: tripId)
        #expect(surfaced.count == 1, "one physical point surfaces once, not twice")
        #expect(surfaced.first?.base.name == "Yoyogi (transfer)")
    }

    @Test("two Journeys through the same physical station produce the same id")
    func sameStationSameId() {
        let a = point(35.0, 139.0, locationId: "a")
        let shibuya = point(35.5, 139.5, stationName: "Shibuya")
        let b = point(35.9, 139.9, locationId: "b")

        let first = surfacedTransitOf([walk(a, shibuya), walk(shibuya, b)], tripId: tripId)
        let second = surfacedTransitOf([walk(a, shibuya), rail(shibuya, b)], tripId: tripId)
        #expect(first.first?.base.id == second.first?.base.id)
    }
}
