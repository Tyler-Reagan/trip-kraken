import Foundation
import Observation
import SwiftData
import TripKrakenKit

/// The single reader and single writer of the SwiftData store. `@Model` objects never reach the
/// view layer — views read `trip`/`days`/`metros`, all plain `TripKrakenKit` values re-derived
/// after every mutation. `context` is deliberately private: every write must funnel through
/// `refresh()` so cached derivations can never go stale relative to what's actually persisted.
///
/// No `@Query` and no `.modelContainer(_:)` view modifier — that would hand `@Model` objects to
/// views and let each view form its own opinion about sort order. This is also what fixes the
/// pre-persistence app recomputing `deriveTripPlanDays` on every body evaluation, and gives
/// `metrosOf` the presentation-layer caching its own source comment says it's waiting for.
@MainActor
@Observable
public final class TripStore {
    public private(set) var trip: TripWithDetails?
    public private(set) var days: [DerivedDay] = []
    public private(set) var metros: [TripMetro] = []

    private let context: ModelContext

    public init(container: ModelContainer) {
        self.context = ModelContext(container)
    }

    /// Inserts `trip` only when the store is empty — never overwrites real data with the fixture.
    /// Loads whichever trip is current afterward (the seed, or whatever was already there).
    @discardableResult
    public func seedIfEmpty(with trip: TripWithDetails) throws -> String {
        let existingIds = try context.fetch(FetchDescriptor<TripRecord>()).map(\.id)
        guard let firstId = existingIds.first else {
            insertTripRecord(from: trip, into: context)
            try context.save()
            try load(tripId: trip.id)
            return trip.id
        }
        try load(tripId: firstId)
        return firstId
    }

    public func load(tripId: String) throws {
        var descriptor = FetchDescriptor<TripRecord>(predicate: #Predicate { $0.id == tripId })
        descriptor.fetchLimit = 1
        guard let record = try context.fetch(descriptor).first else {
            throw StoreMappingError.tripNotFound(tripId)
        }
        try refresh(from: record)
    }

    public func listTripSummaries() throws -> [TripSummary] {
        try context.fetch(FetchDescriptor<TripRecord>()).map { record in
            TripSummary(
                id: record.id, name: record.name, createdAt: record.createdAt,
                locationCount: record.locations?.count ?? 0
            )
        }
    }

    func refresh(from record: TripRecord) throws {
        let mapped = try toTripWithDetails(record)
        trip = mapped
        days = deriveTripPlanDays(mapped)
        metros = metrosOf(mapped)
    }
}
