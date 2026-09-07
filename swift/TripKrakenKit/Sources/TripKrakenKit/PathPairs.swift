import Foundation

/// The Day-to-pairs rule (ADR-0029 §5): which Location-to-Location pairs the map draws a line
/// between, and how one is keyed.
///
/// A "pair" is deliberately not a Path: it is the *request*, two endpoints we want the travel
/// between. What comes back is one or more Paths, since a provider splits a pair at every shift
/// (ADR-0022).

public struct PathPair: Sendable, Hashable, Codable {
    public var from: PathEndpoint
    public var to: PathEndpoint

    public init(from: PathEndpoint, to: PathEndpoint) {
        self.from = from
        self.to = to
    }
}

/// The chosen road kind (if any) covering an unordered Journey's Location pair — the read-side
/// mirror of the write path's own pair canonicalization: a stored row's `locationAId`/`locationBId`
/// are canonicalized (sorted) at write time, so a caller naming the pair in either direction finds
/// the same row.
public func journeyRoadKindFor(_ kinds: [JourneyRoadKind], _ locationIdA: String, _ locationIdB: String) -> JourneyRoadKind? {
    kinds.first {
        ($0.locationAId == locationIdA && $0.locationBId == locationIdB)
            || ($0.locationAId == locationIdB && $0.locationBId == locationIdA)
    }
}

/// A Journey's chosen road kind's effect on a base `kinds` list. Not a substitution *within* the
/// list — `osm-japan`'s `rail` capability never actually declines a cell within its geographic
/// reach; it always answers, worst case with its own walking estimate over the transit graph.
/// Keeping `rail`/`bus` alongside a chosen kind would leave the choice silently outranked.
///
/// A rider's choice for this Journey is not a soft preference transit can still win against: this
/// drops every other kind and asks for the chosen one alone. `kinds` is only used verbatim when
/// there's no choice to apply.
///
/// TS takes `{ kind: RoadProfile } | undefined` here rather than a full `JourneyRoadKind`, since
/// the kind is all it ever reads; Swift just takes the `RoadProfile?` directly rather than
/// reconstructing that single-field wrapper.
public func withJourneyRoadKind(_ kinds: [PathKind], chosen: RoadProfile?) -> [PathKind] {
    guard let chosen else { return kinds }
    return [chosen.asPathKind]
}

// `onKindChange` is deliberately not `@Sendable`: it's a UI-state-mutation callback (store
// dispatch, a SwiftUI binding), which runs on whatever actor its caller is already isolated to —
// forcing `@Sendable` here would reject the exact closures this exists to carry.
public struct JourneyKindToggle {
    public var kind: RoadProfile
    public var onKindChange: (RoadProfile?) -> Void

    public init(kind: RoadProfile, onKindChange: @escaping (RoadProfile?) -> Void) {
        self.kind = kind
        self.onKindChange = onKindChange
    }
}

/// The walk/drive kind toggle for one Journey — nil for a zero-length "same Location" gap, which
/// has no real Journey to choose a kind for. Resolves the Journey's effective kind (an explicit
/// choice if one is stored, else the Trip's `roadProfile` default) and wires `onKindChange` to
/// store a new choice for this pair. Shared by every surface that renders a road-kind toggle so
/// they can't resolve a Journey's kind differently.
public func resolveJourneyKindToggle(
    journeyRoadKinds: [JourneyRoadKind], roadProfile: RoadProfile, fromId: String, toId: String,
    onKindChange: @escaping (RoadProfile?) -> Void
) -> JourneyKindToggle? {
    guard fromId != toId else { return nil }
    let kind = journeyRoadKindFor(journeyRoadKinds, fromId, toId)?.kind ?? roadProfile
    return JourneyKindToggle(kind: kind, onKindChange: onKindChange)
}

/// What role an entry plays in a Day's chain — not a routing fact, just enough for a render surface
/// to pick the right row.
public enum ChainRole: Sendable, Hashable {
    case start, checkin, stop, end
}

public struct ChainEntry: Sendable, Hashable {
    public var role: ChainRole
    public var location: Location
    /// Only set when `role == .stop` — what a stop row needs beyond the bare Location (drag
    /// identity, position for the day-color index, along-the-way scoping).
    public var stop: ScheduledStop?
    public var index: Int?

    public init(role: ChainRole, location: Location, stop: ScheduledStop? = nil, index: Int? = nil) {
        self.role = role
        self.location = location
        self.stop = stop
        self.index = index
    }
}

