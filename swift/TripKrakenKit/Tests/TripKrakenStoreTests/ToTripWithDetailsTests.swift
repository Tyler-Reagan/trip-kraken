import Testing
import SwiftData
import TripKrakenKit

@testable import TripKrakenStore

@MainActor
@Suite("toTripWithDetails")
struct ToTripWithDetailsTests {
    @Test("locations sort by name, placements sort by (date, order)")
    func ordering() throws {
        let context = ModelContext(try TripKrakenContainer.inMemory())
        let trip = makeTrip(
            locations: [.activity(makeActivity(id: "zebra")), .activity(makeActivity(id: "apple"))],
            placements: [
                Placement(id: "p1", tripId: "t1", locationId: "zebra", date: "2026-09-02", order: 0),
                Placement(id: "p2", tripId: "t1", locationId: "apple", date: "2026-09-01", order: 0),
            ]
        )
        let record = insertTripRecord(from: trip, into: context)
        let mapped = try toTripWithDetails(record)

        #expect(mapped.locations.map(\.base.id) == ["apple", "zebra"], "alphabetical by name")
        #expect(mapped.placements.map(\.locationId) == ["apple", "zebra"], "apple's 09-01 sorts before zebra's 09-02")
    }

    @Test("within one date, placements sort by order")
    func orderWithinDate() throws {
        let context = ModelContext(try TripKrakenContainer.inMemory())
        let trip = makeTrip(
            locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))],
            placements: [
                Placement(id: "p1", tripId: "t1", locationId: "b", date: "2026-09-01", order: 1),
                Placement(id: "p2", tripId: "t1", locationId: "a", date: "2026-09-01", order: 0),
            ]
        )
        let record = insertTripRecord(from: trip, into: context)
        let mapped = try toTripWithDetails(record)
        #expect(mapped.placements.map(\.locationId) == ["a", "b"])
    }

    @Test("dayLabels round-trips nil")
    func dayLabelsNil() throws {
        let context = ModelContext(try TripKrakenContainer.inMemory())
        let record = insertTripRecord(from: makeTrip(), into: context)
        #expect(try toTripWithDetails(record).dayLabels == nil)
    }

    @Test("dayLabels round-trips a real value")
    func dayLabelsRoundTrip() throws {
        let context = ModelContext(try TripKrakenContainer.inMemory())
        var trip = makeTrip()
        trip.dayLabels = ["2026-09-01": "Arrival day"]
        let record = insertTripRecord(from: trip, into: context)
        #expect(try toTripWithDetails(record).dayLabels == ["2026-09-01": "Arrival day"])
    }

    @Test("an empty trip maps to zero derived days worth of locations/placements")
    func emptyTrip() throws {
        let context = ModelContext(try TripKrakenContainer.inMemory())
        let record = insertTripRecord(from: makeTrip(), into: context)
        let mapped = try toTripWithDetails(record)
        #expect(mapped.locations.isEmpty)
        #expect(mapped.placements.isEmpty)
        #expect(mapped.journeyRoadKinds.isEmpty)
    }
}
