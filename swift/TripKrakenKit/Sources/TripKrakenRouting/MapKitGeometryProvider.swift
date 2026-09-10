import Foundation
import TripKrakenKit

/// ADR-0042: on-device road geometry via `MKDirections`, for whatever pairs the caller hands it.
/// Phase A has no rail provider yet, so today that's every pair — see the ADR for why this type
/// itself has no notion of "this pair is rail" (the protocol it implements carries a `RoadProfile`,
/// not a `PathKind`; rail exclusion is the composite's job once one exists, ADR-0043).
///
/// ADR-0042 §2 originally serialized every request one at a time, relying on `actor` isolation for
/// that for free. Revised here: a bounded number of requests (`maxConcurrency`) are now in flight
/// together. This is a real amendment to that ADR, not just an implementation detail — worth
/// flagging as one, since §2 states the one-at-a-time queue as the decision itself. The reasoning
/// for the change: MapKit's rate limit governs request *starts* per window, not concurrency: two
/// requests in flight at once cost the same "2 of 50" as two requests spaced a second apart. Once
/// `throttlePace` (below) already caps the start rate, serializing on top of that only adds each
/// pair's full network round-trip to every pair behind it for no safety benefit — the exact cost
/// that turns a large trip's (a honeymoon's pair count can run into the hundreds) first-load latency
/// into a long wait. Bounded concurrency collects several round-trips into the same wall-clock
/// window instead, while `throttlePace`'s sliding window still gates how many *start* per minute
/// regardless of how many are overlapping.
///
/// **`maxConcurrency` is enforced actor-wide (`acquireSlot`/`releaseSlot`), not per call.**
/// `PathGeometryCache.ensure` splits a large ask into several `chunkSize`-pair calls and fires one
/// `Task` per chunk, so multiple `geometry(for:...)` calls into this same actor instance are
/// routinely in flight at once. A concurrency bound scoped to one call's own `withTaskGroup` (the
/// first version of this change) does not compose with that: N concurrent calls each independently
/// admitting up to `maxConcurrency` workers adds up to N × `maxConcurrency` requests actually
/// in flight at once — for a 46-pair trip chunked at 8, six concurrent calls times a bound of 5 is
/// up to 30 requests fired in a burst, well past what `throttlePace`'s window was sized for on the
/// (correct) assumption of one caller. The observed symptom matched exactly: a burst answered fast,
/// then a stall while the burst's throttled survivors all backed off roughly together, then a
/// synchronized mass release. `acquireSlot`/`releaseSlot` below share one counter across every
/// caller, so the actual number of `requester.route` calls in flight is bounded by `maxConcurrency`
/// regardless of how many top-level `geometry(for:...)` calls are outstanding.
public actor MapKitGeometryProvider: PathGeometryProviding {
    private let requester: DirectionsRequesting
    private let maxRetries: Int
    private let initialBackoffMs: Int
    private let maxRequestsPerWindow: Int
    private let window: Duration
    private let maxConcurrency: Int
    private var requestTimestamps: [ContinuousClock.Instant] = []
    private var activeRequests = 0
    private var slotWaiters: [CheckedContinuation<Void, Never>] = []

    public init(
        requester: DirectionsRequesting = MKDirectionsRequester(), maxRetries: Int = 3, initialBackoff: Duration = .seconds(2),
        maxRequestsPerWindow: Int = 40, window: Duration = .seconds(60), maxConcurrency: Int = 5
    ) {
        self.requester = requester
        self.maxRetries = maxRetries
        self.initialBackoffMs = Self.milliseconds(of: initialBackoff)
        self.maxRequestsPerWindow = maxRequestsPerWindow
        self.window = window
        self.maxConcurrency = maxConcurrency
    }

    /// Every pair gets its own child task immediately — `acquireSlot`/`releaseSlot` (an actor-wide
    /// semaphore, see the type's own doc comment) are what actually throttle how many run at once,
    /// not how many are launched. Callers that put the visible day's pairs first (as `TripMapView`
    /// does) get those answered first without this type needing any notion of "which day is
    /// visible" itself — earlier pairs simply reach the front of the semaphore's wait order first.
    public func geometry(
        for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]
    ) async throws -> PathGeometryBatch {
        var results: [[Path]?] = Array(repeating: nil, count: pairs.count)
        var retryIndices: Set<Int> = []

        await withTaskGroup(of: (Int, Path?, Error?).self) { group in
            for (index, pair) in pairs.enumerated() {
                let kind = resolvedKind(pair: pair, profile: profile, journeyRoadKinds: journeyRoadKinds)
                group.addTask {
                    await self.acquireSlot()
                    let outcome: (Path?, Error?)
                    do {
                        outcome = (try await self.routeWithRetry(pair: pair, kind: kind), nil)
                    } catch {
                        outcome = (nil, error)
                    }
                    await self.releaseSlot()
                    return (index, outcome.0, outcome.1)
                }
            }
            for await (index, path, error) in group {
                if error != nil {
                    // Anything that survives `routeWithRetry` — throttling exhausted its retries, or
                    // a non-throttle failure — is "not yet answered," never cached as "no route" by
                    // a caller (`PathGeometryBatch.retryIndices`'s own contract).
                    retryIndices.insert(index)
                } else if let path {
                    results[index] = [path]
                }
            }
        }
        return PathGeometryBatch(results: results, retryIndices: retryIndices)
    }

    /// Hands out one of `maxConcurrency` slots, shared by every concurrent `geometry(for:...)`
    /// call on this actor. A waiter that's handed a slot directly by `releaseSlot` (rather than
    /// finding one free here) skips the `activeRequests` increment below — the release already
    /// preserved the count for it.
    private func acquireSlot() async {
        if activeRequests < maxConcurrency {
            activeRequests += 1
            return
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            slotWaiters.append(continuation)
        }
    }

    private func releaseSlot() {
        if !slotWaiters.isEmpty {
            slotWaiters.removeFirst().resume()
        } else {
            activeRequests -= 1
        }
    }

    /// A Journey's chosen kind (if any) overrides the trip's default profile for this one pair —
    /// the same substitution `withJourneyRoadKind` applies elsewhere.
    private func resolvedKind(pair: PathPair, profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) -> RoadProfile {
        guard let fromId = pair.from.locationId, let toId = pair.to.locationId,
            let chosen = journeyRoadKindFor(journeyRoadKinds, fromId, toId)
        else { return profile }
        return chosen.kind
    }

    /// Backoff is "equal jitter" (`half + random(0, half)`, not the bare exponential value) so that
    /// pairs throttled by the same burst don't all wake up and retry at the same instant — a plain
    /// `2s, 4s, 8s` schedule is identical for every pair caught in one throttle event, so they'd
    /// retry in lockstep and could easily re-trigger the same throttle together, which is the "mass
    /// release" half of the symptom this type's own doc comment describes.
    private func routeWithRetry(pair: PathPair, kind: RoadProfile) async throws -> Path? {
        var attempt = 0
        var backoffMs = initialBackoffMs
        while true {
            await throttlePace()
            do {
                guard let result = try await requester.route(from: Point(lat: pair.from.lat, lng: pair.from.lng), to: Point(lat: pair.to.lat, lng: pair.to.lng), transportType: kind) else {
                    return nil
                }
                return makePath(pair: pair, kind: kind, result: result)
            } catch DirectionsRequestError.throttled where attempt < maxRetries {
                attempt += 1
                let half = backoffMs / 2
                try await Task.sleep(for: .milliseconds(half + Int.random(in: 0...max(half, 1))))
                backoffMs *= 2
            }
        }
    }

    private static func milliseconds(of duration: Duration) -> Int {
        let components = duration.components
        return Int(components.seconds * 1000 + components.attoseconds / 1_000_000_000_000_000)
    }

    /// Sliding-window pacing: before starting a request, drop timestamps older than `window`, and
    /// if `maxRequestsPerWindow` are still within it, sleep until the oldest one ages out. Keeps
    /// request *starts* under MapKit's undocumented budget instead of only reacting once it's
    /// already been exceeded.
    private func throttlePace() async {
        let now = ContinuousClock.now
        requestTimestamps.removeAll { now - $0 > window }
        if requestTimestamps.count >= maxRequestsPerWindow, let oldest = requestTimestamps.first {
            let wait = window - (now - oldest)
            if wait > .zero {
                try? await Task.sleep(for: wait)
            }
            requestTimestamps.removeFirst()
        }
        requestTimestamps.append(ContinuousClock.now)
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
