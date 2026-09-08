import Foundation
import TripKrakenKit

/// The seam between "decide how to use a route answer" (`MapKitGeometryProvider`, fully testable)
/// and "actually ask `MKDirections`" (`MKDirectionsRequester`, thin and untestable — `MKRoute` has
/// no public initializer, so a fake can't construct one; this boundary exists so tests never need
/// to). Deliberately decoupled from every MapKit type: `RouteResult` is a plain value a test can
/// build directly.
public struct RouteResult: Sendable, Hashable {
    public var coordinates: [Point]
    public var distanceMeters: Double
    public var durationSeconds: Double

    public init(coordinates: [Point], distanceMeters: Double, durationSeconds: Double) {
        self.coordinates = coordinates
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
    }
}

public protocol DirectionsRequesting: Sendable {
    /// `nil` means "no route" (Apple's `directionsNotFound` for this transport type — a real,
    /// terminal answer). Throws `DirectionsRequestError.throttled` for `MKError.loadingThrottled`
    /// specifically, so the caller can retry only that case; any other thrown error is treated as
    /// non-retryable.
    func route(from: Point, to: Point, transportType: RoadProfile) async throws -> RouteResult?
}

public enum DirectionsRequestError: Error, Sendable {
    case throttled
}
