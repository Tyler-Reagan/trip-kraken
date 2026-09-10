import Foundation
import Testing
import TripKrakenKit

@testable import TripKrakenRouting

// A fake `DirectionsRequesting` — `MKRoute` has no public initializer, so a live `MKDirections`
// call is never exercised here (per the plan's own testing note). Requests are recorded by
// (from, to) coordinate pairs so a test can assert on what was actually asked for.
private actor FakeRequester: DirectionsRequesting {
    enum Answer {
        case route(RouteResult)
        case noRoute
        case throttled(untilAttempt: Int)
        case error
    }

    private var answers: [Answer]
    private(set) var callCount = 0
    private(set) var requestedTransportTypes: [RoadProfile] = []

    init(answers: [Answer]) {
        self.answers = answers
    }

    func route(from: Point, to: Point, transportType: RoadProfile) async throws -> RouteResult? {
        callCount += 1
        requestedTransportTypes.append(transportType)
        guard !answers.isEmpty else { return nil }
        switch answers.removeFirst() {
        case .route(let result): return result
        case .noRoute: return nil
        case .throttled: throw DirectionsRequestError.throttled
        case .error: throw NSError(domain: "test", code: 1)
        }
    }
}

/// Tracks how many `route` calls are simultaneously in flight, so a test can assert on the actual
/// peak concurrency observed rather than just the eventual results.
private actor ConcurrencyTrackingRequester: DirectionsRequesting {
    private(set) var current = 0
    private(set) var maxObserved = 0
    private let delay: Duration

    init(delay: Duration) {
        self.delay = delay
    }

    func route(from: Point, to: Point, transportType: RoadProfile) async throws -> RouteResult? {
        current += 1
        maxObserved = max(maxObserved, current)
        try? await Task.sleep(for: delay)
        current -= 1
        return RouteResult(coordinates: [from, to], distanceMeters: 1, durationSeconds: 1)
    }
}

private func pair(from: (Double, Double), to: (Double, Double), fromId: String? = nil, toId: String? = nil) -> PathPair {
    PathPair(
        from: PathEndpoint(lat: from.0, lng: from.1, locationId: fromId),
        to: PathEndpoint(lat: to.0, lng: to.1, locationId: toId)
    )
}

@Suite("MapKitGeometryProvider")
struct MapKitGeometryProviderTests {
    @Test("a real route becomes a single-span Path carrying MapKit's own cost")
    func realRoute() async throws {
        let result = RouteResult(coordinates: [Point(lat: 35.0, lng: 139.0), Point(lat: 35.1, lng: 139.1)], distanceMeters: 500, durationSeconds: 300)
        let requester = FakeRequester(answers: [.route(result)])
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let batch = try await provider.geometry(for: [pair(from: (35.0, 139.0), to: (35.1, 139.1))], profile: .walking, journeyRoadKinds: [])

        let path = batch.results[0]?.first
        #expect(path?.kind == .walking)
        #expect(path?.base.travelCost.answeredBy == .mapKit)
        #expect(path?.base.travelCost.basisOfCost == .routingService)
        #expect(path?.base.geometry?.first?.coordinates.count == 2)
    }

    @Test("no route (directionsNotFound) answers nil, not a retry")
    func noRoute() async throws {
        let requester = FakeRequester(answers: [.noRoute])
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let batch = try await provider.geometry(for: [pair(from: (0, 0), to: (1, 1))], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results == [nil])
        #expect(batch.retryIndices.isEmpty, "a genuine no-route answer is not \"not yet answered\"")
    }

    @Test("throttling is retried with backoff, then succeeds")
    func throttleThenSucceeds() async throws {
        let result = RouteResult(coordinates: [Point(lat: 0, lng: 0), Point(lat: 1, lng: 1)], distanceMeters: 100, durationSeconds: 60)
        let requester = FakeRequester(answers: [.throttled(untilAttempt: 1), .route(result)])
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 3, initialBackoff: .milliseconds(1))

