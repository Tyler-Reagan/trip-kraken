import CoreLocation
import MapKit
import SwiftUI
import TripKrakenKit

/// `Bounds` → `MapCameraPosition`, re-expressing `MapView.tsx`'s camera block (`:120-145`,
/// `:596-660`) on MapKit's SwiftUI API rather than MapLibre's imperative `fitBounds`/`flyTo`.

/// The native equivalent of MapLibre's `maxZoom: STOP_ZOOM` (=14). MapKit's SwiftUI API has no zoom
/// levels, so zoom 14 is expressed twice: as a camera distance for the fly-to tiers below, and as a
/// **minimum span floor** in `region(fitting:)` — the floor is what rescues a degenerate
/// single-point box, exactly as `maxZoom` did for a one-point `fitBounds`.
let stopCameraDistance: CLLocationDistance = 9_000
/// `CAMERA_MS`.
let cameraAnimationDuration: Double = 0.65
/// `FIT_PADDING`. MapKit's SwiftUI API has no `fitBounds(padding:)`, so this is applied as span
/// inflation plus a center shift in `region(fitting:)` rather than a literal inset.
let fitPaddingPoints: CGFloat = 28

/// A one-point box has no extent; a two-point box within one metro can be metres wide. Both should
/// land on the same visible floor rather than one being imperceptibly tiny.
private func minimumSpanDegrees(atLatitude lat: CLLocationDegrees) -> (lat: CLLocationDegrees, lng: CLLocationDegrees) {
    let latDelta = stopCameraDistance / 111_320
    let lngDelta = latDelta / max(cos(lat * .pi / 180), 0.01)
    return (latDelta, lngDelta)
}

/// Builds a region that fits `bounds`, inflated by `insets` and floored at `stopCameraDistance`'s
/// equivalent span. No antimeridian handling — a Japan-and-adjacent product doesn't cross it, and a
/// wrong-side pan there would be a visible, cheap-to-fix bug rather than silent corruption.
func region(fitting bounds: Bounds, in size: CGSize, insets: EdgeInsets = EdgeInsets(top: fitPaddingPoints, leading: fitPaddingPoints, bottom: fitPaddingPoints, trailing: fitPaddingPoints)) -> MKCoordinateRegion {
    let centerLat = (bounds.southwest.lat + bounds.northeast.lat) / 2
    let centerLng = (bounds.southwest.lng + bounds.northeast.lng) / 2
    let rawLatSpan = bounds.northeast.lat - bounds.southwest.lat
    let rawLngSpan = bounds.northeast.lng - bounds.southwest.lng

    let width = max(size.width, 1)
    let height = max(size.height, 1)
    let inflatedLatSpan = rawLatSpan * height / max(height - insets.top - insets.bottom, 1)
    let inflatedLngSpan = rawLngSpan * width / max(width - insets.leading - insets.trailing, 1)

    let floor = minimumSpanDegrees(atLatitude: centerLat)
    let latSpan = max(inflatedLatSpan, floor.lat)
    let lngSpan = max(inflatedLngSpan, floor.lng)

    // Asymmetric insets (a docked panel wider on one side) shift the center rather than the span.
    let shiftedLat = centerLat + latSpan * Double((insets.bottom - insets.top) / 2 / height)
    let shiftedLng = centerLng - lngSpan * Double((insets.leading - insets.trailing) / 2 / width)

    return MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: shiftedLat, longitude: shiftedLng),
        span: MKCoordinateSpan(latitudeDelta: latSpan, longitudeDelta: lngSpan)
    )
}

/// Tokyo fallback (`MapView.tsx:124`), for when there is nothing geocoded to fit at all.
private let fallbackRegion = MKCoordinateRegion(
    center: CLLocationCoordinate2D(latitude: 35.69, longitude: 139.69),
    span: MKCoordinateSpan(latitudeDelta: 1.2, longitudeDelta: 1.2)
)

/// `nil` bounds (nothing geocoded) lands on the Tokyo fallback; a single point's zero-extent box is
/// rescued by the minimum-span floor inside `region(fitting:)`; two or more points fit normally.
func cameraPosition(fitting bounds: Bounds?, in size: CGSize, insets: EdgeInsets = EdgeInsets(top: fitPaddingPoints, leading: fitPaddingPoints, bottom: fitPaddingPoints, trailing: fitPaddingPoints)) -> MapCameraPosition {
    guard let bounds else { return .region(fallbackRegion) }
    return .region(region(fitting: bounds, in: size, insets: insets))
}

/// `STOP_ZOOM`-equivalent fly-to, for the `stop`/`point` focus tiers.
func cameraPosition(flyingTo point: Point) -> MapCameraPosition {
    .camera(MapCamera(
        centerCoordinate: CLLocationCoordinate2D(latitude: point.lat, longitude: point.lng),
        distance: stopCameraDistance
    ))
}
