import Foundation
import SwiftData
import TripKrakenKit

/// ADR-0040: written CloudKit-compliant from day one even though `cloudKitDatabase` stays `.none`
/// (sync is not enabled by this ADR). Three rules hold everywhere in this file, and a reviewer
/// should be able to check them by eye:
///   1. no `@Attribute(.unique)` — the three lost DB-level guarantees are app-level validation in
///      `TripKrakenKit` (`TripInvariants.swift`) instead;
///   2. every relationship is optional;
///   3. every non-optional *attribute* carries a default. An attribute that's already `Optional`
///      needs no default of its own — CloudKit's rule is "optional or defaulted," not "optional
///      and defaulted," so this file doesn't force domain-optional fields into defaulted
///      non-optionals just to look uniform.
/// Nothing else here bends for CloudKit: sync isn't scheduled, so beyond these three rules the
/// schema is built like an ordinary local-only store.
///
/// `Location` is a Swift enum with associated values; SwiftData can't model that as a relationship.
/// `LocationRecord` mirrors what `src/lib/db/schema.ts` already does instead — one table, a `kind`
/// discriminator, and nullable subtype columns (`checkInDate`/`checkOutDate` for lodging,
/// `arriveAt`/`departAt` for transit) — which makes `toLocation` (`TripMapping.swift`) a close port
/// of the TS `toLocation` (`src/lib/db/index.ts:49-64`). `@Model` class inheritance was rejected as
/// the alternative: it's recent and specifically fraught under CloudKit, the exact risk ADR-0040
/// spent its budget avoiding.
///
/// Only `Trip → children` are SwiftData relationships, matching the three SQLite
/// `ON DELETE CASCADE` foreign keys. `Placement.locationId` and `JourneyRoadKind.locationAId/BId`
/// stay plain `String` ids on their own merits, not as a CloudKit accommodation: a
/// `JourneyRoadKindRecord` naming `LocationRecord` twice would force two disambiguating inverse
/// arrays onto it, and the domain structs are id-based already, so a relationship would only be
/// un-mapped back to an id on every read. The Location→Placement/JourneyRoadKind cascade this loses
/// becomes an explicit, tested step in `TripStore.deleteLocation`.
///
/// Enum-valued columns store their `rawValue` as a plain `String` rather than the enum itself —
/// keeps `#Predicate` usable over them, and makes an unknown future raw value a decode-time
/// fallback (see the computed accessors below) rather than a store that refuses to open.

public enum LocationKind: String, Sendable, Codable {
    case activity, transit, lodging
}

@Model
public final class TripRecord {
    public var id: String = ""
    public var name: String = ""
    public var sourceUrl: String?
    public var startDate: String = ""
    public var endDate: String = ""
    public var dayLabels: [String: String]?
    public var roadProfileRaw: String = RoadProfile.walking.rawValue
    public var transitCaveatDismissed: Bool = false
    public var hasJrPass: Bool = false
    public var createdAt: Date = Date.distantPast
    public var updatedAt: Date = Date.distantPast
    /// User-controlled display order for the trip switcher — see `TripStore.reorderTrips`. Defaults
    /// to 0 so every pre-existing row (lightweight-migrated) sorts first, ahead of anything newly
    /// created; `TripStore` is the only writer of a non-zero value.
    public var sortOrder: Int = 0

    @Relationship(deleteRule: .cascade, inverse: \LocationRecord.trip)
    public var locations: [LocationRecord]?
    @Relationship(deleteRule: .cascade, inverse: \PlacementRecord.trip)
    public var placements: [PlacementRecord]?
    @Relationship(deleteRule: .cascade, inverse: \JourneyRoadKindRecord.trip)
    public var journeyRoadKinds: [JourneyRoadKindRecord]?

    public var roadProfile: RoadProfile {
        get { RoadProfile(rawValue: roadProfileRaw) ?? .walking }
        set { roadProfileRaw = newValue.rawValue }
    }

    public init(id: String, name: String, startDate: String, endDate: String) {
        self.id = id
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
    }
}

@Model
public final class LocationRecord {
    public var id: String = ""
    /// Denormalized alongside the `trip` relationship deliberately: the relationship exists for the
    /// cascade, this exists so mapping and `#Predicate` fetches never have to traverse it.
    public var tripId: String = ""
    public var kindRaw: String = LocationKind.activity.rawValue
    public var name: String = ""
    public var address: String?
    public var lat: Double?
    public var lng: Double?
    public var placeId: String?
    public var excluded: Bool = false
    public var note: String?
    public var rating: Double?
    public var reviewCount: Int?
    public var categories: [String]?
    public var visitDuration: Int?
    public var openTime: String?
    public var closeTime: String?
    public var hoursJson: [String: DayHours]?
    public var phone: String?
    public var enrichmentStatusRaw: String = EnrichmentStatus.pending.rawValue
    public var enrichmentError: String?

    // Lodging subtype columns (ADR-0015 §2). Non-nil exactly when kind == .lodging.
    public var checkInDate: String?
    public var checkOutDate: String?
    // Transit subtype columns (ADR-0028). Either non-nil makes the kind transit.
    public var arriveAt: String?
    public var departAt: String?

    public var trip: TripRecord?

    public var kind: LocationKind {
        get { LocationKind(rawValue: kindRaw) ?? .activity }
        set { kindRaw = newValue.rawValue }
    }

    public var enrichmentStatus: EnrichmentStatus {
        get { EnrichmentStatus(rawValue: enrichmentStatusRaw) ?? .pending }
        set { enrichmentStatusRaw = newValue.rawValue }
    }

    public init(id: String, tripId: String, name: String) {
        self.id = id
        self.tripId = tripId
        self.name = name
    }
}

@Model
public final class PlacementRecord {
    public var id: String = ""
    public var tripId: String = ""
    /// By id, not a relationship — see the file header.
    public var locationId: String = ""
    public var date: String = ""
    public var order: Int = 0

    public var trip: TripRecord?

    public init(id: String, tripId: String, locationId: String, date: String, order: Int) {
        self.id = id
        self.tripId = tripId
        self.locationId = locationId
        self.date = date
        self.order = order
    }
}

@Model
public final class JourneyRoadKindRecord {
    public var id: String = ""
    public var tripId: String = ""
    /// Canonicalized (lexicographically sorted) at the write path by `canonicalJourneyPair` — the
    /// DB index that used to enforce one row per pair is gone (ADR-0040), so
    /// `planJourneyRoadKindWrite` is now the only thing keeping this single-valued.
    public var locationAId: String = ""
    public var locationBId: String = ""
    public var kindRaw: String = RoadProfile.walking.rawValue

    public var trip: TripRecord?

    public var kind: RoadProfile {
        get { RoadProfile(rawValue: kindRaw) ?? .walking }
        set { kindRaw = newValue.rawValue }
    }

    public init(id: String, tripId: String, locationAId: String, locationBId: String) {
        self.id = id
        self.tripId = tripId
        self.locationAId = locationAId
        self.locationBId = locationBId
    }
}
