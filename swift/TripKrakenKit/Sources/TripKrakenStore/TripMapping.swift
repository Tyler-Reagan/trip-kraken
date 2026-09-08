import Foundation
import SwiftData
import TripKrakenKit

// `@Model` classes never reach the view layer — they're reference types, not `Sendable`, and every
// pure function in TripKrakenKit already takes `TripWithDetails`. Mapping once per mutation is far
// cheaper than re-teaching a tested domain layer to speak SwiftData.

public enum StoreMappingError: Error, Sendable, Hashable {
    /// Mirrors `toLocation`'s thrown "DB inconsistency" branch (`src/lib/db/index.ts:53-54`): a
    /// lodging-kind row with no dates is a store inconsistency, not a renderable value.
    case lodgingMissingDates(locationId: String)
    case tripNotFound(String)
}

// MARK: - Records → domain

func toLocationBase(_ record: LocationRecord) -> LocationBase {
    LocationBase(
        id: record.id, tripId: record.tripId, name: record.name, address: record.address,
        lat: record.lat, lng: record.lng, placeId: record.placeId, excluded: record.excluded,
        note: record.note, rating: record.rating, reviewCount: record.reviewCount,
        categories: record.categories, visitDuration: record.visitDuration,
        openTime: record.openTime, closeTime: record.closeTime, hoursJson: record.hoursJson,
        phone: record.phone, enrichmentStatus: record.enrichmentStatus,
        enrichmentError: record.enrichmentError
    )
}

/// Mirrors `toLocation` (`src/lib/db/index.ts:49-64`): narrow one row into the union, dropping the
/// subtype columns the case doesn't own so the value is genuinely variant-shaped.
public func toLocation(_ record: LocationRecord) throws(StoreMappingError) -> Location {
    let base = toLocationBase(record)
    switch record.kind {
    case .activity:
        return .activity(Activity(base: base))
    case .transit:
        return .transit(Transit(base: base, authored: true, arriveAt: record.arriveAt, departAt: record.departAt))
    case .lodging:
        guard let checkIn = record.checkInDate, let checkOut = record.checkOutDate else {
            throw .lodgingMissingDates(locationId: record.id)
        }
        return .lodging(Lodging(base: base, checkInDate: checkIn, checkOutDate: checkOut))
    }
}

public func toPlacement(_ record: PlacementRecord) -> Placement {
    Placement(id: record.id, tripId: record.tripId, locationId: record.locationId, date: record.date, order: record.order)
}

public func toJourneyRoadKind(_ record: JourneyRoadKindRecord) -> JourneyRoadKind {
    JourneyRoadKind(
        id: record.id, tripId: record.tripId, locationAId: record.locationAId,
        locationBId: record.locationBId, kind: record.kind
    )
}

/// Sorts locations by name and placements by `(date, order)`, matching `getTripWithDetails`
/// (`src/lib/db/index.ts:81`), so derived output is identical to what the web app produces from the
/// same data.
public func toTripWithDetails(_ record: TripRecord) throws(StoreMappingError) -> TripWithDetails {
    let locations = try (record.locations ?? [])
        .sorted { $0.name < $1.name }
        .map(toLocation)
    let placements = (record.placements ?? [])
        .sorted { $0.date == $1.date ? $0.order < $1.order : $0.date < $1.date }
        .map(toPlacement)
    let journeyRoadKinds = (record.journeyRoadKinds ?? []).map(toJourneyRoadKind)

    return TripWithDetails(
        id: record.id, name: record.name, sourceUrl: record.sourceUrl, startDate: record.startDate,
        endDate: record.endDate, dayLabels: record.dayLabels, roadProfile: record.roadProfile,
        transitCaveatDismissed: record.transitCaveatDismissed, hasJrPass: record.hasJrPass,
        createdAt: record.createdAt, updatedAt: record.updatedAt, locations: locations,
        placements: placements, journeyRoadKinds: journeyRoadKinds
    )
}

// MARK: - Domain → records

func makeLocationRecord(from location: Location) -> LocationRecord {
    let base = location.base
    let record = LocationRecord(id: base.id, tripId: base.tripId, name: base.name)
    record.address = base.address
    record.lat = base.lat
    record.lng = base.lng
    record.placeId = base.placeId
    record.excluded = base.excluded
    record.note = base.note
    record.rating = base.rating
    record.reviewCount = base.reviewCount
    record.categories = base.categories
    record.visitDuration = base.visitDuration
    record.openTime = base.openTime
    record.closeTime = base.closeTime
    record.hoursJson = base.hoursJson
    record.phone = base.phone
    record.enrichmentStatus = base.enrichmentStatus
    record.enrichmentError = base.enrichmentError

    switch location {
    case .activity:
        record.kind = .activity
    case .transit(let transit):
        record.kind = .transit
        record.arriveAt = transit.arriveAt
        record.departAt = transit.departAt
    case .lodging(let lodging):
        record.kind = .lodging
        record.checkInDate = lodging.checkInDate
        record.checkOutDate = lodging.checkOutDate
    }
    return record
}

func makePlacementRecord(from placement: Placement) -> PlacementRecord {
    PlacementRecord(
        id: placement.id, tripId: placement.tripId, locationId: placement.locationId,
        date: placement.date, order: placement.order
    )
}

func makeJourneyRoadKindRecord(from kind: JourneyRoadKind) -> JourneyRoadKindRecord {
    let record = JourneyRoadKindRecord(
        id: kind.id, tripId: kind.tripId, locationAId: kind.locationAId, locationBId: kind.locationBId
    )
    record.kind = kind.kind
    return record
}

/// Inserts a whole Trip graph (used by `seedIfEmpty` today; `createTrip` in a later slice reuses
/// it). Not a general "apply a domain value onto the store" — ADR-0041 rejected building a merge
/// engine, so this is only ever used to create a trip that doesn't exist yet, never to reconcile
/// one that does.
@discardableResult
func insertTripRecord(from trip: TripWithDetails, into context: ModelContext) -> TripRecord {
    let record = TripRecord(id: trip.id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate)
    record.sourceUrl = trip.sourceUrl
    record.dayLabels = trip.dayLabels
    record.roadProfile = trip.roadProfile
    record.transitCaveatDismissed = trip.transitCaveatDismissed
    record.hasJrPass = trip.hasJrPass
    record.createdAt = trip.createdAt
    record.updatedAt = trip.updatedAt
    context.insert(record)

    for location in trip.locations {
        let locationRecord = makeLocationRecord(from: location)
        locationRecord.trip = record
        context.insert(locationRecord)
    }
    for placement in trip.placements {
        let placementRecord = makePlacementRecord(from: placement)
        placementRecord.trip = record
        context.insert(placementRecord)
    }
    for kind in trip.journeyRoadKinds {
        let kindRecord = makeJourneyRoadKindRecord(from: kind)
        kindRecord.trip = record
        context.insert(kindRecord)
    }
    return record
}