        let batch = try await provider.geometry(for: [pair(from: (0, 0), to: (1, 1))], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results[0]?.first != nil)
        let calls = await requester.callCount
        #expect(calls == 2, "one throttled attempt, one that succeeded")
    }

    @Test("exhausting retries under sustained throttling marks the pair for retry, not failure")
    func exhaustsRetries() async throws {
        let requester = FakeRequester(answers: [.throttled(untilAttempt: 0), .throttled(untilAttempt: 1), .throttled(untilAttempt: 2)])
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 2, initialBackoff: .milliseconds(1))

        let batch = try await provider.geometry(for: [pair(from: (0, 0), to: (1, 1))], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results == [nil])
        #expect(batch.retryIndices == [0], "not a real \"no route\" answer — must not be cached as one")
    }

    @Test("a non-throttle error also marks the pair for retry, without retrying immediately")
    func nonThrottleErrorIsNotRetried() async throws {
        let requester = FakeRequester(answers: [.error])
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 3, initialBackoff: .milliseconds(1))

        let batch = try await provider.geometry(for: [pair(from: (0, 0), to: (1, 1))], profile: .walking, journeyRoadKinds: [])

        #expect(batch.retryIndices == [0])
        let calls = await requester.callCount
        #expect(calls == 1, "only throttling is retried — any other error fails fast")
    }

    @Test("a Journey's chosen kind overrides the trip's default profile for that pair")
    func chosenKindOverridesProfile() async throws {
        let result = RouteResult(coordinates: [Point(lat: 0, lng: 0), Point(lat: 1, lng: 1)], distanceMeters: 100, durationSeconds: 60)
        let requester = FakeRequester(answers: [.route(result)])
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))
        let chosen = JourneyRoadKind(id: "k1", tripId: "t1", locationAId: "a", locationBId: "b", kind: .driving)

        let batch = try await provider.geometry(
            for: [pair(from: (0, 0), to: (1, 1), fromId: "a", toId: "b")], profile: .walking, journeyRoadKinds: [chosen]
        )

        #expect(batch.results[0]?.first?.kind == .driving)
        let requested = await requester.requestedTransportTypes
        #expect(requested == [.driving])
    }

    @Test("maxConcurrency is a global bound shared across concurrent geometry(for:) calls, not one budget per call")
    func concurrencyIsGlobalAcrossConcurrentCalls() async throws {
        // Mirrors `PathGeometryCache.ensure` firing one `Task` per chunk: several concurrent
        // top-level calls into the same actor instance. Each call alone stays under
        // maxConcurrency (3 pairs vs. a bound of 3), so a per-call bound would never trip here —
        // only a bound shared across both calls can hold the true peak at 3 instead of 6.
        let requester = ConcurrencyTrackingRequester(delay: .milliseconds(30))
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1), maxConcurrency: 3)
        let pairsA = (0..<3).map { pair(from: (Double($0), 0), to: (Double($0) + 1, 1)) }
        let pairsB = (0..<3).map { pair(from: (Double($0) + 10, 0), to: (Double($0) + 11, 1)) }

        async let batchA: PathGeometryBatch = provider.geometry(for: pairsA, profile: .walking, journeyRoadKinds: [])
        async let batchB: PathGeometryBatch = provider.geometry(for: pairsB, profile: .walking, journeyRoadKinds: [])
        _ = try await (batchA, batchB)

        let peak = await requester.maxObserved
        #expect(peak <= 3, "two concurrent geometry(for:) calls must share one global concurrency bound, not 3 workers apiece")
    }

    @Test("multiple pairs are answered independently, in order")
    func multiplePairs() async throws {
        let resultA = RouteResult(coordinates: [Point(lat: 0, lng: 0), Point(lat: 1, lng: 1)], distanceMeters: 100, durationSeconds: 60)
        let requester = FakeRequester(answers: [.route(resultA), .noRoute])
        let provider = MapKitGeometryProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let batch = try await provider.geometry(
            for: [pair(from: (0, 0), to: (1, 1)), pair(from: (2, 2), to: (3, 3))], profile: .walking, journeyRoadKinds: []
        )

        #expect(batch.results[0]?.first != nil)
        #expect(batch.results[1] == nil)
    }
}
