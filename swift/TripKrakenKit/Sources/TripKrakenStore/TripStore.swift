import Foundation
import Observation
import SwiftData
import TripKrakenKit

/// The single reader and single writer of the SwiftData store. `@Model` objects never reach the
/// view layer — views read `trip`/`days`/`metros`, all plain `TripKrakenKit` values re-derived
/// after every mutation. `context` and `record` are deliberately private: every write must funnel
/// through `refresh()` so cached derivations can never go stale relative to what's actually
/// persisted.
///
/// No `@Query` and no `.modelContainer(_:)` view modifier — that would hand `@Model` objects to
/// views and let each view form its own opinion about sort order. This is also what fixes the
/// pre-persistence app recomputing `deriveTripPlanDays` on every body evaluation, and gives
/// `metrosOf` the presentation-layer caching its own source comment says it's waiting for.
///
/// Mutations are intent-shaped methods, never a diff engine — there is no `apply(_ trip:)`. A
/// whole-object write-back would be a merge engine, and ADR-0041 says don't build one. Each method
/// follows the same shape: a pure `TripKrakenKit` function decides (already tested on its own in
/// `TripInvariantsTests`/etc.), this class only persists the result.
@MainActor
@Observable
public final class TripStore {
    public private(set) var trip: TripWithDetails?
    public private(set) var days: [DerivedDay] = []
    public private(set) var metros: [TripMetro] = []

    private let context: ModelContext
    private var record: TripRecord?

    public init(container: ModelContainer) {
        self.context = ModelContext(container)
    }

