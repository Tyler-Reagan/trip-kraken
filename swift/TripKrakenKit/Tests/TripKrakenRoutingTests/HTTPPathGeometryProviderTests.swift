import Foundation
import Testing
import TripKrakenKit

@testable import TripKrakenRouting

private actor FakeTransport: HTTPTransport {
    private var responses: [Data]
    private(set) var sentRequests: [URLRequest] = []

    init(responses: [Data]) {
        self.responses = responses
    }

    func send(_ request: URLRequest) async throws -> Data {
        sentRequests.append(request)
        guard !responses.isEmpty else { return Data("""
            {"results":[],"retry":[]}
            """.utf8) }
        return responses.removeFirst()
    }
}

private func pair(_ n: Double) -> PathPair {
    PathPair(from: PathEndpoint(lat: n, lng: n), to: PathEndpoint(lat: n + 1, lng: n + 1))
}

private let okResponse = Data("""
    {"results":[[{"kind":"walking","from":{"lat":0,"lng":0},"to":{"lat":1,"lng":1},
      "travelCost":{"distanceMeters":10,"durationSeconds":5,"basisOfCost":"routingService","answeredBy":"osrm"}}]],
     "retry":[]}
    """.utf8)

@Suite("HTTPPathGeometryProvider")
struct HTTPPathGeometryProviderTests {
    @Test("posts to the given endpoint and maps the response")
    func postsAndMaps() async throws {
        let transport = FakeTransport(responses: [okResponse])
        let provider = HTTPPathGeometryProvider(endpoint: URL(string: "https://example.com/api/path-geometry")!, transport: transport)

        let batch = try await provider.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results[0]?.first?.asWalking != nil)
        let sent = await transport.sentRequests
        #expect(sent.first?.url?.absoluteString == "https://example.com/api/path-geometry")
        #expect(sent.first?.httpMethod == "POST")
    }

    @Test("an empty request never calls the transport")
    func emptyRequest() async throws {
        let transport = FakeTransport(responses: [])
        let provider = HTTPPathGeometryProvider(endpoint: URL(string: "https://example.com")!, transport: transport)

        let batch = try await provider.geometry(for: [], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results.isEmpty)
        let sent = await transport.sentRequests
        #expect(sent.isEmpty)
    }

    @Test("more pairs than maxPairs are split into multiple requests, results kept in order")
    func batchesOverLimit() async throws {
        let secondResponse = Data("""
            {"results":[null],"retry":[]}
            """.utf8)
        let transport = FakeTransport(responses: [okResponse, secondResponse])
        let provider = HTTPPathGeometryProvider(endpoint: URL(string: "https://example.com")!, transport: transport, maxPairs: 1)

        let batch = try await provider.geometry(for: [pair(0), pair(10)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results.count == 2)
        #expect(batch.results[0]?.first?.asWalking != nil)
        #expect(batch.results[1] == nil)
        let sent = await transport.sentRequests
        #expect(sent.count == 2, "one request per chunk of maxPairs")
    }

    @Test("a retry index in a later chunk is offset correctly")
    func retryIndexOffsetAcrossChunks() async throws {
        let retryInSecondChunk = Data("""
            {"results":[null],"retry":[0]}
            """.utf8)
        let transport = FakeTransport(responses: [okResponse, retryInSecondChunk])
        let provider = HTTPPathGeometryProvider(endpoint: URL(string: "https://example.com")!, transport: transport, maxPairs: 1)

        let batch = try await provider.geometry(for: [pair(0), pair(10)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.retryIndices == [1], "index 0 within the second chunk is global index 1")
    }
}
