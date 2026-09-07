import Foundation

/// The metro tier of the map's navigation hierarchy: trip → metro → day → stop.
///
/// One shared source: the map's metro tabs and the itinerary's day-card badges both read
/// `metrosOf(trip)`, so neither re-derives its own clustering. The grouping itself is
/// `clusterByMetro` (`MetroCluster.swift`), the same detector the optimizer's coverage mask and the
/// lodging wizard use; this module only adds what *navigation* needs on top: a display label, the
/// days each metro touches, and the bounds to fit the camera to.
///
/// Clustered over the activities the map actually draws (the days' stops), never every Location in
/// the trip — otherwise a metro's bounds could fit to a point that isn't on screen. Lodgings are
/// the one exception, and only for a metro they founded themselves (ADR-0020, amended 2026-08-17).

/// A box containing a set of coordinates, provider-neutral — which map SDK renders this is
/// explicitly undecided (ADR-0038), so this doesn't commit to any one SDK's bounds-array shape the
/// way the TS original committed to MapLibre's `fitBounds` order.
public struct Bounds: Sendable, Hashable {
    public var southwest: Point
    public var northeast: Point

    public init(southwest: Point, northeast: Point) {
        self.southwest = southwest
        self.northeast = northeast
    }
}

/// The box containing every geocoded point given, or nil when none are.
public func boundsOf<T: Geocodable>(_ points: [T]) -> Bounds? {
    let valid = points.compactMap { p -> Point? in
        guard let lat = p.lat, let lng = p.lng else { return nil }
        return Point(lat: lat, lng: lng)
    }
    guard !valid.isEmpty else { return nil }
    let lats = valid.map(\.lat)
    let lngs = valid.map(\.lng)
    return Bounds(
        southwest: Point(lat: lats.min()!, lng: lngs.min()!),
        northeast: Point(lat: lats.max()!, lng: lngs.max()!)
    )
}

public struct TripMetro: Sendable, Hashable {
    public var id: String
    public var label: String
    /// Day numbers with at least one stop in this metro, ascending.
    public var dayNumbers: [Int]
    /// Which stops belong here — lets a caller order metros by where they first appear in a day.
    public var locationIds: Set<String>
    public var stopCount: Int
    /// Every stop in this metro across the *whole* trip — a metro click is trip-scoped.
    public var bounds: Bounds

    public init(id: String, label: String, dayNumbers: [Int], locationIds: Set<String>, stopCount: Int, bounds: Bounds) {
        self.id = id
        self.label = label
        self.dayNumbers = dayNumbers
        self.locationIds = locationIds
        self.stopCount = stopCount
        self.bounds = bounds
    }
}

/// Anything `metroLabel`/`localityOf` can read a name and formatted address off.
public protocol NamedAddress {
    var name: String { get }
    var address: String? { get }
}

extension Activity: NamedAddress {
    public var name: String { base.name }
    public var address: String? { base.address }
}

extension Lodging: NamedAddress {
    public var name: String { base.name }
    public var address: String? { base.address }
}

// Google's formattedAddress for Japan comes back in two different orderings depending on the place
// ("<block/chōme>, <ward>, <city>, <postal>, Japan" vs. "Japan, 〒<postal> <city>, <ward>,
// <block>") — comma-position heuristics land on whichever is there, which is a street-block or ward
// name a user wouldn't recognize on a map about as often as it lands on the city. The postal code is
// the one token both orderings agree on, so anchor to it instead: the region name always sits
// immediately beside it, on whichever side isn't the marker.
// `nonisolated(unsafe)`: a `Regex` literal is an immutable, read-only value once built — matching
// against it never mutates it — but the type itself doesn't conform to `Sendable`, so Swift 6's
// strict concurrency checking can't verify that for us. This is the standard escape hatch for a
// global regex constant, not a real data race.
private nonisolated(unsafe) let jpPostalThenRegion = /〒\s*\d{3}[-−]\d{4}\s+([^,]+)/
private nonisolated(unsafe) let regionThenJpPostal = /([A-Za-z][A-Za-z\s]*?)\s*,?\s*\d{3}[-−]\d{4}/
private nonisolated(unsafe) let regionThenUsZip = /([A-Za-z][A-Za-z\s]*?)\s*,?\s*\d{5}(?:-\d{4})?\b/
private nonisolated(unsafe) let trailingPostalOrZip = /(〒?\s*\d{3}[-−]\d{4}$|\d{5}(-\d{4})?$)/
private nonisolated(unsafe) let postalOrZipAnywhere = /(〒?\s*\d{3}[-−]\d{4}|\b\d{5}(-\d{4})?\b)/

/// A recognizable label for a metro: the prefecture/state-level region read off its first
/// activity's formatted address, not a ward or neighborhood name. Google's formattedAddress usually
/// omits the postal code entirely, so the postal-anchored patterns are the exception rather than
/// the rule — the common case falls through to the last comma-separated segment, which is where the
/// city/prefecture normally lands. Only falls back to the location's own name when the address has
/// no segments to anchor on at all (a single, comma-free line).
///
/// Reads a lodging when the metro has no activities — a lodging-founded metro (ADR-0020, amended
/// 2026-08-17) is exactly the case where the *only* thing that can name the destination is the
/// place you sleep.
public func metroLabel<A: NamedAddress, L: NamedAddress>(activities: [A], lodgings: [L] = []) -> String {
    let address: String?
    let fallback: String
    if let first = activities.first {
        address = first.address
        fallback = first.name
    } else if let first = lodgings.first {
        address = first.address
        fallback = first.name
    } else {
        address = nil
        fallback = "this area"
    }
    return metroLabel(address: address, fallback: fallback)
}