/// Every entry in a Day's chain, in render order — start Anchor, check-in waypoint, stops, end
/// Anchor (the check-in waypoint sits before the day's stops, since bags are dropped at the new
/// lodging on arrival). Ungeocoded entries are kept, unlike `pairsOfDay` below — a list surface
/// still renders a disabled row for a stop with no coordinates; only the coordinate-keyed routing
/// side needs to drop them.
///
/// This is the one place "what's in a Day's chain, in what order" is decided — every render surface
/// drives off it, so they can't structurally disagree about which Locations exist or which gaps
/// between them are real.
public func dayChainEntries(_ day: DerivedDay) -> [ChainEntry] {
    var entries: [ChainEntry] = []
    if let start = day.startAnchor { entries.append(ChainEntry(role: .start, location: start.asLocation)) }
    if let checkin = day.checkInWaypoint { entries.append(ChainEntry(role: .checkin, location: .lodging(checkin))) }
    for (index, stop) in day.stops.enumerated() {
        entries.append(ChainEntry(role: .stop, location: .activity(stop.location), stop: stop, index: index))
    }
    if let end = day.endAnchor { entries.append(ChainEntry(role: .end, location: end.asLocation)) }
    return entries
}

/// Consecutive pairs among `dayChainEntries` — every gap a list surface should offer a connector
/// for. Rendering still no-ops per pair when either end lacks coordinates; this function's only job
/// is deciding *which* adjacent Locations are a real gap at all.
public func dayChainPairs(_ day: DerivedDay) -> [(from: Location, to: Location)] {
    let entries = dayChainEntries(day)
    guard entries.count >= 2 else { return [] }
    return (0..<(entries.count - 1)).map { (from: entries[$0].location, to: entries[$0 + 1].location) }
}

/// The Day's chain, coordinates only, geocoded entries alone — what a routing request can actually
/// key on. Ungeocoded entries drop out here (and only here) so two geocoded stops either side of an
/// ungeocoded one become adjacent for routing purposes.
private func chainOfDay(_ day: DerivedDay) -> [PathEndpoint] {
    dayChainEntries(day).compactMap { entry in
        guard let lat = entry.location.base.lat, let lng = entry.location.base.lng else { return nil }
        return PathEndpoint(lat: lat, lng: lng, locationId: entry.location.base.id)
    }
}

/// Consecutive pairs along one Day's chain. A Day with fewer than two positioned entries has none.
public func pairsOfDay(_ day: DerivedDay) -> [PathPair] {
    let chain = chainOfDay(day)
    guard chain.count >= 2 else { return [] }
    return (0..<(chain.count - 1)).map { PathPair(from: chain[$0], to: chain[$0 + 1]) }
}

/// Six decimal places is ~0.1 m, far finer than any road-snapping tolerance, so no two genuinely
/// distinct requests collide, and identical coordinates always produce an identical string
/// regardless of how the float was arrived at.
private func coordOf(_ p: PathEndpoint) -> String {
    "\(String(format: "%.6f", p.lng)),\(String(format: "%.6f", p.lat))"
}

/// The cache key for one pair's answer (ADR-0029 §5). Keyed on coordinates rather than
/// `locationId` so that re-geocoding a Location invalidates its entries by construction, on the
/// Road profile because it selects which OSRM graph answered, and on this Journey's chosen kind (if
/// any) for the same reason — a choice changes which kind is eligible for this cell just as much as
/// `roadProfile` does. `locationId` on either end is what makes a choice lookup possible at all; a
/// pair without one (an interchange endpoint a decomposition created) simply can't carry one.
public func pairKey(profile: RoadProfile, pair: PathPair, journeyRoadKinds: [JourneyRoadKind]) -> String {
    let chosen: JourneyRoadKind? = {
        guard let fromId = pair.from.locationId, let toId = pair.to.locationId else { return nil }
        return journeyRoadKindFor(journeyRoadKinds, fromId, toId)
    }()
    let chosenSuffix = chosen.map { ":\($0.kind.rawValue)" } ?? ""
    return "\(profile.rawValue):\(coordOf(pair.from))>\(coordOf(pair.to))\(chosenSuffix)"
}

/// Identity for one decomposed shift within a gap's chain — a pair's `pairKey` plus its position in
/// the `[Path]` that pair resolved to. Exists so a hover-highlight surface and its wiring agree on
/// the same string without each re-deriving the format.
public func pathShiftId(_ key: String, index: Int) -> String {
    "\(key):\(index)"
}

/// Every distinct pair across the Trip's Days, in first-seen order. Days share pairs routinely — a
/// lodging Anchor bookends consecutive Days — and each distinct pair is worth exactly one lookup.
public func uniquePairsOfDays(_ days: [DerivedDay], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) -> [PathPair] {
    var seenKeys = Set<String>()
    var result: [PathPair] = []
    for day in days {
        for pair in pairsOfDay(day) {
            let key = pairKey(profile: profile, pair: pair, journeyRoadKinds: journeyRoadKinds)
            if seenKeys.insert(key).inserted { result.append(pair) }
        }
    }
    return result
}
