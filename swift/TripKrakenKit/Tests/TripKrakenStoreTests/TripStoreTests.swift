import Testing
import TripKrakenKit

@testable import TripKrakenStore

@MainActor
@Suite("TripStore.seedIfEmpty")
struct SeedIfEmptyTests {
    @Test("seeds an empty store and loads it")
    func seedsEmptyStore() throws {
        let store = try makeInMemoryStore()
        let id = try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        #expect(id == "t1")
        #expect(store.trip?.id == "t1")
        #expect(store.days.count == numDaysOf(startDate: "2026-09-01", endDate: "2026-09-05"))
    }

    @Test("never overwrites an existing trip")
    func doesNotOverwriteExisting() throws {
        let container = try TripKrakenContainer.inMemory()
        let store1 = TripStore(container: container)
        try store1.seedIfEmpty(with: makeTrip(id: "real-trip"))

        let store2 = TripStore(container: container)
        let id = try store2.seedIfEmpty(with: makeTrip(id: "fixture-trip"))
        #expect(id == "real-trip", "an existing trip is loaded, never replaced by the seed")
    }
}

@MainActor
@Suite("TripStore.load")
struct LoadTests {
    @Test("throws for an unknown trip id")
    func unknownTrip() throws {
        let store = try makeInMemoryStore()
        #expect(throws: StoreMappingError.tripNotFound("ghost")) {
            try store.load(tripId: "ghost")
        }
    }

    @Test("populates days and metros alongside the trip")
    func populatesDerivations() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(startDate: "2026-09-01", endDate: "2026-09-03"))
        #expect(store.days.count == 3)
    }
}

@MainActor
@Suite("TripStore.listTripSummaries")
struct ListTripSummariesTests {
    @Test("counts locations per trip")
    func countsLocations() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))]))
        let summaries = try store.listTripSummaries()
        #expect(summaries.first?.locationCount == 2)
    }

    @Test("an empty store has no summaries")
    func emptyStore() throws {
        let store = try makeInMemoryStore()
        #expect(try store.listTripSummaries().isEmpty)
    }
}
