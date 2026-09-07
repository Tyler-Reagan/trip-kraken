import Testing
import TripKrakenKit

private func p(_ id: String, _ date: IsoDate, _ order: Int, locationId: String? = nil) -> Placement {
    Placement(id: id, tripId: "trip-1", locationId: locationId ?? "loc-\(id)", date: date, order: order)
}

@Suite("reorderPlacements: within-day")
struct ReorderWithinDayTests {
    @Test("moving the last item to the front shifts the others down")
    func moveToFront() throws {
        let placements = [p("a", "2026-01-01", 0), p("b", "2026-01-01", 1), p("c", "2026-01-01", 2)]
        let next = try reorderPlacements(placements, placementId: "c", date: "2026-01-01", order: 0)
        let byDate = next.filter { $0.date == "2026-01-01" }.sorted { $0.order < $1.order }
        #expect(byDate.map(\.id) == ["c", "a", "b"])
    }
}

@Suite("reorderPlacements: cross-day move")
struct ReorderCrossDayTests {
    @Test("source day re-densifies after the move")
    func redensifies() throws {
        let placements = [
            p("a", "2026-01-01", 0), p("b", "2026-01-01", 1), p("c", "2026-01-01", 2), p("d", "2026-01-02", 0),
        ]
        let next = try reorderPlacements(placements, placementId: "b", date: "2026-01-02", order: 1)

        let day1 = next.filter { $0.date == "2026-01-01" }.sorted { $0.order < $1.order }
        #expect(day1.map(\.order) == [0, 1])
        #expect(day1.map(\.id) == ["a", "c"], "source day keeps its remaining relative order")

        let day2 = next.filter { $0.date == "2026-01-02" }.sorted { $0.order < $1.order }
        #expect(day2.map(\.id) == ["d", "b"], "target day inserts at the requested order, shifting siblings down")
    }

    @Test("moving a placement alone on its day empties the source day")
    func aloneOnDay() throws {
        let placements = [p("a", "2026-01-01", 0), p("b", "2026-01-02", 0)]
        let next = try reorderPlacements(placements, placementId: "a", date: "2026-01-02", order: 0)
        #expect(next.filter { $0.date == "2026-01-01" }.isEmpty)
        let day2 = next.filter { $0.date == "2026-01-02" }.sorted { $0.order < $1.order }
        #expect(day2.map(\.id) == ["a", "b"])
    }

    @Test("reordering an unknown placement id throws")
    func unknownId() {
        #expect(throws: PlacementOrderingError.placementNotFound) {
            try reorderPlacements([], placementId: "missing", date: "2026-01-01", order: 0)
        }
    }
}

@Suite("insertPlacement")
struct InsertPlacementTests {
    @Test("omitted order appends to the end of the date")
    func appendsWhenOrderOmitted() {
        let placements = [p("a", "2026-01-01", 0), p("b", "2026-01-01", 1)]
        let next = insertPlacement(placements, id: "c", tripId: "trip-1", locationId: "loc-c", date: "2026-01-01")
        let day1 = next.filter { $0.date == "2026-01-01" }.sorted { $0.order < $1.order }
        #expect(day1.map(\.id) == ["a", "b", "c"])
    }

    @Test("explicit order shifts siblings down")
    func explicitOrderShifts() {
        let placements = [p("a", "2026-01-01", 0), p("b", "2026-01-01", 1)]
        let next = insertPlacement(placements, id: "c", tripId: "trip-1", locationId: "loc-c", date: "2026-01-01", order: 0)
        let day1 = next.filter { $0.date == "2026-01-01" }.sorted { $0.order < $1.order }
        #expect(day1.map(\.id) == ["c", "a", "b"])
    }

    @Test("first placement on an empty date gets order 0")
    func firstOnEmptyDate() {
        let next = insertPlacement([], id: "a", tripId: "trip-1", locationId: "loc-a", date: "2026-01-01")
        #expect(next == [p("a", "2026-01-01", 0, locationId: "loc-a")])
    }
}
