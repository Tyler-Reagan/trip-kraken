import Foundation

// Ported from `src/lib/solver.ts`'s wire-facing types (ADR-0045) — `solve()` itself stays
// server-side (VROOM/OSRM, ADR-0038), but its plain-value request/response shapes are exactly the
// kind of thing this module already carries directly as `Codable` (see `PathPair`,
// `PathGeometryProviding.swift`) rather than needing a separate DTO layer: every type here is a
// flat struct or a closed string enum, none of `Location`/`Path`'s discriminated-union decoding
// complexity.

public enum OptimizeLocationKind: String, Sendable, Hashable, Codable {
    case activity, transit, lodging
}

/// Mirrors `LocationInput` (`src/lib/solver.ts`) — what the solver needs from one Location,
/// independent of persistence shape.
public struct OptimizeLocationInput: Sendable, Hashable, Codable {
    public var id: String
    public var lat: Double
    public var lng: Double
    public var visitDuration: Int?
    public var openTime: String?
    public var closeTime: String?
    public var hoursJson: [String: DayHours]?
    public var enrichmentStatus: EnrichmentStatus?
    public var kind: OptimizeLocationKind
    public var arriveAt: IsoDateTime?
    public var departAt: IsoDateTime?

    public init(
        id: String, lat: Double, lng: Double, visitDuration: Int? = nil, openTime: String? = nil,
        closeTime: String? = nil, hoursJson: [String: DayHours]? = nil,
        enrichmentStatus: EnrichmentStatus? = nil, kind: OptimizeLocationKind,
        arriveAt: IsoDateTime? = nil, departAt: IsoDateTime? = nil
    ) {
        self.id = id
        self.lat = lat
        self.lng = lng
        self.visitDuration = visitDuration
        self.openTime = openTime
        self.closeTime = closeTime
        self.hoursJson = hoursJson
        self.enrichmentStatus = enrichmentStatus
        self.kind = kind
        self.arriveAt = arriveAt
        self.departAt = departAt
    }
}

/// A lodging's booking dates reduced to the integer night-range it covers — mirrors `StayPlan`.
public struct OptimizeStayPlan: Sendable, Hashable, Codable {
    public var lodgingId: String
    public var startNight: Int
    public var endNight: Int

    public init(lodgingId: String, startNight: Int, endNight: Int) {
        self.lodgingId = lodgingId
        self.startNight = startNight
        self.endNight = endNight
    }
}

/// Mirrors `OptimizationProblem["edges"]` — at most one arrival id, one departure id.
public struct OptimizeEdges: Sendable, Hashable, Codable {
    public var arrivalId: String?
    public var departureId: String?

    public init(arrivalId: String? = nil, departureId: String? = nil) {
        self.arrivalId = arrivalId
        self.departureId = departureId
    }
}

/// The full request shape `POST /api/optimize` (ADR-0045) takes in its body — mirrors
/// `OptimizationProblem`.
public struct OptimizeProblem: Sendable, Hashable, Codable {
    public var locations: [OptimizeLocationInput]
    public var numDays: Int
    public var stays: [OptimizeStayPlan]
    public var dayBudgetMinutes: Int?
    public var startDate: IsoDate?
    public var kinds: [PathKind]
    public var hasJrPass: Bool
    public var edges: OptimizeEdges
    public var journeyRoadKinds: [JourneyRoadKind]

    public init(
        locations: [OptimizeLocationInput], numDays: Int, stays: [OptimizeStayPlan],
        dayBudgetMinutes: Int? = nil, startDate: IsoDate? = nil, kinds: [PathKind],
        hasJrPass: Bool, edges: OptimizeEdges, journeyRoadKinds: [JourneyRoadKind]
    ) {
        self.locations = locations
        self.numDays = numDays
        self.stays = stays
        self.dayBudgetMinutes = dayBudgetMinutes
        self.startDate = startDate
        self.kinds = kinds
        self.hasJrPass = hasJrPass
        self.edges = edges
        self.journeyRoadKinds = journeyRoadKinds
    }
}

/// Per-Placement arrival/waiting time — free in VROOM's own response. Mirrors `PlacementTiming`.
public struct OptimizePlacementTiming: Sendable, Hashable, Codable {
    public var arrival: Double
    public var waitingSeconds: Double

    public init(arrival: Double, waitingSeconds: Double) {
        self.arrival = arrival
        self.waitingSeconds = waitingSeconds
    }
}

/// Mirrors `DayPlan` — one Day's solved order, parallel-indexed timing.
public struct OptimizeDayPlan: Sendable, Hashable, Codable {
    public var dayNumber: Int
    public var locationIds: [String]
    public var timing: [OptimizePlacementTiming]?

    public init(dayNumber: Int, locationIds: [String], timing: [OptimizePlacementTiming]? = nil) {
        self.dayNumber = dayNumber
        self.locationIds = locationIds
        self.timing = timing
    }
}

/// Mirrors `UnplacedDiagnosis["cause"]`.
public enum UnplacedCause: String, Sendable, Hashable, Codable {
    case dayFull = "day-full"
    case outOfReach = "out-of-reach"
    case afterClosing = "after-closing"
    case beforeOpening = "before-opening"
    case dayTooShort = "day-too-short"
}

