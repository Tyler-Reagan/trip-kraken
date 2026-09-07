import Testing
import TripKrakenKit

@Suite("Geo")
struct GeoTests {
    @Test("hasValidCoords is false only at the (0,0) not-yet-geocoded fiction")
    func validCoords() {
        #expect(!Point(lat: 0, lng: 0).hasValidCoords)
        #expect(Point(lat: 35.6812, lng: 139.7671).hasValidCoords)
        #expect(Point(lat: 0, lng: 139.7671).hasValidCoords, "only lng set is still valid")
    }

    @Test("haversineMeters: Tokyo to Kyoto is roughly 370km")
    func haversineKnownDistance() {
        let tokyoStation = Point(lat: 35.6812, lng: 139.7671)
        let kyotoStation = Point(lat: 34.9858, lng: 135.7588)
        let meters = haversineMeters(tokyoStation, kyotoStation)
        #expect((360_000...380_000).contains(meters))
    }

    @Test("haversineMeters of a point to itself is zero")
    func haversineZero() {
        let p = Point(lat: 35.6812, lng: 139.7671)
        #expect(haversineMeters(p, p) == 0)
    }
}
