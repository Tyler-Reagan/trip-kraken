import Foundation

/// The seam between "what geometry does a Day need" (this module, always available) and "who can
/// actually answer that" (implementations live in `TripKrakenRouting` — MapKit on-device, HTTP for
/// rail, or nothing at all). Declared here, over Kit types only, so the map's rendering code can be
/// built and tested against `NoGeometryProvider` before any real provider exists.

/// One batch answer, parallel-indexed to the pairs asked for — the shape
/// `POST /api/trips/[id]/path-geometry` already returns.
public struct PathGeometryBatch: Sendable, Hashable {
    /// `nil` at an index means "no geometry": draw that pair straight and dashed.
    public var results: [[Path]?]
    /// Indices whose provider was unreachable (a cold-starting server, ADR-0037; or a throttled
    /// on-device request) rather than genuinely answering "no route." These are *not* answers and
    /// must never be cached — the honest state is "not yet asked."
    public var retryIndices: Set<Int>

    public init(results: [[Path]?], retryIndices: Set<Int>) {
        self.results = results
        self.retryIndices = retryIndices
    }
}

public protocol PathGeometryProviding: Sendable {
    func geometry(
        for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]
    ) async throws -> PathGeometryBatch
}

/// Every pair answers "no geometry" — a real, honest state the renderer already handles (every Day
/// draws as a dashed straight-line chain), not a placeholder standing in for a missing feature.
/// This is what lets the map ship and be verified before any real provider exists.
public struct NoGeometryProvider: PathGeometryProviding {
    public init() {}

    public func geometry(
        for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]
    ) async throws -> PathGeometryBatch {
        PathGeometryBatch(results: Array(repeating: nil, count: pairs.count), retryIndices: [])
    }
}
