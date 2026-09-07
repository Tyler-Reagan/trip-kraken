import Foundation

// Ported from `src/types/index.ts`. Trip, Placement, and the derived-Timeline projection
// (ADR-0015, widened by ADR-0028) — day-presence is derived, never stored.

/// A calendar date, "YYYY-MM-DD". A plain `String`, never a `Date` — date-only facts must not drift
/// across timezones, and ISO date strings sort and compare chronologically as-is.
public typealias IsoDate = String

/// A calendar date, or a calendar date plus a time — "2026-09-14" or "2026-09-14T14:00". Local, no
/// timezone, extending the `IsoDate` convention one field wider (ADR-0028 §3). The precision is
/// meaningful: a bare date designates a trip edge with no known time, a date-and-time designates it
/// *and* constrains that Day's window.
public typealias IsoDateTime = String

/// The plan's stored unit (ADR-0015 §2): an activity placed on a date, ordered within that date.
/// Only activities are placed — lodging/transit day-presence is derived.
public struct Placement: Sendable, Hashable, Codable {
    public var id: String
    public var tripId: String
    public var locationId: String
    public var date: IsoDate
    public var order: Int

    public init(id: String, tripId: String, locationId: String, date: IsoDate, order: Int) {
        self.id = id
        self.tripId = tripId
        self.locationId = locationId
        self.date = date
        self.order = order
    }
}

/// A rider's chosen road kind for one Journey (issue #209/#217) — consulted at matrix-build time so
/// a Journey with a choice uses this kind instead of the Trip's `roadProfile` default. Keyed by
/// Location pair, stored unordered: `locationAId`/`locationBId` are canonicalized (sorted) at the
/// write path, so they don't correspond to a particular travel direction.
public struct JourneyRoadKind: Sendable, Hashable, Codable {
    public var id: String
    public var tripId: String
    public var locationAId: String
    public var locationBId: String
    public var kind: RoadProfile

    public init(id: String, tripId: String, locationAId: String, locationBId: String, kind: RoadProfile) {
        self.id = id
        self.tripId = tripId
        self.locationAId = locationAId
        self.locationBId = locationBId
        self.kind = kind
    }
}

public struct TripWithDetails: Sendable, Hashable {
    public var id: String
    public var name: String
    /// Nullable for blank-slate trips (ADR-0010).
    public var sourceUrl: String?
    /// The single required temporal axis (ADR-0015 §3).
    public var startDate: IsoDate
    public var endDate: IsoDate
    /// A day's optional label; days are not an entity.
    public var dayLabels: [IsoDate: String]?
    /// Which OSRM profile answers this Trip's road cells (ADR-0024, amended 2026-08-11).
    public var roadProfile: RoadProfile
    /// Whether the estimated-transit-timing caveat (#130) has been dismissed.
    public var transitCaveatDismissed: Bool
    /// Gates the OSM-Japan provider's graph search to JR-group-only (issue #211).
    public var hasJrPass: Bool
    public var createdAt: Date
    public var updatedAt: Date
    public var locations: [Location]
    public var placements: [Placement]
    public var journeyRoadKinds: [JourneyRoadKind]

    public init(
        id: String, name: String, sourceUrl: String?, startDate: IsoDate, endDate: IsoDate,
        dayLabels: [IsoDate: String]?, roadProfile: RoadProfile, transitCaveatDismissed: Bool,
        hasJrPass: Bool, createdAt: Date, updatedAt: Date, locations: [Location],
        placements: [Placement], journeyRoadKinds: [JourneyRoadKind]
    ) {
        self.id = id
        self.name = name
        self.sourceUrl = sourceUrl
        self.startDate = startDate
        self.endDate = endDate
        self.dayLabels = dayLabels
        self.roadProfile = roadProfile
        self.transitCaveatDismissed = transitCaveatDismissed
        self.hasJrPass = hasJrPass
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.locations = locations
        self.placements = placements
        self.journeyRoadKinds = journeyRoadKinds
    }
}

// `Location` is an enum with associated values, so it needs its own Codable conformance rather than
// inheriting whatever `TripWithDetails` might synthesize — deliberately deferred. The shape a future
// networking layer decodes from the BFF is a flat, kind-tagged JSON object (ADR-0038 keeps that BFF
// in place for Phase A); this domain model shouldn't pre-guess that DTO shape before it exists, so
// `Location` and `Path` (and anything holding one) are `Sendable`/`Hashable` only for now. Hashable
// synthesis still applies to `TripWithDetails` itself, since `Location` is Hashable even though it
// isn't Codable.