/// Mirrors `UnplacedDiagnosis`.
public struct UnplacedDiagnosis: Sendable, Hashable, Codable {
    public var cause: UnplacedCause
    public var seconds: Double?
    public var dayNumber: Int

    public init(cause: UnplacedCause, seconds: Double? = nil, dayNumber: Int) {
        self.cause = cause
        self.seconds = seconds
        self.dayNumber = dayNumber
    }
}

/// Mirrors `Unplaced["code"]`.
public enum UnplacedCode: String, Sendable, Hashable, Codable {
    case ungeocodedPending = "ungeocoded-pending"
    case ungeocodedFailed = "ungeocoded-failed"
    case noLodgingCoverage = "no-lodging-coverage"
    case closedAllDays = "closed-all-days"
    case solver
}

/// An Activity the optimizer could not place, with a reason. Mirrors `Unplaced`.
public struct Unplaced: Sendable, Hashable, Codable {
    public var locationId: String
    public var code: UnplacedCode
    public var reason: String
    public var diagnosis: UnplacedDiagnosis?

    public init(locationId: String, code: UnplacedCode, reason: String, diagnosis: UnplacedDiagnosis? = nil) {
        self.locationId = locationId
        self.code = code
        self.reason = reason
        self.diagnosis = diagnosis
    }
}

/// The response shape `POST /api/optimize` (ADR-0045) returns — mirrors `Itinerary`.
public struct Itinerary: Sendable, Hashable, Codable {
    public var days: [OptimizeDayPlan]
    public var unplaced: [Unplaced]
    public var warnings: [String]

    public init(days: [OptimizeDayPlan], unplaced: [Unplaced], warnings: [String]) {
        self.days = days
        self.unplaced = unplaced
        self.warnings = warnings
    }
}

/// The seam between "what does re-optimizing this trip need" (this module, always available) and
/// "who can actually run the solver" (`TripKrakenRouting`'s `HTTPOptimizeProvider`, ADR-0045) —
/// same split `PathGeometryProviding` already establishes for geometry.
public protocol OptimizeProviding: Sendable {
    func optimize(_ problem: OptimizeProblem) async throws -> Itinerary
}

/// Derives an `OptimizeProblem` from a Trip — a straightforward, pure port of `optimize.ts`'s
/// `toInput`/stays-from-lodging-dates/edge-resolution/`kinds`-selection logic (ADR-0045). Domain
/// logic, not a networking concern, so it lives beside `pairsOfDay`/`dayChainPairs` rather than
/// inside the HTTP provider that eventually calls the endpoint with this value.
public func optimizationProblem(for trip: TripWithDetails, dayBudgetMinutes: Int? = nil) -> OptimizeProblem {
    let numDays = numDaysOf(startDate: trip.startDate, endDate: trip.endDate)
    let lodgings = trip.locations.compactMap(\.asLodging)
    let activityLocations = trip.locations.filter { $0.asActivity != nil && !$0.base.excluded }

    let (arrival, departure) = tripEdgesOf(trip)
    let edgeLocations = [arrival, departure].compactMap { $0 }
    var seenIds: Set<String> = []
    let uniqueEdgeLocations = edgeLocations.filter { seenIds.insert($0.base.id).inserted }

    // Lodging dates → integer night-ranges (ADR-0015): a booking checking in on day X and out on
    // day Y covers nights X..Y-1, clamped to the trip's [1, numDays]. Empty ranges (outside the
    // trip) drop.
    var stays: [OptimizeStayPlan] = []
    for lodging in lodgings {
        let startNight = max(1, dayNumberOf(startDate: trip.startDate, date: lodging.checkInDate))
        let endNight = min(numDays, dayNumberOf(startDate: trip.startDate, date: lodging.checkOutDate) - 1)
        if startNight <= endNight {
            stays.append(OptimizeStayPlan(lodgingId: lodging.base.id, startNight: startNight, endNight: endNight))
        }
    }

    let inputLocations = activityLocations + lodgings.map(Location.lodging) + uniqueEdgeLocations.map(Location.transit)
    // The kinds this run sources cells for (ADR-0024 §3): rail and bus are always in play, and
    // exactly one road kind — the Trip's own traveler-facing selector.
    let kinds: [PathKind] = [.rail, .bus, trip.roadProfile.asPathKind]

    return OptimizeProblem(
        locations: inputLocations.map(optimizeLocationInput), numDays: numDays, stays: stays,
        dayBudgetMinutes: dayBudgetMinutes, startDate: trip.startDate, kinds: kinds,
        hasJrPass: trip.hasJrPass,
        edges: OptimizeEdges(arrivalId: arrival?.base.id, departureId: departure?.base.id),
        journeyRoadKinds: trip.journeyRoadKinds
    )
}

private func optimizeLocationInput(_ location: Location) -> OptimizeLocationInput {
    let base = location.base
    let kind: OptimizeLocationKind
    switch location {
    case .activity: kind = .activity
    case .transit: kind = .transit
    case .lodging: kind = .lodging
    }
    let transit = location.asTransit
    return OptimizeLocationInput(
        id: base.id, lat: base.lat ?? 0, lng: base.lng ?? 0, visitDuration: base.visitDuration,
        openTime: base.openTime, closeTime: base.closeTime, hoursJson: base.hoursJson,
        enrichmentStatus: base.enrichmentStatus, kind: kind, arriveAt: transit?.arriveAt,
        departAt: transit?.departAt
    )
}
