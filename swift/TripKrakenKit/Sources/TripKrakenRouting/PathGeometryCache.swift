import Foundation
import Observation
import TripKrakenKit

/// Port of `usePathGeometry.ts` minus React: holds every pair's answer keyed by `pairKey`, asks
/// only for what's missing, never caches a `retry` index as a real answer, and retries a bounded
/// number of rounds with a fixed delay. The map reads `held` directly and feeds it into
/// `routeSegmentsOfDay` — a key absent from `held` and a key mapped to `[]` both mean "draw this
/// pair dashed straight," matching `routeSegmentsOfDay`'s own `geometry[key] ?? []` lookup.
@MainActor
@Observable
public final class PathGeometryCache {
    public private(set) var held: [String: [Path]] = [:]
    private var inFlight: Set<String> = []
    private let provider: PathGeometryProviding
    private let maxRetryRounds: Int
    private let retryDelay: Duration

    public init(provider: PathGeometryProviding, maxRetryRounds: Int = 5, retryDelay: Duration = .seconds(4)) {
        self.provider = provider
        self.maxRetryRounds = maxRetryRounds
        self.retryDelay = retryDelay
    }

    /// Clears everything held — call this on trip switch, since `pairKey` says nothing about which
    /// trip a coordinate pair belongs to.
    public func reset() {
        held = [:]
        inFlight = []
    }

    /// Fire-and-forget: asks only for pairs neither held nor already in flight, and lets the
    /// answer land in `held` asynchronously. An in-flight answer stays valid regardless of what
    /// else changed while it was in flight — this never cancels a request that's already running.
    public func ensure(pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) {
        let missing = pairs.filter {
            let key = pairKey(profile: profile, pair: $0, journeyRoadKinds: journeyRoadKinds)
            return held[key] == nil && !inFlight.contains(key)
        }
        guard !missing.isEmpty else { return }
        for pair in missing {
            inFlight.insert(pairKey(profile: profile, pair: pair, journeyRoadKinds: journeyRoadKinds))
        }
        Task { await fetch(pairs: missing, profile: profile, journeyRoadKinds: journeyRoadKinds, round: 0) }
    }

    private func fetch(pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind], round: Int) async {
        guard let batch = try? await provider.geometry(for: pairs, profile: profile, journeyRoadKinds: journeyRoadKinds) else {
            for pair in pairs {
                inFlight.remove(pairKey(profile: profile, pair: pair, journeyRoadKinds: journeyRoadKinds))
            }
            return
        }

        var retryPairs: [PathPair] = []
        for (index, pair) in pairs.enumerated() {
            let key = pairKey(profile: profile, pair: pair, journeyRoadKinds: journeyRoadKinds)
            inFlight.remove(key)
            if batch.retryIndices.contains(index) {
                retryPairs.append(pair)
            } else {
                held[key] = batch.results[index] ?? []
            }
        }

        guard !retryPairs.isEmpty, round < maxRetryRounds else { return }
        for pair in retryPairs {
            inFlight.insert(pairKey(profile: profile, pair: pair, journeyRoadKinds: journeyRoadKinds))
        }
        try? await Task.sleep(for: retryDelay)
        await fetch(pairs: retryPairs, profile: profile, journeyRoadKinds: journeyRoadKinds, round: round + 1)
    }
}
