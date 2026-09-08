import CoreLocation
import MapKit
import SwiftUI
import TripKrakenKit
import TripKrakenRouting

/// The map column of the three-column `NavigationSplitView` (ADR-0039). Walking/driving pairs are
/// answered on-device by `MapKitGeometryProvider` (ADR-0042); rail pairs by the server's trip-less
/// endpoint (ADR-0043) via `HTTPPathGeometryProvider`; `CompositeGeometryProvider` reconciles the
/// two. Anything neither answers stays a dashed straight line — a real, honest state (ADR-0029
/// §7), not a stub.
///
/// `PathGeometryCache` is app-level state (constructed once in `TripKrakenApp`), not owned here —
/// `DayDetailView`'s shift-row breakdown reads the same held geometry, so a single cache is what
/// keeps the itinerary and the map from disagreeing about what's been answered.
struct TripMapView: View {
    let trip: TripWithDetails
    let days: [DerivedDay]
    let metros: [TripMetro]
    @Binding var selectedDayNumber: Int?
    /// A one-shot "fly here" request set by an explicit button in `DayDetailView` — the only thing
    /// that moves the camera to a single location. Selecting a map annotation directly only
    /// highlights it; see `focusedLocationId`'s doc comment on `ContentView` for why.
    @Binding var focusedLocationId: String?
    @Environment(PathGeometryCache.self) private var geometryCache

    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 35.69, longitude: 139.69), span: MKCoordinateSpan(latitudeDelta: 1.2, longitudeDelta: 1.2))
    )
    @State private var browsedMetroId: String?
    @State private var selectedLocationId: String?
    @State private var mapSize: CGSize = .zero

    /// The Metro tabs are browsed independently of the sidebar's active Day — overridden by an
    /// explicit tap, else falling back to whichever Metro contains the active Day. Mirrors
    /// `browsedMetro` (`MapView.tsx:221-229`).
    private var browsedMetro: TripMetro? {
        if let browsedMetroId, let match = metros.first(where: { $0.id == browsedMetroId }) { return match }
        if let selectedDayNumber { return metroOfDay(metros, dayNumber: selectedDayNumber) }
        return metros.first
    }

    private var browsedDayNumbers: Set<Int> {
        Set(browsedMetro?.dayNumbers ?? [])
    }

    /// Rest-tier routes are alpha 0 in the source palette, so they're filtered out here rather than
    /// drawn invisibly — faithful, and the single biggest performance lever against a long trip.
    private var visibleDays: [DerivedDay] {
        days.filter { emphasisTier(dayNumber: $0.dayNumber, activeDayNumber: selectedDayNumber, browsedDayNumbers: browsedDayNumbers) != .rest }
    }

    var body: some View {
        GeometryReader { geo in
            Map(position: $position, selection: $selectedLocationId) {
                ForEach(routeSegments) { entry in
                    MapPolyline(coordinates: entry.coordinates.map(\.clCoordinate))
                        .stroke(
                            DayPalette.color(entry.dayNumber).opacity(routeAlpha(for: entry.dayNumber)),
                            style: StrokeStyle(
                                lineWidth: 3, lineCap: .round, lineJoin: .round,
                                // MapLibre's dash is in line-width units: [2, 1.5] at width 3 is
                                // 6pt on / 4.5pt off. StrokeStyle.dash is in points.
                                dash: entry.dashed ? [6, 4.5] : []
                            )
                        )
                }
                ForEach(stopAnnotations) { stop in
                    Annotation(stop.name, coordinate: stop.coordinate) {
                        Image(systemName: "\(stop.order).circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(DayPalette.textColor(stop.dayNumber), DayPalette.color(stop.dayNumber))
                            .font(.title2)
                            .opacity(dotAlpha(for: stop.dayNumber))
                    }
                    .tag(stop.id)
                }
                ForEach(anchorAnnotations) { anchor in
                    Annotation(anchor.name, coordinate: anchor.coordinate) {
                        Image(systemName: anchor.isTransit ? "airplane.circle.fill" : "bed.double.circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.black, Color(white: 0.9))
                            .font(.title)
                            .opacity(dotAlpha(for: anchor.dayNumber))
                    }
                    .tag(anchor.id)
                }
            }
            .mapStyle(.standard(pointsOfInterest: .including([.publicTransport])))
            .onAppear {
                mapSize = geo.size
                fitSelectedDay()
                loadGeometry()
            }
            .onChange(of: geo.size) { _, newSize in mapSize = newSize }
            .onChange(of: selectedDayNumber) { _, _ in fitSelectedDay() }
            .onChange(of: focusedLocationId) { _, newValue in focusOnLocation(newValue) }
            .onChange(of: trip.id) { _, _ in
                geometryCache.reset()
                loadGeometry()
            }
            .onChange(of: trip.journeyRoadKinds) { _, _ in loadGeometry() }
            .toolbar {
                if metros.count > 1 {
                    ToolbarItem {
                        Picker("Metro", selection: $browsedMetroId) {
                            ForEach(metros, id: \.id) { metro in
                                Text(metro.label).tag(Optional(metro.id))
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }
                ToolbarItem {
                    Button {
                        withAnimation(.easeInOut(duration: cameraAnimationDuration)) {
                            position = cameraPosition(fitting: boundsOfDays(days), in: mapSize)
                        }
                    } label: {
                        Label("Fit Trip", systemImage: "globe")
                    }
                }
            }
        }
    }

    private func fitSelectedDay() {
        guard let selectedDayNumber, let day = days.first(where: { $0.dayNumber == selectedDayNumber }) else {
            position = cameraPosition(fitting: boundsOfDays(days), in: mapSize)
            return
        }
        withAnimation(.easeInOut(duration: cameraAnimationDuration)) {
            position = cameraPosition(fitting: boundsOfDay(day), in: mapSize)
        }
    }

    /// A one-shot "fly here" command, consumed and cleared — set only by the external "Show on
    /// map" button in `DayDetailView` (`focusedLocationId`'s doc comment above explains why this
    /// is never driven by the map's own `selection`). Clearing it after flying means clicking the
    /// same button again re-triggers the animation instead of doing nothing on a no-op state change.
    private func focusOnLocation(_ locationId: String?) {
        guard let locationId else { return }
        let coordinate = stopAnnotations.first { $0.locationId == locationId }?.coordinate
            ?? anchorAnnotations.first { $0.locationId == locationId }?.coordinate
        defer { focusedLocationId = nil }
        guard let coordinate else { return }
        withAnimation(.easeInOut(duration: cameraAnimationDuration)) {
            position = cameraPosition(flyingTo: Point(lat: coordinate.latitude, lng: coordinate.longitude))
        }
    }

    /// Fire-and-forget: `PathGeometryCache` asks only for what's missing and lands answers into
    /// `held` asynchronously; a failure leaves pairs dashed, the correct fallback, not an error
    /// worth surfacing.
    private func loadGeometry() {
        let pairs = uniquePairsOfDays(days, profile: trip.roadProfile, journeyRoadKinds: trip.journeyRoadKinds)
        geometryCache.ensure(pairs: pairs, profile: trip.roadProfile, journeyRoadKinds: trip.journeyRoadKinds)
    }

    private func routeAlpha(for dayNumber: Int) -> Double {
        switch emphasisTier(dayNumber: dayNumber, activeDayNumber: selectedDayNumber, browsedDayNumbers: browsedDayNumbers) {
        case .active: 0.65
        case .metro: 0.18
        case .rest: 0
        }
    }

    private func dotAlpha(for dayNumber: Int) -> Double {
        switch emphasisTier(dayNumber: dayNumber, activeDayNumber: selectedDayNumber, browsedDayNumbers: browsedDayNumbers) {
        case .active: 1
        case .metro: 0.55
        case .rest: 0.28
        }
    }

    // MARK: - Map content, flattened to Identifiable rows

    private struct RouteSegmentRow: Identifiable {
        let id: String
        let coordinates: [Point]
        let dashed: Bool
        let dayNumber: Int
    }

    private struct StopAnnotationRow: Identifiable {
        let id: String
        /// The real Location id — distinct from `id` (a per-Placement identity, since the same
        /// Location could in principle repeat), and what `focusOnLocation` actually matches on.
        let locationId: String
        let name: String
        let coordinate: CLLocationCoordinate2D
        let order: Int
        let dayNumber: Int
    }

    private struct AnchorAnnotationRow: Identifiable {
        let id: String
        /// The real Location id — distinct from `id` (a per-day-per-role composite, since the same
        /// Anchor can recur across days), and what `focusOnLocation` actually matches on.
        let locationId: String
        let name: String
        let coordinate: CLLocationCoordinate2D
        let isTransit: Bool
        let dayNumber: Int
    }

    private var routeSegments: [RouteSegmentRow] {
        visibleDays.flatMap { day -> [RouteSegmentRow] in
            routeSegmentsOfDay(day, profile: trip.roadProfile, journeyRoadKinds: trip.journeyRoadKinds, geometry: geometryCache.held)
                .enumerated()
                .map { index, segment in
                    RouteSegmentRow(id: "\(day.dayNumber)-\(index)", coordinates: segment.coordinates, dashed: segment.dashed, dayNumber: segment.dayNumber)
                }
        }
    }

    private var stopAnnotations: [StopAnnotationRow] {
        visibleDays.flatMap { day in
            day.stops.enumerated().compactMap { index, stop -> StopAnnotationRow? in
                guard let lat = stop.location.base.lat, let lng = stop.location.base.lng else { return nil }
                return StopAnnotationRow(
                    id: stop.placement.id, locationId: stop.location.base.id, name: stop.location.base.name,
                    coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    order: index + 1, dayNumber: day.dayNumber
                )
            }
        }
    }

    private var anchorAnnotations: [AnchorAnnotationRow] {
        visibleDays.flatMap { day -> [AnchorAnnotationRow] in
            var rows: [AnchorAnnotationRow] = []
            if let start = day.startAnchor, let lat = start.base.lat, let lng = start.base.lng {
                rows.append(AnchorAnnotationRow(
                    id: "\(day.dayNumber)-start-\(start.base.id)", locationId: start.base.id, name: start.base.name,
                    coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    isTransit: start.asLocation.asTransit != nil, dayNumber: day.dayNumber
                ))
            }
            if let end = day.endAnchor, let lat = end.base.lat, let lng = end.base.lng {
                rows.append(AnchorAnnotationRow(
                    id: "\(day.dayNumber)-end-\(end.base.id)", locationId: end.base.id, name: end.base.name,
                    coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    isTransit: end.asLocation.asTransit != nil, dayNumber: day.dayNumber
                ))
            }
            return rows
        }
    }
}

extension Point {
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}
