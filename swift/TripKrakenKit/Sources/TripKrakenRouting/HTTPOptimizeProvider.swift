import Foundation
import TripKrakenKit

/// Calls ADR-0045's trip-less `POST /api/optimize` — the only way this Swift client reaches the
/// Decision layer (VROOM, ADR-0023/ADR-0038), which has no on-device equivalent and isn't meant to
/// get one for Phase A. `OptimizeProblem`/`Itinerary` are already `Codable` in `TripKrakenKit`
/// directly (no DTO layer, unlike `Path`/`Location` — see `Optimize.swift`'s header), so this type
/// is thinner than `HTTPPathGeometryProvider`: no batching (a trip's optimize request is one call,
/// not per-pair), no DTO mapping.
public struct HTTPOptimizeProvider: OptimizeProviding {
    private let endpoint: URL
    private let transport: HTTPTransport

    public init(endpoint: URL, transport: HTTPTransport = URLSessionTransport()) {
        self.endpoint = endpoint
        self.transport = transport
    }

    public func optimize(_ problem: OptimizeProblem) async throws -> Itinerary {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(problem)

        let data = try await transport.send(request)
        return try JSONDecoder().decode(Itinerary.self, from: data)
    }
}
