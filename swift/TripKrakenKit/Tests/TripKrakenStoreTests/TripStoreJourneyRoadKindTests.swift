import Testing
import TripKrakenKit

@testable import TripKrakenStore

@MainActor
@Suite("TripStore.setJourneyRoadKind")
struct SetJourneyRoadKindTests {
    @Test("setting a kind for a new pair inserts, canonicalized")
    func insertsCanonicalized() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "b")), .activity(makeActivity(id: "a"))]))
        try store.setJourneyRoadKind(from: "b", to: "a", kind: .driving)

        let kind = store.trip?.journeyRoadKinds.first
        #expect(kind?.locationAId == "a")
        #expect(kind?.locationBId == "b")
        #expect(kind?.kind == .driving)
    }

    @Test("setting a kind again updates the existing row rather than duplicating it")
    func updatesExistingRow() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))]))
        try store.setJourneyRoadKind(from: "a", to: "b", kind: .walking)
        try store.setJourneyRoadKind(from: "b", to: "a", kind: .driving)

        #expect(store.trip?.journeyRoadKinds.count == 1)
        #expect(store.trip?.journeyRoadKinds.first?.kind == .driving)
    }

    @Test("clearing with a nil kind removes the row")
    func nilKindRemoves() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))]))
        try store.setJourneyRoadKind(from: "a", to: "b", kind: .walking)
        try store.setJourneyRoadKind(from: "a", to: "b", kind: nil)

        #expect(store.trip?.journeyRoadKinds.isEmpty == true)
    }

    @Test("persists across reload")
    func persistsAcrossReload() throws {
        let container = try TripKrakenContainer.inMemory()
        let store1 = TripStore(container: container)
        try store1.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))]))
        try store1.setJourneyRoadKind(from: "a", to: "b", kind: .driving)

        let store2 = TripStore(container: container)
        try store2.load(tripId: "t1")
        #expect(store2.trip?.journeyRoadKinds.first?.kind == .driving)
    }
}
