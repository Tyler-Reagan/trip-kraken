import Testing
import TripKrakenKit

// Ported from `tripSplitWarning.test.ts`. Tokyo-ish vs. Osaka-ish — ~400km apart, well past the
// 75km metro radius.
private let tokyo = (lat: 35.6812, lng: 139.7671)
private let osaka = (lat: 34.6937, lng: 135.5023)

private func activityAt(_ id: String, _ lat: Double, _ lng: Double, excluded: Bool = false) -> Activity {
    var base = makeBase(id: id)
    base.lat = lat
    base.lng = lng
    base.excluded = excluded
    return Activity(base: base)
}

private func lodgingAt(_ id: String, _ lat: Double, _ lng: Double) -> Lodging {
    var base = makeBase(id: id)
    base.lat = lat
    base.lng = lng
    return Lodging(base: base, checkInDate: "2026-09-01", checkOutDate: "2026-09-05")
}

@Suite("detectUncoveredSplit")
struct DetectUncoveredSplitTests {
    @Test("one cluster never warns, regardless of spread")
    func oneClusterNeverWarns() {
        let trip = makeTrip(locations: [
            .activity(activityAt("tower", 35.6586, 139.7454)),
            .activity(activityAt("park", 35.7138, 139.7745)),
            .lodging(lodgingAt("hotel", tokyo.lat, tokyo.lng)),
        ])
        #expect(detectUncoveredSplit(trip) == nil)
    }

    @Test("two clusters, one uncovered — warns, naming only the uncovered one")
    func namesOnlyUncoveredCluster() {
        let trip = makeTrip(locations: [
            .activity(activityAt("tower", tokyo.lat, tokyo.lng)),
            .activity(activityAt("castle", osaka.lat, osaka.lng)),
            .lodging(lodgingAt("hotel", tokyo.lat, tokyo.lng)),
        ])
        let result = detectUncoveredSplit(trip)
        #expect(result?.count == 1)
        #expect(result?.first?.activityCount == 1)
    }

    @Test("both clusters covered by a lodging — suppressed")
    func bothCoveredSuppressed() {
        let trip = makeTrip(locations: [
            .activity(activityAt("tower", tokyo.lat, tokyo.lng)),
            .activity(activityAt("castle", osaka.lat, osaka.lng)),
            .lodging(lodgingAt("tokyoHotel", tokyo.lat, tokyo.lng)),
            .lodging(lodgingAt("osakaHotel", osaka.lat, osaka.lng)),
        ])
        #expect(detectUncoveredSplit(trip) == nil, "a deliberate two-city trip is fine")
    }

    @Test("an excluded Activity never forms or breaks a cluster on its own")
    func excludedActivityIgnored() {
        let trip = makeTrip(locations: [
            .activity(activityAt("tower", tokyo.lat, tokyo.lng)),
            .activity(activityAt("castle", osaka.lat, osaka.lng, excluded: true)),
            .lodging(lodgingAt("hotel", tokyo.lat, tokyo.lng)),
        ])
        #expect(detectUncoveredSplit(trip) == nil)
    }

    @Test("not yet geocoded — no cluster, no false split")
    func ungeocodedNoFalseSplit() {
        let trip = makeTrip(locations: [
            .activity(activityAt("tower", tokyo.lat, tokyo.lng)),
            .activity(activityAt("pending", 0, 0)),
            .lodging(lodgingAt("hotel", tokyo.lat, tokyo.lng)),
        ])
        #expect(detectUncoveredSplit(trip) == nil)
    }

    @Test("no Activities at all — nothing to warn about")
    func noActivities() {
        let trip = makeTrip(locations: [.lodging(lodgingAt("hotel", tokyo.lat, tokyo.lng))])
        #expect(detectUncoveredSplit(trip) == nil)
    }
}
