import Foundation
import Observation
import TripKrakenKit

/// Port of `usePathGeometry.ts` minus React: holds every pair's answer keyed by `pairKey`, asks
/// only for what's missing, never caches a `retry` index as a real answer, and retries a bounded
/// number of rounds with a fixed delay. The map reads `held` directly and feeds it into
/// `routeSegmentsOfDay` — a key absent from `held` and a key mapped to `[]` both mean "draw this
/// pair dashed straight," matching `routeSegmentsOfDay`'s own `geometry[key] ?? []` lookup.
/// `ensure` splits a large ask into `chunkSize`-pair calls (its own doc comment explains why) so
/// `pendingCount` genuinely counts down instead of sitting frozen until the whole ask lands at once.
@MainActor
@Observable
public final class PathGeometryCache {
    public private(set) var held: [String: [Path]] = [:]
    private var inFlight: Set<String> = [] {
        didSet {
            isLoading = !inFlight.isEmpty
            pendingCount = inFlight.count
        }
    }
    /// True whenever any pair is awaiting a route answer — the map uses this to show a loading
    /// indicator instead of leaving a large trip's dashed-straight-line stampede unexplained while
    /// geometry trickles in.
    public private(set) var isLoading = false
    /// How many pairs are currently in flight — lets the indicator say something more concrete than
    /// just "loading" on a trip large enough to need MapKit's own pacing (`MapKitGeometryProvider`).
    public private(set) var pendingCount = 0
    private let provider: PathGeometryProviding
    private let maxRetryRounds: Int
    private let retryDelay: Duration
    private let chunkSize: Int

    public init(provider: PathGeometryProviding, maxRetryRounds: Int = 5, retryDelay: Duration = .seconds(4), chunkSize: Int = 8) {
        self.provider = provider
        self.maxRetryRounds = maxRetryRounds
        self.retryDelay = retryDelay
        self.chunkSize = chunkSize
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
    ///
    /// Split into `chunkSize`-pair `fetch` calls, each its own `Task`, rather than one call
    /// covering every missing pair: `fetch` only updates `held`/`inFlight` when its own
    /// `provider.geometry(for:...)` call returns, and `CompositeGeometryProvider` doesn't return
    /// until *both* its on-device and server sides finish the *whole* batch it was handed. One
    /// giant call therefore holds every pair's progress hostage to the single slowest pair in it —
    /// `pendingCount` would sit frozen at the batch's full size, then drop to zero all at once,
    /// which reads as a hang even when work is progressing normally underneath. Chunking makes
    /// pairs land in `held` (and `pendingCount` count down) as each chunk finishes, and preserves
    /// whatever priority order the caller already applied — `TripMapView` puts the visible Day's
    /// pairs first, so they end up in the first chunk submitted.
    public func ensure(pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) {
        let missing = pairs.filter {
            let key = pairKey(profile: profile, pair: $0, journeyRoadKinds: journeyRoadKinds)
            return held[key] == nil && !inFlight.contains(key)
        }
        guard !missing.isEmpty else { return }
        for pair in missing {
            inFlight.insert(pairKey(profile: profile, pair: pair, journeyRoadKinds: journeyRoadKinds))
        }
        for chunk in missing.chunked(into: chunkSize) {
            Task { await fetch(pairs: chunk, profile: profile, journeyRoadKinds: journeyRoadKinds, round: 0) }
        }
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
