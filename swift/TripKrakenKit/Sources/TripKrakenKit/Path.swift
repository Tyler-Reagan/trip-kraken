import Foundation

// Ported from `src/types/path.ts` (ADR-0021, ADR-0022). `Path` is the one travel primitive on the
// edge axis, mirroring `Location` on the node axis: a discriminated union over `kind`, travel cost
// composed rather than inherited.
//
// A Path is one *shift* (ADR-0022, revised): it ends at every discernible change of kind, Operator,
// or service — something the traveler does, not a provider-internal boundary. Every Path is
// therefore of exactly one kind by construction — `kind` is nil only for `.unknown`, whose Basis of
// cost is `.straightLine` and so has no honest kind to report at all.
//
// Getting from one Placement to the next is a **Journey** — a chain of one or more Paths, never
// itself stored or scored (see `journeyCost(_:)` below).

/// What a Path's travel was. `.other` is travel that *was* routed but falls outside the kinds we
/// model (a ferry, a funicular) — distinct from `Path.kind == nil` on `.unknown`, which means no
/// route was computed at all.
public enum PathKind: String, Sendable, Hashable, Codable, CaseIterable {
    case rail, bus, walking, driving, bicycle, other
}

/// Which OSRM profile answers a Trip's road cells (ADR-0024, amended 2026-08-11) — a subtype of
/// `PathKind`, not a separate vocabulary. Narrower than the deleted `allowedPathKinds`: it selects a
/// profile for the `osrm` registry entry alone, never gates `osm-japan` or `google`.
public enum RoadProfile: String, Sendable, Hashable, Codable, CaseIterable {
    case walking, driving

    public var asPathKind: PathKind {
        switch self {
        case .walking: .walking
        case .driving: .driving
        }
    }
}

/// How a Path's cost was arrived at (CONTEXT.md). Carries no reason — only whether real topology
/// was used, not why it wasn't.
public enum BasisOfCost: String, Sendable, Hashable, Codable {
    case railNetwork, routingService, straightLine
}

/// Which registry entry answered a cell (ADR-0024 §4/§5, CONTEXT.md's "Answered by"). Orthogonal to
/// `BasisOfCost`: `.osrm` and `.google` both produce `.routingService`, and `.osrm` alone can also
/// produce `.straightLine` for a cell it declined. Load-bearing beyond diagnostics — see
/// `PersistableTravelCost` below, the type this exists to make checkable.
public enum ProviderId: String, Sendable, Hashable, Codable {
    case osmJapan = "osm-japan"
    case osrm
    case google
    case haversine
}

/// The entity operating a Path — whoever provides the travel *to* you rather than you providing it
/// yourself. A struct rather than a bare string so an OSM id or a canonical ref can attach later
/// without widening the field's shape again.
public struct Operator: Sendable, Hashable, Codable {
    public var name: String

    public init(name: String) {
        self.name = name
    }
}

public struct TravelCost: Sendable, Hashable, Codable {
    public var distanceMeters: Double
    public var durationSeconds: Double
    public var basisOfCost: BasisOfCost
    /// Which registry entry produced this cost (ADR-0024 §4). Required, not inferred from
    /// `basisOfCost` — two providers can share a basis.
    public var answeredBy: ProviderId

    public init(distanceMeters: Double, durationSeconds: Double, basisOfCost: BasisOfCost, answeredBy: ProviderId) {
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.basisOfCost = basisOfCost
        self.answeredBy = answeredBy
    }

    /// Always `durationSeconds / 60`. The TS original stored this and funneled every construction
    /// through one `makeTravelCost` factory so it could never diverge from `durationSeconds`; Swift
    /// can just compute it instead of policing a stored duplicate, so there is nothing to enforce.
    public var costAsMinutes: Double { durationSeconds / 60 }
}

/// #158 / Google Maps Platform Terms of Service §3.2.3(a): "Customer will not pre-fetch, index,
/// store, or cache any Content" — and distance-matrix results are named explicitly. Any function
/// that writes a `TravelCost` to persistent storage must require this type, not the bare
/// `TravelCost` — the failable initializer below is where that exclusion is enforced, in place of a
/// comment someone has to remember at every call site.
///
/// Holding a Google-derived cost in memory for the span of one optimize run remains permitted
/// (ADR-0018 §1) — this type governs *persistence*, not use.
public struct PersistableTravelCost: Sendable, Hashable, Codable {
    public var cost: TravelCost

