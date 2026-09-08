import Foundation

// ADR-0040: a CloudKit-compliant SwiftData schema drops three DB-level uniqueness guarantees
// (`trip_name_unique`, ADR-0028's "at most one arrival/departure Location per Trip", and
// `JourneyRoadKind`'s composite per-pair uniqueness). This file is where they become app-level
// validation instead — pure functions over values, ported from the corresponding write paths in
// `src/lib/db/index.ts`. None of these take a `ModelContext` or perform I/O; two return a *plan*
// (what else the store must change) rather than performing the write, since that's the part worth
// testing on its own.

// MARK: - Trip name collision (replaces `trip_name_unique`)

/// The store's view of a trip, without pulling its full location/placement graph — what
/// `checkTripNameCollision` needs and nothing more.
public struct TripSummary: Sendable, Hashable {
    public var id: String
    public var name: String
    public var createdAt: Date
    public var locationCount: Int

    public init(id: String, name: String, createdAt: Date, locationCount: Int) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.locationCount = locationCount
    }
}

public struct TripNameCollision: Sendable, Hashable {
    /// Every existing trip sharing this exact name — plural, because without the DB index more
    /// than one can now legitimately exist.
    public var existingTrips: [TripSummary]
    /// Finder-style disambiguation, from `dedupeName`.
    public var suggestedName: String

    public init(existingTrips: [TripSummary], suggestedName: String) {
        self.existingTrips = existingTrips
        self.suggestedName = suggestedName
    }
}

/// Port of `checkTripNameCollision` (`src/lib/db/index.ts:198-207`). `nil` means no collision.
/// Advisory, not enforcing: the DB index that used to make a duplicate name impossible is gone
/// (ADR-0040), so a caller must tolerate a duplicate existing rather than assume this prevented one.
public func checkTripNameCollision(name: String, existing: [TripSummary]) -> TripNameCollision? {
    let matches = existing.filter { $0.name == name }
    guard !matches.isEmpty else { return nil }
    return TripNameCollision(
        existingTrips: matches,
        suggestedName: dedupeName(name, existingNames: existing.map(\.name))
    )
}

// MARK: - Trip edges (replaces `arrival_per_trip` / `departure_per_trip`, ADR-0028 §2)

public enum TripEdge: String, Sendable, Hashable {
    case arrival, departure
}

public enum TransitValidationError: Error, Sendable, Hashable {
    case invalidTime(String)
    case locationNotInTrip(String)
}

/// Matches TS's `/^\d{2}:\d{2}$/` exactly — two digits, a colon, two digits, no range check (a
/// caller-side format guard, not a real-time validator).
private func isValidHHMM(_ time: String) -> Bool {
    let chars = Array(time)
    guard chars.count == 5, chars[2] == ":" else { return false }
    return chars[0].isNumber && chars[1].isNumber && chars[3].isNumber && chars[4].isNumber
}

/// What the store must do to make `locationId` this trip's `edge`, in one save. Port of
/// `setTripArrival`/`setTripDeparture` (`src/lib/db/index.ts:622-683`).
public struct TripEdgeAssignment: Sendable, Hashable {
    /// The value to write onto the new holder: the trip's own first/last date, plus the time if
    /// one was given. Never taken from the caller directly — always derived fresh from the trip.
    public var isoDateTime: IsoDateTime
    /// The Location that held this edge before, if any — must be cleared in the same save.
    public var releasedLocationId: String?
    /// True when clearing the released holder's field leaves it with neither edge, so it demotes
    /// to `kind: activity`. Mirrors `setTripArrival`'s `holder.departAt == null` branch.
    public var releasedBecomesActivity: Bool

    public init(isoDateTime: IsoDateTime, releasedLocationId: String?, releasedBecomesActivity: Bool) {
        self.isoDateTime = isoDateTime
        self.releasedLocationId = releasedLocationId
        self.releasedBecomesActivity = releasedBecomesActivity
    }
}

