import Testing
import TripKrakenKit

@testable import TripKrakenStore

@MainActor
@Suite("TripStore.setVisitDuration")
struct SetVisitDurationTests {
    @Test("sets and clamps an activity's visit duration")
    func setsAndClamps() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.setVisitDuration(locationId: "a", minutes: 9000)

        let location = store.trip?.locations.first { $0.base.id == "a" }
        #expect(location?.base.visitDuration == visitDurationMaxMinutes)
    }

    @Test("is a no-op for a non-activity Location")
    func noOpForNonActivity() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [
            .lodging(Lodging(base: makeBase(id: "hotel"), checkInDate: "2026-09-01", checkOutDate: "2026-09-03"))
        ]))
        try store.setVisitDuration(locationId: "hotel", minutes: 60)

        #expect(store.trip?.locations.first?.base.visitDuration == nil)
    }
}

@MainActor
@Suite("TripStore.setLocationNote")
struct SetLocationNoteTests {
    @Test("sets a note")
    func setsNote() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.setLocationNote(locationId: "a", note: "Bring cash")

        #expect(store.trip?.locations.first?.base.note == "Bring cash")
    }

    @Test("a blank note clears rather than storing whitespace")
    func blankNoteClears() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.setLocationNote(locationId: "a", note: "Bring cash")
        try store.setLocationNote(locationId: "a", note: "   ")

        #expect(store.trip?.locations.first?.base.note == nil)
    }

    @Test("nil clears an existing note")
    func nilClears() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.setLocationNote(locationId: "a", note: "Bring cash")
        try store.setLocationNote(locationId: "a", note: nil)

        #expect(store.trip?.locations.first?.base.note == nil)
    }
}