/// Convenience overload for the common case of no lodging fallback at all — `lodgings: []`'s empty
/// literal has nothing for Swift to infer `L` from, so this pins it to `A` itself (unused, since
/// the array is empty either way).
public func metroLabel<A: NamedAddress>(activities: [A]) -> String {
    metroLabel(activities: activities, lodgings: [A]())
}

private func metroLabel(address: String?, fallback: String) -> String {
    guard let address, !address.isEmpty else { return fallback }

    if let m = address.firstMatch(of: jpPostalThenRegion) { return String(m.1).trimmingCharacters(in: .whitespaces) }
    if let m = address.firstMatch(of: regionThenJpPostal) { return String(m.1).trimmingCharacters(in: .whitespaces) }
    if let m = address.firstMatch(of: regionThenUsZip) { return String(m.1).trimmingCharacters(in: .whitespaces) }

    let segments = address.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    guard segments.count >= 2 else { return fallback }
    let last = segments[segments.count - 1].replacing(trailingPostalOrZip, with: "").trimmingCharacters(in: .whitespaces)
    return last.isEmpty ? fallback : last
}

/// The sub-metro locality — ward, city, or district — that `metroLabel` deliberately leaves out.
///
/// Exists for a staging surface where the metro is already stated by a group heading, so the
/// useful remainder of an address is the one unit below it: "Nishi Ward" under Osaka, "Taito City"
/// under Tokyo, "Sapporo" under Hokkaido — the grain at which a traveller decides which stops
/// belong on the same day.
///
/// Reads from the end inwards, the same direction `metroLabel` does: drop the country, drop postal
/// codes, drop whatever the metro label already said, and take the last thing standing. Anything
/// that survives to be the *only* segment is a street address, not a locality, so it returns nil
/// rather than printing a house number as if it were a district.
public func localityOf(_ address: String?, metro: String) -> String? {
    guard let address else { return nil }
    let segments =
        address
        .split(separator: ",")
        .dropLast()  // the country
        .map { String($0).replacing(postalOrZipAnywhere, with: "").trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
        .filter { $0 != metro }
    return segments.count > 1 ? segments[segments.count - 1] : nil
}

// Centroid-rounded identity for a metro cluster, stable across re-renders as long as the cluster
// doesn't move — which enrichment (address/name backfill) never does. Coarse enough (~1km) to
// survive a cluster losing/gaining one member, well under the 75km radius that separates distinct
// metros, so no collision risk between them.
public func metroKey(_ centroid: Point) -> String {
    String(format: "%.2f,%.2f", centroid.lat, centroid.lng)
}

/// The trip's metros, ordered by first appearance in the itinerary.
///
/// Unlike the TS original, this is not memoized: TS keys a `WeakMap` on the Trip *object*, using
/// JS reference identity as its "has anything changed?" signal — a value-typed Swift struct has no
/// such identity to key on. Recomputing per call keeps this a pure function; a caller that wants
/// memoization (e.g. across SwiftUI view updates) owns that as a presentation-layer concern.
public func metrosOf(_ trip: TripWithDetails) -> [TripMetro] {
    let days = deriveTripPlanDays(trip)

    // Which Days each Location touches — Placements *and* Anchors (ADR-0020, amended 2026-08-17). A
    // Day holding only an arrival and a Lodging is somewhere; keyed on stops alone it was nowhere.
    var daysByLocationId: [String: [Int]] = [:]
    func touches(_ locationId: String, _ dayNumber: Int) {
        if daysByLocationId[locationId] == nil {
            daysByLocationId[locationId] = [dayNumber]
        } else if !daysByLocationId[locationId]!.contains(dayNumber) {
            daysByLocationId[locationId]!.append(dayNumber)
        }
    }
    for day in days {
        for stop in day.stops { touches(stop.location.base.id, day.dayNumber) }
        for anchor in [day.startAnchor, day.endAnchor].compactMap({ $0 }) {
            touches(anchor.base.id, day.dayNumber)
        }
    }

    let stops = days.flatMap { $0.stops.map(\.location) }
    let clusters = clusterByMetro(activities: stops, lodgings: trip.locations.compactMap(\.asLodging))

    return
        clusters
        .map { cluster -> TripMetro in
            let dayNumbers = Set(
                cluster.activities.flatMap { daysByLocationId[$0.base.id] ?? [] }
                    + cluster.lodgings.flatMap { daysByLocationId[$0.base.id] ?? [] }
            )
            // Non-nil holds for both founding passes: an activity-founded metro has activities, and
            // a lodging-founded one has lodgings — each already filtered to real coordinates
            // upstream.
            let bounds = cluster.activities.isEmpty ? boundsOf(cluster.lodgings)! : boundsOf(cluster.activities)!
            return TripMetro(
                id: metroKey(cluster.centroid),
                label: metroLabel(activities: cluster.activities, lodgings: cluster.lodgings),
                dayNumbers: dayNumbers.sorted(),
                // Stops, deliberately: these two say "what is drawn here", and a lodging is not a
                // stop.
                locationIds: Set(cluster.activities.map(\.base.id)),
                stopCount: cluster.activities.count,
                bounds: bounds
            )
        }
        .sorted { ($0.dayNumbers.first ?? .max) < ($1.dayNumbers.first ?? .max) }
}

public func metroOfDay(_ metros: [TripMetro], dayNumber: Int) -> TripMetro? {
    metros.first { $0.dayNumbers.contains(dayNumber) }
}
