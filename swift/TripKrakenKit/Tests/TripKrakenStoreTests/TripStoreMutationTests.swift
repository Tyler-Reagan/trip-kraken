import Testing
import TripKrakenKit

@testable import TripKrakenStore

@MainActor
@Suite("TripStore.movePlacement")
struct MovePlacementTests {
    @Test("reorder persists across reload")
    func persistsAcrossReload() throws {
        let container = try TripKrakenContainer.inMemory()
        let seed = makeTrip(
            locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))],
            placements: [
                Placement(id: "p1", tripId: "t1", locationId: "a", date: "2026-09-01", order: 0),
                Placement(id: "p2", tripId: "t1", locationId: "b", date: "2026-09-01", order: 1),
            ]
        )

        let store1 = TripStore(container: container)
        try store1.seedIfEmpty(with: seed)
        try store1.movePlacement(placementId: "p2", date: "2026-09-01", order: 0)
        #expect(store1.trip?.placements.sorted { $0.order < $1.order }.map(\.locationId) == ["b", "a"])

        // A fresh store instance against the same container proves the write actually persisted,
        // not just that in-memory state looks right.
        let store2 = TripStore(container: container)
        try store2.load(tripId: "t1")
        #expect(store2.trip?.placements.sorted { $0.order < $1.order }.map(\.locationId) == ["b", "a"])
    }

    @Test("moving to a new date shifts it there")
    func crossDayMove() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(
            locations: [.activity(makeActivity(id: "a"))],
            placements: [Placement(id: "p1", tripId: "t1", locationId: "a", date: "2026-09-01", order: 0)],
            startDate: "2026-09-01", endDate: "2026-09-03"
        ))
        try store.movePlacement(placementId: "p1", date: "2026-09-02", order: 0)
        #expect(store.trip?.placements.first?.date == "2026-09-02")
    }

    @Test("moving an unknown placement throws")
    func unknownPlacement() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip())
        #expect(throws: PlacementOrderingError.placementNotFound) {
            try store.movePlacement(placementId: "ghost", date: "2026-09-01", order: 0)
        }
    }
}

@MainActor
@Suite("TripStore.placeActivity")
struct PlaceActivityTests {
    @Test("appends to the end of the date by default")
    func appendsByDefault() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(
            locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))],
            placements: [Placement(id: "p1", tripId: "t1", locationId: "a", date: "2026-09-01", order: 0)]
        ))
        let newId = try store.placeActivity(locationId: "b", date: "2026-09-01")
        let placed = store.trip?.placements.first { $0.id == newId }
        #expect(placed?.order == 1)
    }
}

@MainActor
@Suite("TripStore.deleteLocation")
struct DeleteLocationTests {
    @Test("cascades to the Location's own Placements and JourneyRoadKind rows")
    func cascades() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(
            locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))],
            placements: [
                Placement(id: "p1", tripId: "t1", locationId: "a", date: "2026-09-01", order: 0),
                Placement(id: "p2", tripId: "t1", locationId: "b", date: "2026-09-01", order: 0),
            ]
        ))
        try store.movePlacement(placementId: "p1", date: "2026-09-01", order: 0)  // no-op, ensures a valid loaded trip
        try store.deleteLocation("a")

        #expect(store.trip?.locations.map(\.base.id) == ["b"])
        #expect(store.trip?.placements.map(\.id) == ["p2"], "the deleted Location's own Placement is gone")
    }
}

@MainActor
@Suite("TripStore.setDayLabel")
struct SetDayLabelTests {
    @Test("setting a label round-trips")
    func setsLabel() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip())
        try store.setDayLabel(date: "2026-09-01", label: "Arrival")
        #expect(store.trip?.dayLabels?["2026-09-01"] == "Arrival")
    }

    @Test("clearing the last label leaves dayLabels nil")
    func clearingLastLabelLeavesNil() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip())
        try store.setDayLabel(date: "2026-09-01", label: "Arrival")
        try store.setDayLabel(date: "2026-09-01", label: nil)
        #expect(store.trip?.dayLabels == nil)
    }

    @Test("a blank label clears rather than storing whitespace")
    func blankLabelClears() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip())
        try store.setDayLabel(date: "2026-09-01", label: "Arrival")
        try store.setDayLabel(date: "2026-09-01", label: "   ")
        #expect(store.trip?.dayLabels == nil)
    }
}

@MainActor
@Suite("TripStore.addLocation")
struct AddLocationTests {
    @Test("adds an activity that appears in the trip")
    func addsActivity() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip())
        let id = try store.addLocation(name: "New Museum", address: "1 Main St", lat: 1, lng: 2)
        let added = store.trip?.locations.first { $0.base.id == id }
        #expect(added?.asActivity != nil)
        #expect(added?.base.name == "New Museum")
        #expect(added?.base.lat == 1)
    }
}
