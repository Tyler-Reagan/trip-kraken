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
struct TripMapView: View {
    let trip: TripWithDetails
    let days: [DerivedDay]
    let metros: [TripMetro]
    @Binding var selectedDayNumber: Int?

    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 35.69, longitude: 139.69), span: MKCoordinateSpan(latitudeDelta: 1.2, longitudeDelta: 1.2))
    )
    @State private var browsedMetroId: String?
    @State private var selectedLocationId: String?
    @State private var mapSize: CGSize = .zero
    @State private var geometryCache = PathGeometryCache(provider: TripMapView.makeGeometryProvider())

    /// `TRIPKRAKEN_API_BASE_URL` lets a dev point this at a non-default server; defaults to the
    /// local Next.js dev server's own default port.
    private static func makeGeometryProvider() -> PathGeometryProviding {
        let base = ProcessInfo.processInfo.environment["TRIPKRAKEN_API_BASE_URL"] ?? "http://localhost:3000"
        let endpoint = URL(string: base)!.appending(path: "api/path-geometry")
        return CompositeGeometryProvider(onDevice: MapKitGeometryProvider(), server: HTTPPathGeometryProvider(endpoint: endpoint))
    }

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
            .onChange(of: trip.id) { _, _ in
                geometryCache.reset()
                loadGeometry()
            }
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
        let name: String
        let coordinate: CLLocationCoordinate2D
        let order: Int
        let dayNumber: Int
    }

    private struct AnchorAnnotationRow: Identifiable {
        let id: String
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
                    id: stop.placement.id, name: stop.location.base.name,
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
                    id: "\(day.dayNumber)-start-\(start.base.id)", name: start.base.name,
                    coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    isTransit: start.asLocation.asTransit != nil, dayNumber: day.dayNumber
                ))
            }
            if let end = day.endAnchor, let lat = end.base.lat, let lng = end.base.lng {
                rows.append(AnchorAnnotationRow(
                    id: "\(day.dayNumber)-end-\(end.base.id)", name: end.base.name,
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
