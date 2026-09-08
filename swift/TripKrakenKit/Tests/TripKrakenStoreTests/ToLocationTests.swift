import Testing
import TripKrakenKit

@testable import TripKrakenStore

@Suite("toLocation")
struct ToLocationTests {
    @Test("an activity row narrows to .activity")
    func activity() throws {
        let record = LocationRecord(id: "a1", tripId: "t1", name: "Museum")
        record.kind = .activity
        #expect(try toLocation(record).asActivity != nil)
    }

    @Test("a transit row narrows to .transit, always authored")
    func transit() throws {
        let record = LocationRecord(id: "airport", tripId: "t1", name: "Airport")
        record.kind = .transit
        record.arriveAt = "2026-09-01T10:00"
        let location = try toLocation(record)
        #expect(location.asTransit?.authored == true)
        #expect(location.asTransit?.arriveAt == "2026-09-01T10:00")
        #expect(location.asTransit?.departAt == nil)
    }

    @Test("a lodging row narrows to .lodging with both dates")
    func lodging() throws {
        let record = LocationRecord(id: "hotel", tripId: "t1", name: "Hotel")
        record.kind = .lodging
        record.checkInDate = "2026-09-01"
        record.checkOutDate = "2026-09-03"
        let location = try toLocation(record)
        #expect(location.asLodging?.checkInDate == "2026-09-01")
        #expect(location.asLodging?.checkOutDate == "2026-09-03")
    }

    @Test("a lodging row with no dates is a store inconsistency, not a value")
    func lodgingMissingDates() {
        let record = LocationRecord(id: "hotel", tripId: "t1", name: "Hotel")
        record.kind = .lodging
        #expect(throws: StoreMappingError.lodgingMissingDates(locationId: "hotel")) {
            try toLocation(record)
        }
    }

    @Test("base fields carry through untouched")
    func baseFields() throws {
        let record = LocationRecord(id: "a1", tripId: "t1", name: "Museum")
        record.address = "1 Museum Way"
        record.lat = 35.0
        record.lng = 139.0
        record.visitDuration = 45
        record.categories = ["museum", "history"]
        let location = try toLocation(record)
        #expect(location.base.address == "1 Museum Way")
        #expect(location.base.lat == 35.0)
        #expect(location.base.visitDuration == 45)
        #expect(location.base.categories == ["museum", "history"])
    }
}
