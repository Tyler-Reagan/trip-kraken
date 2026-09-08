import CoreLocation
import MapKit
import TripKrakenKit

/// The one piece of this target that actually talks to `MKDirections` (ADR-0042). Thin by design —
/// every decision (retry, backoff, which pairs to ask, how to build a `Path`) lives in
/// `MapKitGeometryProvider`, which is what tests exercise; this type is exercised only by running
/// the app.
public struct MKDirectionsRequester: DirectionsRequesting {
    public init() {}

    public func route(from: Point, to: Point, transportType: RoadProfile) async throws -> RouteResult? {
        let request = MKDirections.Request()
        request.source = MKMapItem(location: CLLocation(latitude: from.lat, longitude: from.lng), address: nil)
        request.destination = MKMapItem(location: CLLocation(latitude: to.lat, longitude: to.lng), address: nil)
        request.transportType = transportType == .driving ? .automobile : .walking

        do {
            let response = try await MKDirections(request: request).calculate()
            guard let route = response.routes.first else { return nil }
            return RouteResult(
                coordinates: route.polyline.coordinates.map { Point(lat: $0.latitude, lng: $0.longitude) },
                distanceMeters: route.distance,
                durationSeconds: route.expectedTravelTime
            )
        } catch let error as MKError where error.code == .directionsNotFound {
            return nil
        } catch let error as MKError where error.code == .loadingThrottled {
            throw DirectionsRequestError.throttled
        }
    }
}

private extension MKPolyline {
    var coordinates: [CLLocationCoordinate2D] {
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: pointCount)
        getCoordinates(&coords, range: NSRange(location: 0, length: pointCount))
        return coords
    }
}
