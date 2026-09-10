import Foundation
import Testing
import TripKrakenKit

@testable import TripKrakenRouting

private actor StubProvider: PathGeometryProviding {
    private var answers: [PathGeometryBatch]
    private(set) var requestedPairSets: [[PathPair]] = []

    init(answers: [PathGeometryBatch]) {
        self.answers = answers
    }

    func geometry(for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) async throws -> PathGeometryBatch {
        requestedPairSets.append(pairs)
        guard !answers.isEmpty else { return PathGeometryBatch(results: Array(repeating: nil, count: pairs.count), retryIndices: []) }
        return answers.removeFirst()
    }
}

/// The first call to reach the actor resolves immediately; every later call waits 100ms — lets a
/// test observe "one chunk landed, the rest are still in flight" deterministically.
private actor FirstFastRestSlowProvider: PathGeometryProviding {
    private var callCount = 0

    func geometry(for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) async throws -> PathGeometryBatch {
        callCount += 1
        if callCount > 1 {
            try? await Task.sleep(for: .milliseconds(100))
        }
        return PathGeometryBatch(results: Array(repeating: [realPath()], count: pairs.count), retryIndices: [])
    }
}

private func pair(_ n: Double) -> PathPair {
    PathPair(from: PathEndpoint(lat: n, lng: n), to: PathEndpoint(lat: n + 1, lng: n + 1))
}

private func realPath() -> Path {
    .walking(WalkingPath(base: PathBase(
        from: PathEndpoint(lat: 0, lng: 0), to: PathEndpoint(lat: 1, lng: 1),
        travelCost: TravelCost(distanceMeters: 1, durationSeconds: 1, basisOfCost: .routingService, answeredBy: .osrm), geometry: nil
    )))
}

@MainActor
@Suite("PathGeometryCache")
struct PathGeometryCacheTests {
    @Test("a real answer lands in held, keyed by pairKey")
    func realAnswerLands() async throws {
        let provider = StubProvider(answers: [PathGeometryBatch(results: [[realPath()]], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)
        let p = pair(0)

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))

        let key = pairKey(profile: .walking, pair: p, journeyRoadKinds: [])
        #expect(cache.held[key]?.first != nil)
    }

    @Test("a nil answer caches as an empty array, not left absent")
    func nilAnswerCachesAsEmpty() async throws {
        let provider = StubProvider(answers: [PathGeometryBatch(results: [nil], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)
        let p = pair(0)

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))

        let key = pairKey(profile: .walking, pair: p, journeyRoadKinds: [])
        #expect(cache.held[key] == [], "absent and [] both draw dashed straight, but a real answer was already given — cache it")
    }

    @Test("only missing pairs are asked for on a second ensure")
    func onlyMissingPairsAreAsked() async throws {
        let p1 = pair(0)
        let p2 = pair(10)
        let provider = StubProvider(answers: [PathGeometryBatch(results: [[realPath()]], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)

        cache.ensure(pairs: [p1], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))
        cache.ensure(pairs: [p1, p2], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))

        let requested = await provider.requestedPairSets
        #expect(requested.count == 2)
        #expect(requested[1] == [p2], "p1 is already held, so the second ensure asks only for p2")
    }

    @Test("a retry index is never cached, and is retried after the delay")
    func retryIndexIsRetried() async throws {
        let p = pair(0)
        let provider = StubProvider(answers: [
            PathGeometryBatch(results: [nil], retryIndices: [0]),
            PathGeometryBatch(results: [[realPath()]], retryIndices: []),
        ])
        let cache = PathGeometryCache(provider: provider, maxRetryRounds: 2, retryDelay: .milliseconds(10))

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(20))

        let key = pairKey(profile: .walking, pair: p, journeyRoadKinds: [])
        #expect(cache.held[key] == nil, "not yet answered after the first (retryable) attempt")

        try await Task.sleep(for: .milliseconds(100))
        #expect(cache.held[key]?.first != nil, "the retry round succeeded")
    }

    @Test("a large ask is split into chunkSize-pair provider calls, not one call for everything")
    func largeAskIsChunked() async throws {
        let pairs = (0..<5).map { pair(Double($0)) }
        let provider = StubProvider(answers: [
            PathGeometryBatch(results: [[realPath()], [realPath()]], retryIndices: []),
            PathGeometryBatch(results: [[realPath()], [realPath()]], retryIndices: []),
            PathGeometryBatch(results: [[realPath()]], retryIndices: []),
        ])
        let cache = PathGeometryCache(provider: provider, chunkSize: 2)

        cache.ensure(pairs: pairs, profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))

        let requested = await provider.requestedPairSets
        #expect(requested.count == 3, "5 pairs at chunkSize 2 makes three calls (2, 2, 1), not one call for all 5")
        #expect(requested.allSatisfy { $0.count <= 2 })
        for pair in pairs {
            let key = pairKey(profile: .walking, pair: pair, journeyRoadKinds: [])
            #expect(cache.held[key]?.first != nil, "every pair still lands in held once its own chunk resolves")
        }
    }

    @Test("pendingCount counts down as each chunk resolves, not all at once")
    func pendingCountCountsDownPerChunk() async throws {
        let pairs = (0..<4).map { pair(Double($0)) }
        let provider = FirstFastRestSlowProvider()
        let cache = PathGeometryCache(provider: provider, chunkSize: 1)

        cache.ensure(pairs: pairs, profile: .walking, journeyRoadKinds: [])
        #expect(cache.pendingCount == 4)

        try await Task.sleep(for: .milliseconds(30))
        #expect(cache.pendingCount == 3, "the one chunk that resolved fast should drop the count by one, not zero it out")

        try await Task.sleep(for: .milliseconds(150))
        #expect(cache.pendingCount == 0)
    }

    @Test("reset clears held state so a trip switch starts clean")
    func resetClears() async throws {
        let provider = StubProvider(answers: [PathGeometryBatch(results: [[realPath()]], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)
        let p = pair(0)

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))
        cache.reset()

        #expect(cache.held.isEmpty)
    }
}
