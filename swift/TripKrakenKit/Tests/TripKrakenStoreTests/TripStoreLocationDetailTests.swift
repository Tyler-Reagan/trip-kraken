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
@Suite("TripStore.applyEnrichment")
struct ApplyEnrichmentTests {
    @Test("writes address/phone/categories and marks done")
    func writesFieldsAndMarksDone() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.applyEnrichment(locationId: "a", address: "1 Main St", phone: "555-0100", categories: ["Restaurant"])

        let location = store.trip?.locations.first { $0.base.id == "a" }
        #expect(location?.base.address == "1 Main St")
        #expect(location?.base.phone == "555-0100")
        #expect(location?.base.categories == ["Restaurant"])
        #expect(location?.base.enrichmentStatus == .done)
    }

    @Test("a nil field is left untouched rather than clearing an existing value")
    func nilFieldDoesNotClobber() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.applyEnrichment(locationId: "a", address: "1 Main St", phone: nil, categories: nil)
        try store.applyEnrichment(locationId: "a", address: nil, phone: "555-0100", categories: nil)

        let location = store.trip?.locations.first { $0.base.id == "a" }
        #expect(location?.base.address == "1 Main St")
        #expect(location?.base.phone == "555-0100")
    }

    @Test("clears a prior failure")
    func clearsPriorFailure() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.markEnrichmentFailed(locationId: "a", error: "No match found")
        try store.applyEnrichment(locationId: "a", address: "1 Main St", phone: nil, categories: nil)

        let location = store.trip?.locations.first { $0.base.id == "a" }
        #expect(location?.base.enrichmentStatus == .done)
        #expect(location?.base.enrichmentError == nil)
    }
}

@MainActor
@Suite("TripStore.markEnrichmentFailed")
struct MarkEnrichmentFailedTests {
    @Test("sets failed status and the error message")
    func setsFailedAndError() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.markEnrichmentFailed(locationId: "a", error: "No match found")

        let location = store.trip?.locations.first { $0.base.id == "a" }
        #expect(location?.base.enrichmentStatus == .failed)
        #expect(location?.base.enrichmentError == "No match found")
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

@MainActor
@Suite("TripStore.setExcluded")
struct SetExcludedTests {
    @Test("excluding a location round-trips")
    func excludes() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.setExcluded(locationId: "a", excluded: true)

        #expect(store.trip?.locations.first?.base.excluded == true)
    }

    @Test("re-including clears it")
    func reIncludes() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        try store.setExcluded(locationId: "a", excluded: true)
        try store.setExcluded(locationId: "a", excluded: false)

        #expect(store.trip?.locations.first?.base.excluded == false)
    }
}
