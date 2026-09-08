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
            {"days":[],"unplaced":[],"warnings":[]}
            """.utf8) }
        return responses.removeFirst()
    }
}

private func problem() -> OptimizeProblem {
    OptimizeProblem(
        locations: [OptimizeLocationInput(id: "a", lat: 35.0, lng: 139.0, kind: .activity)],
        numDays: 3, stays: [], kinds: [.rail, .bus, .walking], hasJrPass: false,
        edges: OptimizeEdges(), journeyRoadKinds: []
    )
}

private let okResponse = Data("""
    {"days":[{"dayNumber":1,"locationIds":["a"],"timing":[{"arrival":1000,"waitingSeconds":0}]}],
     "unplaced":[{"locationId":"b","code":"closed-all-days","reason":"never open"}],
     "warnings":["lodging still pending"]}
    """.utf8)

@Suite("HTTPOptimizeProvider")
struct HTTPOptimizeProviderTests {
    @Test("posts to the given endpoint and decodes the itinerary")
    func postsAndDecodes() async throws {
        let transport = FakeTransport(responses: [okResponse])
        let provider = HTTPOptimizeProvider(endpoint: URL(string: "https://example.com/api/optimize")!, transport: transport)

        let itinerary = try await provider.optimize(problem())

        #expect(itinerary.days.first?.dayNumber == 1)
        #expect(itinerary.days.first?.locationIds == ["a"])
        #expect(itinerary.days.first?.timing?.first?.arrival == 1000)
        #expect(itinerary.unplaced.first?.locationId == "b")
        #expect(itinerary.unplaced.first?.code == .closedAllDays)
        #expect(itinerary.warnings == ["lodging still pending"])

        let sent = await transport.sentRequests
        #expect(sent.first?.url?.absoluteString == "https://example.com/api/optimize")
        #expect(sent.first?.httpMethod == "POST")
    }

    @Test("an empty itinerary round-trips cleanly")
    func emptyItinerary() async throws {
        let transport = FakeTransport(responses: [])
        let provider = HTTPOptimizeProvider(endpoint: URL(string: "https://example.com")!, transport: transport)

        let itinerary = try await provider.optimize(problem())

        #expect(itinerary.days.isEmpty)
        #expect(itinerary.unplaced.isEmpty)
        #expect(itinerary.warnings.isEmpty)
    }
}
