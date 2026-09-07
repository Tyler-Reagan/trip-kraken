import Foundation

// Ported from `src/types/index.ts` (ADR-0015). One place primitive, `Location`, is a discriminated
// union over `kind` (activity / transit / lodging); intrinsic temporal facts are *fields* on the
// typed Location (optimizer inputs), and the plan is the optimizer's *output* (`Placement`, in
// `Trip.swift`). Roles and anchors are derived adjectives, never stored.
//
// TypeScript expresses each kind as an intersection of a shared `LocationBase` with kind-specific
// fields, so `location.name` works on every variant without narrowing first. Swift's enums don't
// flatten associated values the same way, so each case wraps a concrete struct that itself carries
// `base: LocationBase`, and `Location` forwards `.base` (and `.id`, for `Identifiable`) rather than
// re-declaring every base field as a passthrough — see `base` below.

/// Fields every Location carries, independent of kind.
public struct LocationBase: Sendable, Hashable, Codable {
    public var id: String
    public var tripId: String
    public var name: String
    public var address: String?
    public var lat: Double?
    public var lng: Double?
    public var placeId: String?
    public var excluded: Bool
    /// Free text; also where a placement's notes live (#20).
    public var note: String?
    public var rating: Double?
    public var reviewCount: Int?
    /// Places `types[]`, enrichment metadata — never the authority for `kind`.
    public var categories: [String]?
    /// Estimated visit time in minutes.
    public var visitDuration: Int?
    /// "HH:MM" 24-hour, Monday-representative, used by the optimizer.
    public var openTime: String?
    public var closeTime: String?
    public var hoursJson: [String: DayHours]?
    public var phone: String?
    public var enrichmentStatus: EnrichmentStatus
    /// Why the last enrichment attempt failed; nil unless `enrichmentStatus == .failed`.
    public var enrichmentError: String?

    public init(
        id: String, tripId: String, name: String, address: String? = nil, lat: Double? = nil,
        lng: Double? = nil, placeId: String? = nil, excluded: Bool = false, note: String? = nil,
        rating: Double? = nil, reviewCount: Int? = nil, categories: [String]? = nil,
        visitDuration: Int? = nil, openTime: String? = nil, closeTime: String? = nil,
        hoursJson: [String: DayHours]? = nil, phone: String? = nil,
        enrichmentStatus: EnrichmentStatus = .pending, enrichmentError: String? = nil
    ) {
        self.id = id
        self.tripId = tripId
        self.name = name
        self.address = address
        self.lat = lat
        self.lng = lng
        self.placeId = placeId
        self.excluded = excluded
        self.note = note
        self.rating = rating
        self.reviewCount = reviewCount
        self.categories = categories
        self.visitDuration = visitDuration
        self.openTime = openTime
        self.closeTime = closeTime
        self.hoursJson = hoursJson
        self.phone = phone
        self.enrichmentStatus = enrichmentStatus
        self.enrichmentError = enrichmentError
    }
}

/// Keys "0"–"6" (Sun–Sat) index into `LocationBase.hoursJson`.
public struct DayHours: Sendable, Hashable, Codable {
    public var open: String
    public var close: String?

    public init(open: String, close: String?) {
        self.open = open
        self.close = close
    }
}

public enum EnrichmentStatus: String, Sendable, Hashable, Codable {
    case done, pending, failed
}

/// A plain place to visit — the default kind; carries no temporal constraint, and is the only kind
/// that is *placed* into the plan.
public struct Activity: Sendable, Hashable, Codable {
    public var base: LocationBase

    public init(base: LocationBase) {
        self.base = base
    }
}

/// A transport node (flight, train, …) — a Location you pass through. `arriveAt`/`departAt` are the
/// kind-elevating gesture (ADR-0028), the same way a Lodging's dates are: either present makes this
/// kind. At most one Location per Trip carries each, enforced at write time — so a Location carrying
/// `arriveAt` simply *is* the trip's arrival, with no earliest/latest rule to apply.
///
/// `authored` (ADR-0035, CONTEXT.md's Authored/surfaced) tells the two ways this kind reaches the
/// read model apart: `true` for a real database row, `false` for a station `surfacedTransitOf`
/// projects from a Journey's Path chain — never a database row.
public struct Transit: Sendable, Hashable, Codable {
    public var base: LocationBase
    public var authored: Bool
    public var arriveAt: IsoDateTime?
    public var departAt: IsoDateTime?

    public init(base: LocationBase, authored: Bool, arriveAt: IsoDateTime? = nil, departAt: IsoDateTime? = nil) {
        self.base = base
        self.authored = authored
        self.arriveAt = arriveAt
        self.departAt = departAt
    }
}

/// A place you sleep. Half-open: you sleep the nights in `[checkInDate, checkOutDate)`.
public struct Lodging: Sendable, Hashable, Codable {
    public var base: LocationBase
    public var checkInDate: IsoDate
    public var checkOutDate: IsoDate

    public init(base: LocationBase, checkInDate: IsoDate, checkOutDate: IsoDate) {
        self.base = base
        self.checkInDate = checkInDate
        self.checkOutDate = checkOutDate
    }
}

/// The single place primitive (ADR-0015 §1) — a discriminated union narrowed on the case itself
/// rather than a separate `kind` field, since the enum case *is* the discriminant in Swift.
public enum Location: Sendable, Hashable {
    case activity(Activity)
    case transit(Transit)
    case lodging(Lodging)

    /// The fields every Location carries, regardless of kind. TypeScript gets this for free by
    /// flattening an intersection type; Swift's enum cases don't flatten, so this is the one
    /// forwarding seam callers reach through (`location.base.name`) instead of switching on every
    /// read.
    public var base: LocationBase {
        switch self {
        case .activity(let a): a.base
        case .transit(let t): t.base
        case .lodging(let l): l.base
        }
    }

    public var asActivity: Activity? {
        if case .activity(let a) = self { a } else { nil }
    }
    public var asTransit: Transit? {
        if case .transit(let t) = self { t } else { nil }
    }
    public var asLodging: Lodging? {
        if case .lodging(let l) = self { l } else { nil }
    }
}

extension Location: Identifiable {
    public var id: String { base.id }
}

/// A role a Location plays in a trip — a *derived adjective*, never stored (ADR-0015 §4). `lodging`
/// is intrinsic to the case; `arrival`/`departure` are reflected straight off a Transit Location's
/// own constraint fields (ADR-0028). An empty role list is a plain candidate.
public enum LocationRole: Sendable, Hashable {
    case lodging, arrival, departure
}

/// Roles derived for a single Location (ADR-0015 §4, ADR-0028).
public func rolesOf(_ location: Location) -> [LocationRole] {
    switch location {
    case .lodging:
        return [.lodging]
    case .transit(let t):
        var roles: [LocationRole] = []
        if t.arriveAt != nil { roles.append(.arrival) }
        if t.departAt != nil { roles.append(.departure) }
        return roles
    case .activity:
        return []
    }
}
