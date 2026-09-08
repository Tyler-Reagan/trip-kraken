import Testing
import TripKrakenKit

@testable import TripKrakenStore

@MainActor
@Suite("TripStore.setLodgingDates / clearLodging")
struct LodgingAnchorTests {
    @Test("gives an activity dates, elevating it to lodging")
    func elevatesToLodging() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "hotel"))]))
        try store.setLodgingDates(locationId: "hotel", checkInDate: "2026-09-01", checkOutDate: "2026-09-03")
        let location = store.trip?.locations.first { $0.base.id == "hotel" }
        #expect(location?.asLodging?.checkInDate == "2026-09-01")
    }

    @Test("overlapping an existing lodging is rejected and nothing is written")
    func overlapRejected() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [
            .lodging(Lodging(base: makeBase(id: "hotelA"), checkInDate: "2026-09-01", checkOutDate: "2026-09-04")),
            .activity(makeActivity(id: "hotelB")),
        ]))
        #expect(throws: LodgingValidationError.overlapsExistingLodging(locationId: "hotelA")) {
            try store.setLodgingDates(locationId: "hotelB", checkInDate: "2026-09-02", checkOutDate: "2026-09-05")
        }
        #expect(store.trip?.locations.first { $0.base.id == "hotelB" }?.asLodging == nil, "the rejected write never landed")
    }

    @Test("clearing a lodging relegates it back to activity")
    func clearRelegates() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [
            .lodging(Lodging(base: makeBase(id: "hotel"), checkInDate: "2026-09-01", checkOutDate: "2026-09-03"))
        ]))
        try store.clearLodging("hotel")
        let location = store.trip?.locations.first { $0.base.id == "hotel" }
        #expect(location?.asActivity != nil)
    }
}

@MainActor
@Suite("TripStore.setTripEdge / clearTripEdge")
struct TripEdgeMutationTests {
    @Test("assigning arrival to a new Location releases the old holder in the same save")
    func reassigningReleasesOldHolder() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [
            .transit(Transit(base: makeBase(id: "old"), authored: true, arriveAt: "2026-09-01T09:00")),
            .activity(makeActivity(id: "new")),
        ]))
        try store.setTripEdge(.arrival, locationId: "new", time: "11:00")

        let old = store.trip?.locations.first { $0.base.id == "old" }
        let new = store.trip?.locations.first { $0.base.id == "new" }
        #expect(old?.asActivity != nil, "old held no other edge, so releasing arrival demotes it")
        #expect(new?.asTransit?.arriveAt == "2026-09-01T11:00")
    }

    @Test("a holder with both edges stays transit after releasing one")
    func holderWithBothEdgesStaysTransit() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [
            .transit(Transit(base: makeBase(id: "old"), authored: true, arriveAt: "2026-09-01T09:00", departAt: "2026-09-05T18:00")),
            .activity(makeActivity(id: "new")),
        ], startDate: "2026-09-01", endDate: "2026-09-05"))
        try store.setTripEdge(.arrival, locationId: "new", time: nil)
        let old = store.trip?.locations.first { $0.base.id == "old" }
        #expect(old?.asTransit?.departAt == "2026-09-05T18:00", "still holds departure")
        #expect(old?.asTransit?.arriveAt == nil)
    }

    @Test("clearing the last edge relegates to activity")
    func clearingLastEdgeRelegates() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [
            .transit(Transit(base: makeBase(id: "airport"), authored: true, arriveAt: "2026-09-01T09:00"))
        ]))
        try store.clearTripEdge(.arrival, locationId: "airport")
        #expect(store.trip?.locations.first?.asActivity != nil)
    }

    @Test("an invalid time is rejected")
    func invalidTime() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        #expect(throws: TransitValidationError.invalidTime("bad")) {
            try store.setTripEdge(.arrival, locationId: "a", time: "bad")
        }
    }
}