public func planTripEdgeAssignment(
    _ trip: TripWithDetails, edge: TripEdge, locationId: String, time: String?
) throws(TransitValidationError) -> TripEdgeAssignment {
    if let time, !isValidHHMM(time) {
        throw .invalidTime(time)
    }
    guard trip.locations.contains(where: { $0.id == locationId }) else {
        throw .locationNotInTrip(locationId)
    }
    let baseDate = edge == .arrival ? trip.startDate : trip.endDate
    let isoDateTime: IsoDateTime = time.map { "\(baseDate)T\($0)" } ?? baseDate

    let holder = trip.locations.compactMap(\.asTransit).first { t in
        t.base.id != locationId && (edge == .arrival ? t.arriveAt != nil : t.departAt != nil)
    }
    let releasedBecomesActivity = holder.map {
        (edge == .arrival ? $0.departAt : $0.arriveAt) == nil
    } ?? false

    return TripEdgeAssignment(
        isoDateTime: isoDateTime,
        releasedLocationId: holder?.base.id,
        releasedBecomesActivity: releasedBecomesActivity
    )
}

/// Port of `clearTripEdge` (`src/lib/db/index.ts:690-710`). Notably tolerant like its TS original:
/// it only requires the Location to exist in the trip, not that it's currently a Transit or that
/// the named edge is actually set on it — a non-transit Location's "current" fields are both nil,
/// so clearing either relegates trivially (a correct no-op, not an error).
public struct TripEdgeClear: Sendable, Hashable {
    public var relegateToActivity: Bool
    public init(relegateToActivity: Bool) { self.relegateToActivity = relegateToActivity }
}

public func planTripEdgeClear(
    _ trip: TripWithDetails, edge: TripEdge, locationId: String
) throws(TransitValidationError) -> TripEdgeClear {
    guard let location = trip.locations.first(where: { $0.id == locationId }) else {
        throw .locationNotInTrip(locationId)
    }
    let transit = location.asTransit
    let otherFieldSet = edge == .arrival ? (transit?.departAt != nil) : (transit?.arriveAt != nil)
    return TripEdgeClear(relegateToActivity: !otherFieldSet)
}

/// The invariant stated as a check, for tests and a debug assertion after a write. The partial
/// unique indexes used to make this unrepresentable; now it is merely false. `tripEdgesOf`
/// (`Trip.swift:165`) silently picks `.first` when this is violated, so catching it in debug
/// builds is what keeps that honest.
public enum TripEdgeViolation: Sendable, Hashable {
    case multipleArrivals([String])
    case multipleDepartures([String])
}

public func tripEdgeViolations(_ trip: TripWithDetails) -> [TripEdgeViolation] {
    let transits = trip.locations.compactMap(\.asTransit)
    var violations: [TripEdgeViolation] = []
    let arrivals = transits.filter { $0.arriveAt != nil }.map(\.base.id)
    if arrivals.count > 1 { violations.append(.multipleArrivals(arrivals)) }
    let departures = transits.filter { $0.departAt != nil }.map(\.base.id)
    if departures.count > 1 { violations.append(.multipleDepartures(departures)) }
    return violations
}

// MARK: - JourneyRoadKind pair uniqueness (replaces `journey_road_kind_unique`)

/// Canonical (unordered) key — sorted, so `(a, b)` and `(b, a)` land on the same row. The read-side
/// mirror already exists as `journeyRoadKindFor` in `PathPairs.swift`; this is the write side, port
/// of `canonicalJourneyPair` (`src/lib/db/index.ts:113-117`).
public func canonicalJourneyPair(_ a: String, _ b: String) -> (locationAId: String, locationBId: String) {
    a < b ? (a, b) : (b, a)
}

