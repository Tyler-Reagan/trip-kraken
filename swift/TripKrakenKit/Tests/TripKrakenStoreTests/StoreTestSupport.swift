import Foundation
import SwiftData
import TripKrakenKit

@testable import TripKrakenStore

// Minimal builders, mirroring TripKrakenKitTests' TestSupport.swift style — scoped to this test
// target since the two test targets can't share `internal`/file-private helpers across a module
// boundary.

func makeBase(id: String, name: String = "") -> LocationBase {
    LocationBase(id: id, tripId: "t1", name: name.isEmpty ? id : name)
}

func makeActivity(id: String) -> Activity {
    Activity(base: makeBase(id: id))
}

func makeTrip(
    id: String = "t1", locations: [Location] = [], placements: [Placement] = [],
    startDate: IsoDate = "2026-09-01", endDate: IsoDate = "2026-09-05"
) -> TripWithDetails {
    TripWithDetails(
        id: id, name: "Trip", sourceUrl: nil, startDate: startDate, endDate: endDate, dayLabels: nil,
        roadProfile: .walking, transitCaveatDismissed: false, hasJrPass: false, createdAt: Date(),
        updatedAt: Date(), locations: locations, placements: placements, journeyRoadKinds: []
    )
}

@MainActor
func makeInMemoryStore() throws -> TripStore {
    TripStore(container: try TripKrakenContainer.inMemory())
}
