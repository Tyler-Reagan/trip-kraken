import Foundation
import TripKrakenKit

// Minimal builders so each test only states the fields it actually varies — mirrors the `transit()`
// helper in the ported `src/types/index.test.ts`.

func makeBase(id: String, name: String = "") -> LocationBase {
    LocationBase(id: id, tripId: "t1", name: name.isEmpty ? id : name)
}

func makeActivity(id: String, visitDuration: Int? = nil) -> Activity {
    var base = makeBase(id: id)
    base.visitDuration = visitDuration
    return Activity(base: base)
}

func makeTransit(id: String, arriveAt: IsoDateTime? = nil, departAt: IsoDateTime? = nil, authored: Bool = true) -> Transit {
    Transit(base: makeBase(id: id), authored: authored, arriveAt: arriveAt, departAt: departAt)
}

func makeLodging(id: String, checkIn: IsoDate, checkOut: IsoDate) -> Lodging {
    Lodging(base: makeBase(id: id), checkInDate: checkIn, checkOutDate: checkOut)
}

func makeTrip(
    locations: [Location] = [], placements: [Placement] = [],
    startDate: IsoDate = "2026-09-01", endDate: IsoDate = "2026-09-05"
) -> TripWithDetails {
    TripWithDetails(
        id: "t1", name: "Trip", sourceUrl: nil, startDate: startDate, endDate: endDate, dayLabels: nil,
        roadProfile: .walking, transitCaveatDismissed: false, hasJrPass: false, createdAt: Date(),
        updatedAt: Date(), locations: locations, placements: placements, journeyRoadKinds: []
    )
}