/// What the store must do to set (or clear) one Journey's chosen kind, in one save. Port of
/// `setJourneyRoadKind` (`src/lib/db/index.ts:353-394`).
public struct JourneyRoadKindWrite: Sendable, Hashable {
    /// Rows to remove: the cleared row when `kind` is nil, or *duplicate* rows for this pair —
    /// which the DB index used to make impossible and app-level validation now has to clean up.
    public var deleteIds: [String]
    /// The surviving row to update in place, if one exists.
    public var updateId: String?
    /// The row to create when none exists. Canonicalized already.
    public var insert: JourneyRoadKind?

    public init(deleteIds: [String], updateId: String?, insert: JourneyRoadKind?) {
        self.deleteIds = deleteIds
        self.updateId = updateId
        self.insert = insert
    }
}

/// `newId` is an autoclosure so the function stays pure-by-inspection and a test can pass a fixed
/// id; it's only evaluated on the insert path.
public func planJourneyRoadKindWrite(
    _ kinds: [JourneyRoadKind], tripId: String, newId: @autoclosure () -> String,
    from: String, to: String, kind: RoadProfile?
) -> JourneyRoadKindWrite {
    let (a, b) = canonicalJourneyPair(from, to)
    let matches = kinds.filter { $0.tripId == tripId && $0.locationAId == a && $0.locationBId == b }

    guard let kind else {
        return JourneyRoadKindWrite(deleteIds: matches.map(\.id), updateId: nil, insert: nil)
    }
    if let first = matches.first {
        return JourneyRoadKindWrite(deleteIds: matches.dropFirst().map(\.id), updateId: first.id, insert: nil)
    }
    return JourneyRoadKindWrite(
        deleteIds: [],
        updateId: nil,
        insert: JourneyRoadKind(id: newId(), tripId: tripId, locationAId: a, locationBId: b, kind: kind)
    )
}

// MARK: - Lodging validation (not one of ADR-0040's three, but the same slice needs it)

/// Port of `LodgingValidationError`/`setLodgingDates` (`src/lib/db/index.ts:500-549`).
public enum LodgingValidationError: Error, Sendable, Hashable {
    case unparseableDate(IsoDate)
    case checkInNotBeforeCheckOut
    case outsideTripDates(tripStart: IsoDate, tripEnd: IsoDate)
    case locationNotInTrip(String)
    case overlapsExistingLodging(locationId: String)
}

private func isValidIsoDate(_ date: IsoDate) -> Bool {
    let parts = date.split(separator: "-")
    guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
        let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
        (1...12).contains(month), (1...31).contains(day)
    else { return false }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    var components = DateComponents()
    (components.year, components.month, components.day) = (year, month, day)
    guard let parsed = calendar.date(from: components) else { return false }
    let recomputed = calendar.dateComponents([.year, .month, .day], from: parsed)
    return recomputed.year == year && recomputed.month == month && recomputed.day == day
}

/// Half-open `[checkIn, checkOut)`: adjacent same-day switches (one lodging's checkout is
/// another's check-in) are fine, genuine overlaps are not. Throws rather than returning a plan —
/// unlike the two invariants above, there's nothing else for the store to do besides the write
/// itself once this passes.
public func validateLodgingDates(
    _ trip: TripWithDetails, locationId: String, checkInDate: IsoDate, checkOutDate: IsoDate
) throws(LodgingValidationError) {
    guard isValidIsoDate(checkInDate) else { throw .unparseableDate(checkInDate) }
    guard isValidIsoDate(checkOutDate) else { throw .unparseableDate(checkOutDate) }
    guard checkInDate < checkOutDate else { throw .checkInNotBeforeCheckOut }
    guard checkInDate <= trip.endDate && checkOutDate > trip.startDate else {
        throw .outsideTripDates(tripStart: trip.startDate, tripEnd: trip.endDate)
    }
    guard trip.locations.contains(where: { $0.id == locationId }) else {
        throw .locationNotInTrip(locationId)
    }
    let others = trip.locations.compactMap(\.asLodging).filter { $0.base.id != locationId }
    for other in others {
        if checkInDate < other.checkOutDate && other.checkInDate < checkOutDate {
            throw .overlapsExistingLodging(locationId: other.base.id)
        }
    }
}