    public init?(_ cost: TravelCost) {
        guard cost.answeredBy != .google else { return nil }
        self.cost = cost
    }
}

public func isPersistable(_ cost: TravelCost) -> Bool {
    cost.answeredBy != .google
}

/// A Path's endpoint, as identity plus coordinates — deliberately not a full `Location`. Embedding
/// one would put every field of enrichment on each end of every Path, and would make a Path hold a
/// snapshot that silently diverges the moment the Location is edited. `locationId` is nil for an
/// interchange endpoint created by decomposing a Journey — ephemeral, derived from the Path rather
/// than a real, persisted Location.
///
/// `lat`/`lng` are the *requested* coordinates — the Location's own, not wherever a router snapped
/// them to.
public struct PathEndpoint: Sendable, Hashable, Codable {
    public var lat: Double
    public var lng: Double
    public var locationId: String?
    /// The station this endpoint is, when it is one (ADR-0032 §3) — a stop node's own station name
    /// where a rail Path boards or alights, and the *station cluster's* name at a transfer.
    public var stationName: String?

    public init(lat: Double, lng: Double, locationId: String? = nil, stationName: String? = nil) {
        self.lat = lat
        self.lng = lng
        self.locationId = locationId
        self.stationName = stationName
    }
}

/// A GeoJSON LineString's coordinates — `[lng, lat]` pairs, in travel order, per the GeoJSON spec.
/// A minimal shape carrying only what a Path's geometry needs; not a general-purpose GeoJSON type.
public struct PathGeometry: Sendable, Hashable, Codable {
    public var coordinates: [[Double]]

    public init(coordinates: [[Double]]) {
        self.coordinates = coordinates
    }
}

public struct PathBase: Sendable, Hashable, Codable {
    public var from: PathEndpoint
    public var to: PathEndpoint
    public var travelCost: TravelCost
    /// The real spans this Path has, in travel order — not one line for the whole Path (ADR-0030
    /// §9). A Path may know the shape of some of its length and none of the rest. `nil` or empty
    /// means no shape at all; spans are never bridged with invented straight lines.
    public var geometry: [PathGeometry]?

    public init(from: PathEndpoint, to: PathEndpoint, travelCost: TravelCost, geometry: [PathGeometry]? = nil) {
        self.from = from
        self.to = to
        self.travelCost = travelCost
        self.geometry = geometry
    }
}

public struct RailPath: Sendable, Hashable, Codable {
    public var base: PathBase
    public var lineName: String
    public var `operator`: Operator?
    /// True exactly on a Nozomi/Mizuho leg — the two named Tokaido/Sanyo/Kyushu Shinkansen services
    /// a JR Pass does not cover outright (issue #211). An objective fact about the *service*, never
    /// a routing exclusion.
    public var jrPassSupplementRequired: Bool?

    public init(base: PathBase, lineName: String, operator: Operator? = nil, jrPassSupplementRequired: Bool? = nil) {
        self.base = base
        self.lineName = lineName
        self.operator = `operator`
        self.jrPassSupplementRequired = jrPassSupplementRequired
    }
}

public struct BusPath: Sendable, Hashable, Codable {
    public var base: PathBase
    public var lineName: String
    public var `operator`: Operator?

    public init(base: PathBase, lineName: String, operator: Operator? = nil) {
        self.base = base
        self.lineName = lineName
        self.operator = `operator`
    }
}

/// `lineName` is optional here alone: `.other` is travel we deliberately don't model, and a ferry or
/// funicular way in OSM routinely carries no name at all.
public struct OtherPath: Sendable, Hashable, Codable {
    public var base: PathBase
    public var lineName: String?
    public var `operator`: Operator?

    public init(base: PathBase, lineName: String? = nil, operator: Operator? = nil) {
        self.base = base
        self.lineName = lineName
        self.operator = `operator`
    }
}

public struct WalkingPath: Sendable, Hashable, Codable {
    public var base: PathBase

    public init(base: PathBase) {
        self.base = base
    }
}

public struct DrivingPath: Sendable, Hashable, Codable {
    public var base: PathBase
    public var `operator`: Operator?

    public init(base: PathBase, operator: Operator? = nil) {
        self.base = base
        self.operator = `operator`
    }
}

public struct BicyclePath: Sendable, Hashable, Codable {
    public var base: PathBase
    public var `operator`: Operator?

