import Foundation
import TripKrakenKit

/// ADR-0042: on-device road geometry via `MKDirections`, for whatever pairs the caller hands it.
/// Phase A has no rail provider yet, so today that's every pair — see the ADR for why this type
/// itself has no notion of "this pair is rail" (the protocol it implements carries a `RoadProfile`,
/// not a `PathKind`; rail exclusion is the composite's job once one exists, ADR-0043).
///
/// Requests are serialized one at a time with exponential backoff on throttle: `actor` isolation
/// gives this for free — every call into `geometry(for:profile:journeyRoadKinds:)` runs to
/// completion before the next `await` on this instance proceeds. MapKit's rate limit is real but
/// undocumented, and a multi-day trip's pair count can exceed whatever it is.
public actor MapKitGeometryProvider: PathGeometryProviding {
    private let requester: DirectionsRequesting
    private let maxRetries: Int
    private let initialBackoff: Duration

    public init(requester: DirectionsRequesting = MKDirectionsRequester(), maxRetries: Int = 3, initialBackoff: Duration = .seconds(2)) {
        self.requester = requester
        self.maxRetries = maxRetries
        self.initialBackoff = initialBackoff
    }

    public func geometry(
        for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]
    ) async throws -> PathGeometryBatch {
        var results: [[Path]?] = Array(repeating: nil, count: pairs.count)
        var retryIndices: Set<Int> = []

        for (index, pair) in pairs.enumerated() {
            let kind = resolvedKind(pair: pair, profile: profile, journeyRoadKinds: journeyRoadKinds)
            do {
                if let path = try await routeWithRetry(pair: pair, kind: kind) {
                    results[index] = [path]
                }
            } catch {
                // Anything that survives `routeWithRetry` — throttling exhausted its retries, or a
                // non-throttle failure — is "not yet answered," never cached as "no route" by a
                // caller (`PathGeometryBatch.retryIndices`'s own contract).
                retryIndices.insert(index)
            }
        }
        return PathGeometryBatch(results: results, retryIndices: retryIndices)
    }

    /// A Journey's chosen kind (if any) overrides the trip's default profile for this one pair —
    /// the same substitution `withJourneyRoadKind` applies elsewhere.
    private func resolvedKind(pair: PathPair, profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) -> RoadProfile {
        guard let fromId = pair.from.locationId, let toId = pair.to.locationId,
            let chosen = journeyRoadKindFor(journeyRoadKinds, fromId, toId)
        else { return profile }
        return chosen.kind
    }

    private func routeWithRetry(pair: PathPair, kind: RoadProfile) async throws -> Path? {
        var attempt = 0
        var backoff = initialBackoff
        while true {
            do {
                guard let result = try await requester.route(from: Point(lat: pair.from.lat, lng: pair.from.lng), to: Point(lat: pair.to.lat, lng: pair.to.lng), transportType: kind) else {
                    return nil
                }
                return makePath(pair: pair, kind: kind, result: result)
            } catch DirectionsRequestError.throttled where attempt < maxRetries {
                attempt += 1
                try await Task.sleep(for: backoff)
                backoff *= 2
            }
        }
    }

    /// See ADR-0042: `MKRoute`'s own `distance`/`expectedTravelTime` become this pair's
    /// `TravelCost` — nothing else in the Swift client answers a road pair's cost at all, so
    /// MapKit is this pair's sole cost-and-geometry source, the same way OSRM is today.
    private func makePath(pair: PathPair, kind: RoadProfile, result: RouteResult) -> Path {
        let geometry: [PathGeometry]? = result.coordinates.count >= 2
            ? [PathGeometry(coordinates: result.coordinates.map { [$0.lng, $0.lat] })]
            : nil
        let cost = TravelCost(distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds, basisOfCost: .routingService, answeredBy: .mapKit)
        let base = PathBase(from: pair.from, to: pair.to, travelCost: cost, geometry: geometry)
        return kind == .driving ? .driving(DrivingPath(base: base)) : .walking(WalkingPath(base: base))
    }
}