// ─── Derivation helpers (one shared projection rule) ──────────────────────────

private let utcCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}()

private func parseIsoDate(_ date: IsoDate) -> Date {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    precondition(parts.count == 3, "IsoDate must be \"YYYY-MM-DD\", got \(date)")
    var components = DateComponents()
    (components.year, components.month, components.day) = (parts[0], parts[1], parts[2])
    guard let parsed = utcCalendar.date(from: components) else {
        preconditionFailure("invalid IsoDate: \(date)")
    }
    return parsed
}

private func formatIsoDate(_ date: Date) -> IsoDate {
    let c = utcCalendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

/// Add `n` days to an ISO date, returning ISO (UTC math avoids DST drift).
public func addDaysIso(_ date: IsoDate, _ n: Int) -> IsoDate {
    formatIsoDate(utcCalendar.date(byAdding: .day, value: n, to: parseIsoDate(date))!)
}

/// The trip's day count — derived from the required date range (inclusive of both ends).
public func numDaysOf(startDate: IsoDate, endDate: IsoDate) -> Int {
    utcCalendar.dateComponents([.day], from: parseIsoDate(startDate), to: parseIsoDate(endDate)).day! + 1
}

/// Every calendar date of the trip, in order — the basis for day-clustering the plan.
public func tripDates(startDate: IsoDate, endDate: IsoDate) -> [IsoDate] {
    (0..<numDaysOf(startDate: startDate, endDate: endDate)).map { addDaysIso(startDate, $0) }
}

/// 1-based day number a date falls on (Day 1 = startDate); the derived day-number label.
public func dayNumberOf(startDate: IsoDate, date: IsoDate) -> Int {
    utcCalendar.dateComponents([.day], from: parseIsoDate(startDate), to: parseIsoDate(date)).day! + 1
}

/// Does this lodging cover the night of `date`? Half-open `[checkInDate, checkOutDate)`.
public func lodgingCoversNight(_ l: Lodging, _ date: IsoDate) -> Bool {
    l.checkInDate <= date && date < l.checkOutDate
}

/// The lodging you sleep under on `date`, if any — the derived day-presence projection that replaces
/// stored stay rows (ADR-0015 §2). Bookings don't overlap, so at most one matches.
public func lodgingOnNight(_ lodgings: [Lodging], on date: IsoDate) -> Lodging? {
    lodgings.first { lodgingCoversNight($0, date) }
}

/// The Trip's two edges (ADR-0028) — at most one Location carries `arriveAt`, one carries
/// `departAt`, by construction. Either may be the same Location (a round trip through one airport),
/// and either may be absent.
public func tripEdgesOf(_ trip: TripWithDetails) -> (arrival: Transit?, departure: Transit?) {
    let transits = trip.locations.compactMap(\.asTransit)
    return (
        arrival: transits.first { $0.arriveAt != nil },
        departure: transits.first { $0.departAt != nil }
    )
}

// ─── The Timeline projection (ADR-0015: day-presence is derived, never stored) ──

/// A Location that bookends a Day (ADR-0028, CONTEXT.md's "Anchor") — projected from a constraint
/// field, never stored. Only a Lodging or a Transit Location can be an Anchor; an Activity never is
/// — narrower than the general `Location` union on purpose, matching the TS `Lodging | Transit`
/// annotation this type replaces.
public enum Anchor: Sendable, Hashable {
    case lodging(Lodging)
    case transit(Transit)

    public var base: LocationBase {
        switch self {
        case .lodging(let l): l.base
        case .transit(let t): t.base
        }
    }

    /// Widens back to the general `Location` union — for a render surface (`pathPairs.ts`'s
    /// `dayChainEntries`) that wants one uniform type across Anchors and Placements alike.
    public var asLocation: Location {
        switch self {
        case .lodging(let l): .lodging(l)
        case .transit(let t): .transit(t)
        }
    }
}

/// A placed activity, joined to its Location for rendering.
public struct ScheduledStop: Sendable, Hashable {
    public var placement: Placement
    public var location: Activity

    public init(placement: Placement, location: Activity) {
        self.placement = placement
        self.location = location
    }
}

/// One day of the plan, projected from the trip's date range, placements, and lodging/transit
/// constraint fields.
public struct DerivedDay: Sendable, Hashable {
    public var date: IsoDate
    public var dayNumber: Int
    public var label: String?
    public var stops: [ScheduledStop]
    /// Where you woke — the prior night's lodging, or the trip's arrival on day 1 (ADR-0028). Nil
    /// when neither applies.
    public var startAnchor: Anchor?
    /// Where the day ends — the trip's departure on the last day, or the lodging you sleep at when
    /// it differs from where you woke (a travel day). Nil otherwise.
    public var endAnchor: Anchor?
    /// A lodging you sleep at but didn't wake at: visited mid-day to drop bags (ADR-0013). Always a
    /// Lodging — a bag-drop is never a trip edge.
    public var checkInWaypoint: Lodging?

    public init(
        date: IsoDate, dayNumber: Int, label: String?, stops: [ScheduledStop],
        startAnchor: Anchor?, endAnchor: Anchor?, checkInWaypoint: Lodging?
    ) {
        self.date = date
        self.dayNumber = dayNumber
        self.label = label
        self.stops = stops
        self.startAnchor = startAnchor
        self.endAnchor = endAnchor
        self.checkInWaypoint = checkInWaypoint
    }
}

/// Project the stored plan into day-clustered form (ADR-0015, widened by ADR-0028). Days come from
/// the required date range; each day's stops are its placements (ordered); anchors are projected
/// from lodging dates and the trip's arrival/departure Transit via the shared `anchorsOnDate` rule —
/// the same rule the solver's own request-input builder would call. Nothing here is stored; this is
/// the single rule the Timeline and Map both read.
public func deriveTripPlanDays(_ trip: TripWithDetails) -> [DerivedDay] {
    let lodgings = trip.locations.compactMap(\.asLodging)
    let byId = Dictionary(uniqueKeysWithValues: trip.locations.map { ($0.id, $0) })
    let (arrival, departure) = tripEdgesOf(trip)
    let numDays = numDaysOf(startDate: trip.startDate, endDate: trip.endDate)

    func resolveAnchor(_ id: String?) -> Anchor? {
        guard let location = id.flatMap({ byId[$0] }) else { return nil }
        if let lodging = location.asLodging { return .lodging(lodging) }
        if let transit = location.asTransit { return .transit(transit) }
        return nil
    }

    return tripDates(startDate: trip.startDate, endDate: trip.endDate).enumerated().map { i, date in
        let dayNumber = i + 1
        let stops =
            trip.placements
            .filter { $0.date == date }
            .sorted { $0.order < $1.order }
            .compactMap { placement -> ScheduledStop? in
                guard let activity = byId[placement.locationId]?.asActivity else { return nil }
                return ScheduledStop(placement: placement, location: activity)
            }
        let woke = lodgingOnNight(lodgings, on: addDaysIso(date, -1))
        let sleep = lodgingOnNight(lodgings, on: date)
        let anchors = anchorsOnDate(
            dayNumber: dayNumber, numDays: numDays, wokeLodgingId: woke?.base.id,
            sleepLodgingId: sleep?.base.id, arrivalId: arrival?.base.id, departureId: departure?.base.id
        )
        let travelled = sleep != nil && sleep?.base.id != woke?.base.id
        return DerivedDay(
            date: date, dayNumber: dayNumber, label: trip.dayLabels?[date], stops: stops,
            startAnchor: resolveAnchor(anchors.startId), endAnchor: resolveAnchor(anchors.endId),
            checkInWaypoint: travelled ? sleep : nil
        )
    }
}

public struct NearbyPlace: Sendable, Hashable, Codable {
    public var placeId: String
    public var name: String
    public var address: String
    public var lat: Double?
    public var lng: Double?
    public var rating: Double?
    public var reviewCount: Int?
    public var categories: [String]
    /// 0–4.
    public var priceLevel: Int?
    public var distanceMeters: Double?
    /// Route-relative distance from the corridor's origin to this place, sourced from Places API
    /// (New) `routingSummaries` (#107) — nil outside the along-route scope, where it's never
    /// requested. A response data field, not a ranking promise (ADR-0009).
    public var detourMeters: Double?

    public init(
        placeId: String, name: String, address: String, lat: Double?, lng: Double?, rating: Double?,
        reviewCount: Int?, categories: [String], priceLevel: Int?, distanceMeters: Double?,
        detourMeters: Double?
    ) {
        self.placeId = placeId
        self.name = name
        self.address = address
        self.lat = lat
        self.lng = lng
        self.rating = rating
        self.reviewCount = reviewCount
        self.categories = categories
        self.priceLevel = priceLevel
        self.distanceMeters = distanceMeters
        self.detourMeters = detourMeters
    }
}
