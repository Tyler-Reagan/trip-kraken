import Foundation
import TripKrakenKit

/// The seam between "decide how to use a search answer" (`MapKitPlacesProvider`, fully testable)
/// and "actually ask `MKLocalSearch`" (`MKLocalSearchRequester`, thin and untestable — `MKMapItem`
/// has no public initializer with the fields we need, so a fake can't construct one). Mirrors
/// `DirectionsRequesting`'s split for the same reason (ADR-0042, ADR-0044).
public struct PlaceSearchResult: Sendable, Hashable {
    public var name: String
    public var address: String?
    public var phone: String?
    /// At most one — MapKit's `pointOfInterestCategory` is a single value, unlike Google's
    /// multi-tag `types` (ADR-0044). Already humanized for display (e.g. "Restaurant"), not the
    /// raw `MKPointOfInterestCategory` identifier.
    public var category: String?
    public var lat: Double
    public var lng: Double

    public init(name: String, address: String? = nil, phone: String? = nil, category: String? = nil, lat: Double, lng: Double) {
        self.name = name
        self.address = address
        self.phone = phone
        self.category = category
        self.lat = lat
        self.lng = lng
    }
}

public protocol PlaceSearchRequesting: Sendable {
    /// An empty array means "no matches" — a real, terminal answer, distinct from throttling.
    /// `near`, when provided, biases (does not restrict) results toward that coordinate — used to
    /// disambiguate a same-named place during enrichment; omitted entirely for an unanchored
    /// open-ended search.
    func search(query: String, near: Point?) async throws -> [PlaceSearchResult]
}

public enum PlaceSearchRequestError: Error, Sendable {
    case throttled
}