    public init(base: PathBase, operator: Operator? = nil) {
        self.base = base
        self.operator = `operator`
    }
}

/// The one travel primitive — a discriminated union narrowed on the case itself (mirrors `Location`
/// in `Location.swift`). Codable is deliberately not implemented yet — see the note in `Trip.swift`.
public enum Path: Sendable, Hashable {
    case unknown(PathBase)
    case rail(RailPath)
    case bus(BusPath)
    case other(OtherPath)
    case walking(WalkingPath)
    case driving(DrivingPath)
    case bicycle(BicyclePath)

    public var base: PathBase {
        switch self {
        case .unknown(let b): b
        case .rail(let p): p.base
        case .bus(let p): p.base
        case .other(let p): p.base
        case .walking(let p): p.base
        case .driving(let p): p.base
        case .bicycle(let p): p.base
        }
    }

    /// `nil` exactly for `.unknown` — no route was computed, so there is no honest kind to report.
    public var kind: PathKind? {
        switch self {
        case .unknown: nil
        case .rail: .rail
        case .bus: .bus
        case .other: .other
        case .walking: .walking
        case .driving: .driving
        case .bicycle: .bicycle
        }
    }

    public var asRail: RailPath? { if case .rail(let p) = self { p } else { nil } }
    public var asBus: BusPath? { if case .bus(let p) = self { p } else { nil } }
    public var asOther: OtherPath? { if case .other(let p) = self { p } else { nil } }
    public var asWalking: WalkingPath? { if case .walking(let p) = self { p } else { nil } }
    public var asDriving: DrivingPath? { if case .driving(let p) = self { p } else { nil } }
    public var asBicycle: BicyclePath? { if case .bicycle(let p) = self { p } else { nil } }
}

/// Real topology beats `.straightLine`; used only to break ties in `journeyCost(_:)`.
private let basisRoutedness: [BasisOfCost: Int] = [
    .railNetwork: 1,
    .routingService: 1,
    .straightLine: 0,
]

/// What a whole **Journey** costs: the sum of its Paths' costs (ADR-0032). Exact rather than
/// approximate by construction. Use this, never `paths.first!.travelCost`, for any caller that wants
/// the whole A→B cost — a decomposed rail Journey begins with its *access walk*, so reading the
/// first element silently reports a 500-metre stroll as the cost of a cross-city train ride.
///
/// `basisOfCost` and `answeredBy` come from the **most-routed** Path in the chain — real topology
/// beats `.straightLine`, ties broken by duration — rather than a weakest-link rule. Weakest-link is
/// the tempting reading and it is wrong here: a rail Journey's access walks and transfers are
/// `.straightLine` by construction (ADR-0032 §2/§4), so weakest-link would stamp *every* rail
/// Journey `.straightLine` and make the marker meaningless. Those legs are components of the rail
/// graph's own cost model (ADR-0019), not a fallback away from it — the Journey really was costed by
/// traversing real topology.
public func journeyCost(_ paths: [Path]) -> TravelCost? {
    guard !paths.isEmpty else { return nil }
    var distanceMeters = 0.0
    var durationSeconds = 0.0
    var representative = paths[0].base.travelCost
    for path in paths {
        let cost = path.base.travelCost
        distanceMeters += cost.distanceMeters
        durationSeconds += cost.durationSeconds
        let routedness = basisRoutedness[cost.basisOfCost]! - basisRoutedness[representative.basisOfCost]!
        if routedness > 0 || (routedness == 0 && cost.durationSeconds > representative.durationSeconds) {
            representative = cost
        }
    }
    return TravelCost(
        distanceMeters: distanceMeters, durationSeconds: durationSeconds,
        basisOfCost: representative.basisOfCost, answeredBy: representative.answeredBy
    )
}

/// ADR-0026's self-heal response shape (#171) — the one new pair a removed activity Placement's
/// neighbors became, and what it costs to travel between them. Not a `Journey`: it carries the
/// summed `TravelCost` of the chain, flattened to the one number the healed pair displays.
public struct HealedPair: Sendable, Hashable, Codable {
    public var fromLocationId: String
    public var toLocationId: String
    public var travelCost: TravelCost

    public init(fromLocationId: String, toLocationId: String, travelCost: TravelCost) {
        self.fromLocationId = fromLocationId
        self.toLocationId = toLocationId
        self.travelCost = travelCost
    }
}
