import Testing
import TripKrakenKit

// Ported from `metroCluster.test.ts`. Real coordinates, ~400km apart (Osaka/Tokyo).
private let osaka = Point(lat: 34.6937, lng: 135.5023)
private let tokyo = Point(lat: 35.6762, lng: 139.6503)

private func scattered(_ center: Point, count: Int, label: String = "act") -> [Activity] {
    // Small jitter (~0-2km) — well inside one metro, never enough to bridge the Osaka/Tokyo gap.
    (0..<count).map { i in
        makeActivity(id: "\(label)-\(center.lat)-\(i)")
            .withCoords(lat: center.lat + Double(i % 5) * 0.005, lng: center.lng + Double(i % 3) * 0.005)
    }
}

extension Activity {
    fileprivate func withCoords(lat: Double?, lng: Double?) -> Activity {
        var copy = self
        copy.base.lat = lat
        copy.base.lng = lng
        return copy
    }
}

private func lodgingAt(_ id: String, _ lat: Double, _ lng: Double) -> Lodging {
    Lodging(base: makeBase(id: id).withCoords(lat: lat, lng: lng), checkInDate: "2026-07-01", checkOutDate: "2026-07-05")
}

extension LocationBase {
    fileprivate func withCoords(lat: Double?, lng: Double?) -> LocationBase {
        var copy = self
        copy.lat = lat
        copy.lng = lng
        return copy
    }
}

@Suite("clusterByMetro")
struct ClusterByMetroTests {
    @Test("two distant metros split into two clusters")
    func distantMetrosSplit() {
        let osakaStops = scattered(osaka, count: 19)
        let tokyoStops = scattered(tokyo, count: 6)
        let clusters = clusterByMetro(activities: osakaStops + tokyoStops, lodgings: [Lodging]())
        #expect(clusters.count == 2)
        #expect(clusters.map(\.activities.count).sorted() == [6, 19])
    }

    @Test("a single metro's spread stays one cluster")
    func spreadStaysOneCluster() {
        let clusters = clusterByMetro(activities: scattered(osaka, count: 10), lodgings: [Lodging]())
        #expect(clusters.count == 1)
    }

    @Test("a cluster matches a lodging within the metro radius")
    func matchesNearbyLodging() {
        let osakaLodging = lodgingAt("l-osaka", osaka.lat + 0.01, osaka.lng + 0.01)
        let tokyoLodging = lodgingAt("l-tokyo", tokyo.lat, tokyo.lng)
        let clusters = clusterByMetro(
            activities: scattered(osaka, count: 3) + scattered(tokyo, count: 2), lodgings: [osakaLodging, tokyoLodging]
        )
        #expect(clusters.count == 2)
        for c in clusters { #expect(c.lodgings.count == 1) }
        let osakaCluster = clusters.first { $0.activities.first!.base.lat! < 35 }!
        #expect(osakaCluster.lodgings.first?.base.id == "l-osaka")
    }

    @Test("multiple lodgings covering the same metro all match")
    func multipleLodgingsMatch() {
        let hotelA = lodgingAt("hotelA", osaka.lat, osaka.lng)
        let hotelB = lodgingAt("hotelB", osaka.lat + 0.02, osaka.lng + 0.02)
        let clusters = clusterByMetro(activities: scattered(osaka, count: 5), lodgings: [hotelA, hotelB])
        #expect(clusters.count == 1)
        #expect(Set(clusters[0].lodgings.map(\.base.id)) == ["hotelA", "hotelB"])
    }

    @Test("no covering lodging yields an empty match, not a false one")
    func noFalseMatch() {
        let farLodging = lodgingAt("far", tokyo.lat, tokyo.lng)
        let clusters = clusterByMetro(activities: scattered(osaka, count: 4), lodgings: [farLodging])
        let activityFounded = clusters.filter { !$0.activities.isEmpty }
        #expect(activityFounded.count == 1)
        #expect(activityFounded[0].lodgings.isEmpty)
    }

    @Test("a lodging covering no activity-founded metro founds its own")
    func lodgingFoundsOwnMetro() {
        let atami = Point(lat: 35.0880435, lng: 139.0639024)  // >75km from both Tokyo and Osaka
        let stay = lodgingAt("stay", atami.lat, atami.lng)
        let clusters = clusterByMetro(activities: scattered(osaka, count: 4) + scattered(tokyo, count: 2), lodgings: [stay])

        #expect(clusters.count == 3, "the lodging-only region becomes its own metro")
        let founded = clusters.first { $0.activities.isEmpty }
        #expect(founded != nil, "a metro may hold zero activities")
        #expect(founded?.lodgings.map(\.base.id) == ["stay"])

        let memberships = clusters.filter { $0.lodgings.contains { $0.base.id == "stay" } }
        #expect(memberships.count == 1, "an isolated lodging joins exactly one metro")
    }

    @Test("founding is a second pass, so a lodging can never bridge two activity metros")
    func lodgingCannotBridge() {
        let midpoint = Point(lat: (osaka.lat + tokyo.lat) / 2, lng: (osaka.lng + tokyo.lng) / 2)
        let between = lodgingAt("between", midpoint.lat, midpoint.lng)
        let clusters = clusterByMetro(activities: scattered(osaka, count: 3) + scattered(tokyo, count: 3), lodgings: [between])

        let activityFounded = clusters.filter { !$0.activities.isEmpty }
        #expect(activityFounded.count == 2, "Osaka and Tokyo stay separate metros")
        for c in activityFounded { #expect(c.activities.count == 3) }
    }

    @Test("an already-covered lodging does not also found a redundant metro")
    func coveredLodgingNoRedundantMetro() {
        let nearby = lodgingAt("nearby", osaka.lat + 0.01, osaka.lng + 0.01)
        let clusters = clusterByMetro(activities: scattered(osaka, count: 4), lodgings: [nearby])
        #expect(clusters.count == 1)
        #expect(clusters[0].lodgings.map(\.base.id) == ["nearby"])
    }

    @Test("activities without real coordinates are excluded, not clustered as (0,0)")
    func ungeocodedExcluded() {
        let zeroed = makeActivity(id: "zero").withCoords(lat: 0, lng: 0)
        let ungeocoded = makeActivity(id: "ungeocoded").withCoords(lat: nil, lng: nil)
        let clusters = clusterByMetro(activities: scattered(osaka, count: 2) + [zeroed, ungeocoded], lodgings: [Lodging]())
        #expect(clusters.count == 1)
        #expect(clusters[0].activities.count == 2)
    }
}
