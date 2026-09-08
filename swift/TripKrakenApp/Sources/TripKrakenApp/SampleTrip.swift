import Foundation
import TripKrakenKit

/// The first-launch seed `TripStore.seedIfEmpty` inserts into an empty SwiftData store — no longer
/// the app's data source itself (that's the store, from here on). Kept as a hardcoded fixture
/// rather than an empty blank-slate trip so the app is immediately demonstrable on a fresh install.
/// Lives in the app target, not `TripKrakenKit`: the library stays free of demo data, same as it
/// stays free of UI and persistence.
extension TripWithDetails {
    static let sample: TripWithDetails = {
        let arrival = Transit(
            base: LocationBase(id: "narita", tripId: "trip-1", name: "Narita Airport", lat: 35.7719, lng: 140.3929),
            authored: true, arriveAt: "2026-10-01T14:30"
        )
        let departure = Transit(
            base: LocationBase(id: "haneda", tripId: "trip-1", name: "Haneda Airport", lat: 35.5494, lng: 139.7798),
            authored: true, departAt: "2026-10-03T18:00"
        )
        let hotel = Lodging(
            base: LocationBase(id: "hotel", tripId: "trip-1", name: "Shibuya Stream Hotel", lat: 35.6580, lng: 139.7016),
            checkInDate: "2026-10-01", checkOutDate: "2026-10-04"
        )
        let sensoji = Activity(
            base: LocationBase(
                id: "senso-ji", tripId: "trip-1", name: "Sensō-ji",
                address: "2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan", lat: 35.7148, lng: 139.7967,
                visitDuration: 90
            )
        )
        let teamLab = Activity(
            base: LocationBase(id: "teamlab", tripId: "trip-1", name: "teamLab Planets", lat: 35.6465, lng: 139.7938, visitDuration: 120)
        )
        let shibuyaCrossing = Activity(
            base: LocationBase(
                id: "shibuya-crossing", tripId: "trip-1", name: "Shibuya Crossing", lat: 35.6595, lng: 139.7004,
                visitDuration: 30
            )
        )

        let placements = [
            Placement(id: "p1", tripId: "trip-1", locationId: "senso-ji", date: "2026-10-02", order: 0),
            Placement(id: "p2", tripId: "trip-1", locationId: "teamlab", date: "2026-10-02", order: 1),
            Placement(id: "p3", tripId: "trip-1", locationId: "shibuya-crossing", date: "2026-10-03", order: 0),
        ]

        return TripWithDetails(
            id: "trip-1", name: "Tokyo Long Weekend", sourceUrl: nil, startDate: "2026-10-01", endDate: "2026-10-03",
            dayLabels: nil, roadProfile: .walking, transitCaveatDismissed: false, hasJrPass: false,
            createdAt: Date(), updatedAt: Date(),
            locations: [
                .transit(arrival), .transit(departure), .lodging(hotel), .activity(sensoji), .activity(teamLab),
                .activity(shibuyaCrossing),
            ],
            placements: placements, journeyRoadKinds: []
        )
    }()
}