    // MARK: - Load / seed

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
        self.record = record
        try refresh()
    }

    /// Blank-slate trip creation (ADR-0010), port of `POST /api/trips`. Loads the new trip
    /// afterward, same as `seedIfEmpty` — creating a trip and not switching to it would leave the
    /// caller looking at whatever was current before, which is never what "New Trip" means.
    /// Duplicate names are legal (ADR-0040 dropped the DB uniqueness index) — callers wanting the
    /// web app's advisory duplicate-name hint should check `checkTripNameCollision` against
    /// `listTripSummaries()` themselves before calling this, not treated as this method's job.
    @discardableResult
    public func createTrip(name: String, startDate: IsoDate, endDate: IsoDate) throws -> String {
        try validateTripDateRange(startDate: startDate, endDate: endDate)
        let id = UUID().uuidString
        let trip = TripWithDetails(
            id: id, name: name, sourceUrl: nil, startDate: startDate, endDate: endDate,
            dayLabels: nil, roadProfile: .walking, transitCaveatDismissed: false, hasJrPass: false,
            createdAt: Date(), updatedAt: Date(), locations: [], placements: [], journeyRoadKinds: []
        )
        insertTripRecord(from: trip, into: context)
        try context.save()
        try load(tripId: id)
        return id
    }

    public func listTripSummaries() throws -> [TripSummary] {
        try context.fetch(FetchDescriptor<TripRecord>()).map { record in
            TripSummary(
                id: record.id, name: record.name, createdAt: record.createdAt,
                locationCount: record.locations?.count ?? 0
            )
        }
    }

    // MARK: - Plan mutations

    /// Places a new Activity onto a date. `order` defaults to appended-last, matching
    /// `insertPlacement`.
    @discardableResult
    public func placeActivity(locationId: String, date: IsoDate, order: Int? = nil) throws -> String {
        guard let trip, let record else { throw StoreMappingError.tripNotFound("") }
        let id = UUID().uuidString
        let next = insertPlacement(trip.placements, id: id, tripId: trip.id, locationId: locationId, date: date, order: order)
        syncPlacements(next, into: record)
        try context.save()
        try refresh()
        return id
    }

    /// Moves an existing Placement to a date/order, shifting siblings as `reorderPlacements`
    /// decides (already tested on its own in `PlacementOrderingTests`) — this method only persists
    /// whatever that pure function returns.
    public func movePlacement(placementId: String, date: IsoDate, order: Int) throws {
        guard let trip, let record else { return }
        let next = try reorderPlacements(trip.placements, placementId: placementId, date: date, order: order)
        syncPlacements(next, into: record)
        try context.save()
        try refresh()
    }

    public func removePlacement(_ placementId: String) throws {
        guard let record else { return }
        guard let target = (record.placements ?? []).first(where: { $0.id == placementId }) else { return }
        context.delete(target)
        try context.save()
        try refresh()
    }

    public func setDayLabel(date: IsoDate, label: String?) throws {
        guard let record else { return }
        var labels = record.dayLabels ?? [:]
        if let label, !label.trimmingCharacters(in: .whitespaces).isEmpty {
            labels[date] = label
        } else {
            labels.removeValue(forKey: date)
        }
        record.dayLabels = labels.isEmpty ? nil : labels
        try context.save()
        try refresh()
    }

    // MARK: - Location mutations

    @discardableResult
    public func addLocation(name: String, address: String? = nil, lat: Double? = nil, lng: Double? = nil) throws -> String {
        guard let trip, let record else { throw StoreMappingError.tripNotFound("") }
        let id = UUID().uuidString
        let base = LocationBase(id: id, tripId: trip.id, name: name, address: address, lat: lat, lng: lng)
        let locationRecord = makeLocationRecord(from: .activity(Activity(base: base)))
        locationRecord.trip = record
        context.insert(locationRecord)
        try context.save()
        try refresh()
        return id
    }

    /// Sets an Activity's estimated visit time, clamped to the same range the duration ladder UI
    /// steps within (`clampVisitDuration`). A no-op for a Location that isn't an Activity — only
    /// activities carry a visit duration the optimizer consults.
    public func setVisitDuration(locationId: String, minutes: Int) throws {
        guard let record else { return }
        guard let locationRecord = (record.locations ?? []).first(where: { $0.id == locationId }), locationRecord.kind == .activity else { return }
        locationRecord.visitDuration = clampVisitDuration(minutes)
        try context.save()
        try refresh()
    }

    /// Writes a successful enrichment match — address/phone/categories are only overwritten when
    /// the provider actually supplied a value, so a partial match (e.g. no phone number on file)
    /// never clobbers a field the location already had. Always clears any prior failure.
    public func applyEnrichment(locationId: String, address: String?, phone: String?, categories: [String]?) throws {
        guard let record else { return }
        guard let locationRecord = (record.locations ?? []).first(where: { $0.id == locationId }) else { return }
        if let address { locationRecord.address = address }
        if let phone { locationRecord.phone = phone }
        if let categories { locationRecord.categories = categories }
        locationRecord.enrichmentStatus = .done
        locationRecord.enrichmentError = nil
        try context.save()
        try refresh()
    }

    /// Records a terminal enrichment failure (no match found, or the request itself errored) —
    /// mirrors `markEnrichmentFailed` (`src/lib/db/index.ts`). This is the state `.pending`/`.done`
    /// can both fall back into; a Location can be re-enriched later without any special-casing.
    public func markEnrichmentFailed(locationId: String, error: String) throws {
        guard let record else { return }
        guard let locationRecord = (record.locations ?? []).first(where: { $0.id == locationId }) else { return }
        locationRecord.enrichmentStatus = .failed
        locationRecord.enrichmentError = error
        try context.save()
        try refresh()
    }

    /// Free-text notes on any Location, regardless of kind. `nil`/empty clears them.
    public func setLocationNote(locationId: String, note: String?) throws {
        guard let record else { return }
        guard let locationRecord = (record.locations ?? []).first(where: { $0.id == locationId }) else { return }
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        locationRecord.note = (trimmed?.isEmpty ?? true) ? nil : trimmed
        try context.save()
        try refresh()
    }

    /// Cascades to the Location's own Placements and JourneyRoadKind rows — the SQLite
    /// `ON DELETE CASCADE` this design deliberately doesn't model as a SwiftData relationship (see
    /// `Schema.swift`'s header), so it's an explicit step here instead.
    public func deleteLocation(_ locationId: String) throws {
        guard let record else { return }
        if let locationRecord = (record.locations ?? []).first(where: { $0.id == locationId }) {
            context.delete(locationRecord)
        }
        for placement in record.placements ?? [] where placement.locationId == locationId {
            context.delete(placement)
        }
        for kind in record.journeyRoadKinds ?? [] where kind.locationAId == locationId || kind.locationBId == locationId {
            context.delete(kind)
        }
        try context.save()
        try refresh()
    }

    // MARK: - Anchor mutations

    /// Elevates a Location to `kind: lodging` — the gesture that makes it a lodging is giving it
    /// dates (ADR-0015 §2). `validateLodgingDates` (already tested on its own) is the only
    /// invariant check; this method only persists once it passes.
    public func setLodgingDates(locationId: String, checkInDate: IsoDate, checkOutDate: IsoDate) throws {
        guard let trip, let record else { throw StoreMappingError.tripNotFound("") }
        try validateLodgingDates(trip, locationId: locationId, checkInDate: checkInDate, checkOutDate: checkOutDate)
        guard let locationRecord = (record.locations ?? []).first(where: { $0.id == locationId }) else { return }
        locationRecord.kind = .lodging
        locationRecord.checkInDate = checkInDate
        locationRecord.checkOutDate = checkOutDate
        try context.save()
        try refresh()
    }

    /// Relegates a lodging back to a plain activity — removing the booking (its constraint) drops
    /// the kind, mirroring `clearLodging` (`src/lib/db/index.ts`).
    public func clearLodging(_ locationId: String) throws {
        guard let record else { return }
        guard let locationRecord = (record.locations ?? []).first(where: { $0.id == locationId }) else { return }
        locationRecord.kind = .activity
        locationRecord.checkInDate = nil
        locationRecord.checkOutDate = nil
        try context.save()
        try refresh()
    }

    /// Designates `locationId` as the trip's arrival or departure. `planTripEdgeAssignment`
    /// (already tested) decides the date/time and whoever must be released; this method persists
    /// both sides of that plan in one save, so the two Locations can never disagree mid-write.
    public func setTripEdge(_ edge: TripEdge, locationId: String, time: String?) throws {
        guard let trip, let record else { throw StoreMappingError.tripNotFound("") }
        let plan = try planTripEdgeAssignment(trip, edge: edge, locationId: locationId, time: time)

        if let releasedId = plan.releasedLocationId,
            let released = (record.locations ?? []).first(where: { $0.id == releasedId })
        {
            switch edge {
            case .arrival: released.arriveAt = nil
            case .departure: released.departAt = nil
            }
            if plan.releasedBecomesActivity { released.kind = .activity }
        }

        guard let target = (record.locations ?? []).first(where: { $0.id == locationId }) else { return }
        target.kind = .transit
        switch edge {
        case .arrival: target.arriveAt = plan.isoDateTime
        case .departure: target.departAt = plan.isoDateTime
        }
        try context.save()
        try refresh()
    }

    /// Releases a Location from an edge role. Clearing the *last* of `arriveAt`/`departAt`
    /// relegates it back to `kind: activity` — `planTripEdgeClear` decides which; this only acts.
    public func clearTripEdge(_ edge: TripEdge, locationId: String) throws {
        guard let trip, let record else { throw StoreMappingError.tripNotFound("") }
        let plan = try planTripEdgeClear(trip, edge: edge, locationId: locationId)
        guard let target = (record.locations ?? []).first(where: { $0.id == locationId }) else { return }
        switch edge {
        case .arrival: target.arriveAt = nil
        case .departure: target.departAt = nil
        }
        if plan.relegateToActivity { target.kind = .activity }
        try context.save()
        try refresh()
    }

    // MARK: - Journey road-kind mutations

    /// Sets or clears a Journey's chosen walk/drive kind. `planJourneyRoadKindWrite` (already
    /// tested) decides the canonicalized pair, which row to update/insert/delete; this method only
    /// persists that plan — including the duplicate-collapse case the old DB uniqueness index used
    /// to make impossible (ADR-0040).
    public func setJourneyRoadKind(from: String, to: String, kind: RoadProfile?) throws {
        guard let trip, let record else { throw StoreMappingError.tripNotFound("") }
        let plan = planJourneyRoadKindWrite(trip.journeyRoadKinds, tripId: trip.id, newId: UUID().uuidString, from: from, to: to, kind: kind)

        let existingById = Dictionary(uniqueKeysWithValues: (record.journeyRoadKinds ?? []).map { ($0.id, $0) })
        for id in plan.deleteIds {
            if let toDelete = existingById[id] { context.delete(toDelete) }
        }
        if let updateId = plan.updateId, let kind, let toUpdate = existingById[updateId] {
            toUpdate.kind = kind
        }
        if let insert = plan.insert {
            let newRecord = makeJourneyRoadKindRecord(from: insert)
            newRecord.trip = record
            context.insert(newRecord)
        }
        try context.save()
        try refresh()
    }

    // MARK: - Private

    /// Reconciles `record.placements` toward `next`: existing rows are updated in place, new ids
    /// get a new row. Never deletes — `removePlacement` is the only place a Placement disappears.
    private func syncPlacements(_ next: [Placement], into record: TripRecord) {
        var existingById = Dictionary(uniqueKeysWithValues: (record.placements ?? []).map { ($0.id, $0) })
        for placement in next {
            if let existing = existingById.removeValue(forKey: placement.id) {
                if existing.date != placement.date { existing.date = placement.date }
                if existing.order != placement.order { existing.order = placement.order }
            } else {
                let newRecord = makePlacementRecord(from: placement)
                newRecord.trip = record
                context.insert(newRecord)
            }
        }
    }

    private func refresh() throws {
        guard let record else { return }
        let mapped = try toTripWithDetails(record)
        // The partial unique indexes that used to make two arrivals/departures unrepresentable are
        // gone (ADR-0040) — `setTripEdge`/`clearTripEdge` are the only writers of these fields and
        // are written to keep this true, so a violation here means a write-path bug, not a sync
        // conflict. `tripEdgesOf` (Trip.swift) silently picks `.first` when this is false, so this
        // assertion is what keeps that honest during development.
        assert(tripEdgeViolations(mapped).isEmpty, "Trip edge invariant violated: \(tripEdgeViolations(mapped))")
        trip = mapped
        days = deriveTripPlanDays(mapped)
        metros = metrosOf(mapped)
    }
}
