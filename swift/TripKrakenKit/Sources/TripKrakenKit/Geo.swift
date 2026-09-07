import Foundation

/// Coordinate primitives (ADR-0022) — `Point` and the haversine math outlive any one `Path`: it's
/// also the type of a clustering centroid and a discovery corridor endpoint. Ported from
/// `src/lib/geo.ts`.
public struct Point: Sendable, Hashable, Codable {
    public var lat: Double
    public var lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

extension Point {
    /// A location is treated as not-yet-geocoded when its coordinates default to (0, 0). Shared by
    /// every caller that needs to exclude these from distance-lookup construction or anchor
    /// selection.
    public var hasValidCoords: Bool {
        lat != 0 || lng != 0
    }
}

private let earthRadiusMeters = 6_371_000.0

private func toRadians(_ degrees: Double) -> Double {
    degrees * .pi / 180
}

/// Straight-line distance in meters — the single haversine implementation every distance-estimating
/// caller (clustering, discovery, transit-graph ingest/query) shares.
public func haversineMeters(_ a: Point, _ b: Point) -> Double {
    let dLat = toRadians(b.lat - a.lat)
    let dLng = toRadians(b.lng - a.lng)
    let sinDLat = sin(dLat / 2)
    let sinDLng = sin(dLng / 2)
    let x = sinDLat * sinDLat
        + cos(toRadians(a.lat)) * cos(toRadians(b.lat)) * sinDLng * sinDLng
    return earthRadiusMeters * 2 * atan2(x.squareRoot(), (1 - x).squareRoot())
}
