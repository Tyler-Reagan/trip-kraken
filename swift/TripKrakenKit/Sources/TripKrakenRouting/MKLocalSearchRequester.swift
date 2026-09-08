import CoreLocation
import MapKit
import TripKrakenKit

/// The one piece of this target that actually talks to `MKLocalSearch` (ADR-0044). Thin by design,
/// mirroring `MKDirectionsRequester`: every decision (retry, backoff, single-best-match vs. every
/// result) lives in `MapKitPlacesProvider`, which is what tests exercise; this type is exercised
/// only by running the app.
public struct MKLocalSearchRequester: PlaceSearchRequesting {
    public init() {}

    public func search(query: String, near: Point?) async throws -> [PlaceSearchResult] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        if let near {
            request.region = MKCoordinateRegion(
                center: near.coordinate,
                latitudinalMeters: 5000, longitudinalMeters: 5000
            )
        }

        do {
            let response = try await MKLocalSearch(request: request).start()
            return response.mapItems.map(Self.makeResult)
        } catch let error as MKError where error.code == .placemarkNotFound {
            return []
        } catch let error as MKError where error.code == .loadingThrottled {
            throw PlaceSearchRequestError.throttled
        }
    }

    private static func makeResult(from item: MKMapItem) -> PlaceSearchResult {
        PlaceSearchResult(
            name: item.name ?? "",
            address: item.address?.fullAddress,
            phone: item.phoneNumber,
            category: item.pointOfInterestCategory.map(humanized),
            lat: item.location.coordinate.latitude,
            lng: item.location.coordinate.longitude
        )
    }

    /// `MKPointOfInterestCategory`'s raw identifier (e.g. `"MKPOICategoryRestaurant"`) isn't
    /// display text — strip the known prefix, then space out the remaining PascalCase
    /// (`"MovieTheater"` → `"Movie Theater"`) so `LocationDetailView`'s existing category
    /// formatting (built for Google's snake_case `types`) still renders something readable.
    private static func humanized(_ category: MKPointOfInterestCategory) -> String {
        var raw = category.rawValue
        if raw.hasPrefix("MKPOICategory") {
            raw.removeFirst("MKPOICategory".count)
        }
        var result = ""
        for (index, char) in raw.enumerated() {
            if index > 0, char.isUppercase { result.append(" ") }
            result.append(char)
        }
        return result
    }
}

private extension Point {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
}
