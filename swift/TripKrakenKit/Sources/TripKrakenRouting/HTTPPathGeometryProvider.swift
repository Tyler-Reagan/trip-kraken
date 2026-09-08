import Foundation
import TripKrakenKit

/// Thin seam over `URLSession`, so `HTTPPathGeometryProvider`'s actual decision logic (batching,
/// DTO mapping, retry-index passthrough) can be tested against canned bytes rather than a live
/// server (ADR-0043's endpoint).
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> Data
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}

/// Calls ADR-0043's trip-less `POST /api/path-geometry` — the rail-capable half of geometry
/// resolution once the server is reachable. Batches at `maxPairs` per request, matching the
/// server's own `MAX_PAIRS` limit.
public struct HTTPPathGeometryProvider: PathGeometryProviding {
    private let endpoint: URL
    private let transport: HTTPTransport
    private let maxPairs: Int

    public init(endpoint: URL, transport: HTTPTransport = URLSessionTransport(), maxPairs: Int = 600) {
        self.endpoint = endpoint
        self.transport = transport
        self.maxPairs = maxPairs
    }

    public func geometry(
        for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]
    ) async throws -> PathGeometryBatch {
        guard !pairs.isEmpty else { return PathGeometryBatch(results: [], retryIndices: []) }

        var results: [[Path]?] = []
        var retryIndices: Set<Int> = []
        var offset = 0

        for chunk in pairs.chunked(into: maxPairs) {
            let requestDTO = PathGeometryRequestDTO(pairs: chunk, roadProfile: profile, journeyRoadKinds: journeyRoadKinds)
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(requestDTO)

            let data = try await transport.send(request)
            let responseDTO = try JSONDecoder().decode(PathGeometryResponseDTO.self, from: data)

            results.append(contentsOf: responseDTO.results.map { $0.map { $0.map(toDomain) } })
            for index in responseDTO.retry { retryIndices.insert(offset + index) }
            offset += chunk.count
        }

        return PathGeometryBatch(results: results, retryIndices: retryIndices)
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
