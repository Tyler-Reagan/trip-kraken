import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

struct DayDetailView: View {
    let day: DerivedDay
    let metros: [TripMetro]
    let placesProvider: MapKitPlacesProvider
    @Binding var focusedLocationId: String?
    @Binding var browsedMetroId: String?
    @Environment(TripStore.self) private var store
    @Environment(PathGeometryCache.self) private var geometryCache
    @State private var detailLocation: TripKrakenKit.Location?
    @State private var alongRouteSearch: AlongRouteSearch?

    private struct AlongRouteSearch: Identifiable {
        let id = UUID()
        let route: [Point]
    }

    /// Only stops are placed into the plan (ADR-0015 §2) — anchors and the check-in waypoint are
    /// derived, so they render but never move.
    private var leadingEntries: [ChainEntry] {
        dayChainEntries(day).filter { $0.role == .start || $0.role == .checkin }
    }
    private var trailingEntries: [ChainEntry] {
        dayChainEntries(day).filter { $0.role == .end }
    }
    private var chain: [ChainEntry] { dayChainEntries(day) }

    var body: some View {
        VStack(spacing: 0) {
            DayHeaderView(day: day, metros: metros, browsedMetroId: $browsedMetroId)
                .padding(.horizontal)
            Divider()
            List {
                ForEach(leadingEntries, id: \.self) { row(for: $0) }
                ForEach(Array(day.stops.enumerated()), id: \.element.placement.id) { index, stop in
                    row(for: ChainEntry(role: .stop, location: .activity(stop.location), stop: stop, index: index))
                }
                .onMove(perform: moveStops)
                ForEach(trailingEntries, id: \.self) { row(for: $0) }
            }
        }
        .navigationTitle("Day \(day.dayNumber)")
        .sheet(item: $detailLocation) { location in
            NavigationStack { LocationDetailView(location: location) }
        }
        .sheet(item: $alongRouteSearch) { search in
            LocationSearchView(near: search.route.first, routePoints: search.route, provider: placesProvider)
        }
        .onAppear { loadGeometry() }
        .onChange(of: day.date) { loadGeometry() }
        .onChange(of: store.trip?.journeyRoadKinds) { loadGeometry() }
    }

    private func row(for entry: ChainEntry) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: symbolName(for: entry))
                    .foregroundStyle(.secondary)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.location.base.name).font(.body).lineLimit(1)
                    Text(subtext(for: entry)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }

                Spacer(minLength: 8)

                if entry.role == .stop, let minutes = entry.location.base.visitDuration {
                    Text(formatDuration(minutes)).font(.caption).foregroundStyle(.secondary).lineLimit(1).layoutPriority(1)
                }

                locateButton(for: entry)
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
            .onTapGesture { detailLocation = entry.location }

            gapView(after: entry)
        }
    }

    /// A "Show on map" button, external to the map itself (`ContentView`'s `focusedLocationId` doc
    /// comment explains why) — the only way any location on this list flies the map's camera to
    /// it. Hidden for an ungeocoded Location, since there's nowhere on the map to fly to.
    private func locateButton(for entry: ChainEntry) -> some View {
        Group {
            if entry.location.base.lat != nil, entry.location.base.lng != nil {
                Button {
                    focusedLocationId = entry.location.base.id
                } label: {
                    Image(systemName: "location.fill")
                }
                .buttonStyle(.borderless)
                .help("Show on map")
            }
        }
    }

    /// One gap's content — the held Path chain's shift rows, the walk/drive kind toggle, and a
    /// "find along the way" button (along-route discovery, ADR-0044's deferred third mode, picked
    /// back up), mirroring how the web app's `PathShiftRows` folds all of this onto the gap itself
    /// (`mergedEnd`) rather than onto either endpoint's own row. Renders nothing when the gap has
    /// none of the three (no geometry held yet, no real Journey to choose a kind for, and neither
    /// endpoint geocoded — a zero-length "same Location" gap, per `resolveJourneyKindToggle`'s own
    /// guard, or `routePoints`' own).
    private func gapView(after entry: ChainEntry) -> some View {
        let shifts = shiftChain(after: entry) ?? []
        let toggle = journeyToggle(after: entry)
        let route = routePoints(after: entry)
        return Group {
            if !shifts.isEmpty || toggle != nil || route != nil {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 0) {
                        ShiftRowsView(chain: shifts, hasJrPass: store.trip?.hasJrPass ?? false)
                    }
                    Spacer(minLength: 0)
                    if let route {
                        Button {
                            alongRouteSearch = AlongRouteSearch(route: route)
                        } label: {
                            Image(systemName: "mappin.and.ellipse")
                        }
                        .buttonStyle(.borderless)
                        .help("Find something along the way")
                    }
                    if let toggle {
                        Picker("", selection: Binding(get: { toggle.kind }, set: { toggle.onKindChange($0) })) {
                            Image(systemName: "figure.walk").tag(RoadProfile.walking)
                            Image(systemName: "car.fill").tag(RoadProfile.driving)
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        .frame(width: 76)
                    }
                }
                .padding(.bottom, 4)
            }
        }
    }

    /// The along-route search seed for the gap after `entry` — the flattened corridor from the
    /// held Path geometry when there is any (richer, real road/rail shape), else just the two
    /// endpoints (still enough: `flattenPathGeometry`/`samplePoints` both treat a straight line
    /// between two points as a legitimate, if less precise, route). `nil` exactly when
    /// `shiftChain`'s own guard would be — either endpoint isn't geocoded, or there's no next
    /// entry at all.
    private func routePoints(after entry: ChainEntry) -> [Point]? {
        guard let next = nextEntry(after: entry),
            let fromLat = entry.location.base.lat, let fromLng = entry.location.base.lng,
            let toLat = next.location.base.lat, let toLng = next.location.base.lng
        else { return nil }
        if let paths = shiftChain(after: entry), !paths.isEmpty {
            let flattened = flattenPathGeometry(paths)
            if flattened.count >= 2 { return flattened }
        }
        return [Point(lat: fromLat, lng: fromLng), Point(lat: toLat, lng: toLng)]
    }

    /// The next entry in the Day's chain after `entry`, if any.
    private func nextEntry(after entry: ChainEntry) -> ChainEntry? {
        guard let index = chainIndex(of: entry), index + 1 < chain.count else { return nil }
        return chain[index + 1]
    }

    private func chainIndex(of entry: ChainEntry) -> Int? {
        chain.firstIndex { $0.role == entry.role && $0.location.base.id == entry.location.base.id && $0.index == entry.index }
    }

    /// The held Path chain for the gap from `entry` to whichever entry follows it — `nil` when
    /// either end isn't geocoded, or when nothing's been asked/answered yet (`PathGeometryCache`
    /// fills this in asynchronously; an absent key just renders no shift rows, the same way the
    /// map draws that gap as a plain dashed line until it resolves).
    private func shiftChain(after entry: ChainEntry) -> [TripKrakenKit.Path]? {
        guard let next = nextEntry(after: entry),
            let fromLat = entry.location.base.lat, let fromLng = entry.location.base.lng,
            let toLat = next.location.base.lat, let toLng = next.location.base.lng,
            let trip = store.trip
        else { return nil }
        let pair = PathPair(
            from: PathEndpoint(lat: fromLat, lng: fromLng, locationId: entry.location.base.id),
            to: PathEndpoint(lat: toLat, lng: toLng, locationId: next.location.base.id)
        )
        let key = pairKey(profile: trip.roadProfile, pair: pair, journeyRoadKinds: trip.journeyRoadKinds)
        return geometryCache.held[key]
    }

    /// The walk/drive toggle for the gap from `entry` to whichever entry follows it —
    /// `resolveJourneyKindToggle` (already tested) is the single place every surface resolves a
    /// Journey's effective kind, so this never re-derives it. `nil` for a zero-length "same
    /// Location" gap (that function's own guard), which covers e.g. a check-in waypoint that
    /// happens to be the same Location as the day's start Anchor.
    private func journeyToggle(after entry: ChainEntry) -> JourneyKindToggle? {
        guard let next = nextEntry(after: entry), let trip = store.trip else { return nil }
        let fromId = entry.location.base.id
        let toId = next.location.base.id
        return resolveJourneyKindToggle(
            journeyRoadKinds: trip.journeyRoadKinds, roadProfile: trip.roadProfile, fromId: fromId, toId: toId
        ) { newKind in
            try? store.setJourneyRoadKind(from: fromId, to: toId, kind: newKind)
        }
    }

    private func loadGeometry() {
        guard let trip = store.trip else { return }
        geometryCache.ensure(pairs: pairsOfDay(day), profile: trip.roadProfile, journeyRoadKinds: trip.journeyRoadKinds)
    }

    /// `List`'s move semantics (`Array.move(fromOffsets:toOffset:)`) already account for the
    /// removal shift, so the moved placement's new index in the post-move id list is exactly the
    /// `order` to persist — `reorderPlacements` (already tested on its own) handles shifting every
    /// sibling around it.
    private func moveStops(from indices: IndexSet, to newOffset: Int) {
        guard let sourceIndex = indices.first else { return }
        let placementId = day.stops[sourceIndex].placement.id
        var ids = day.stops.map(\.placement.id)
        ids.move(fromOffsets: indices, toOffset: newOffset)
        guard let newIndex = ids.firstIndex(of: placementId) else { return }
        try? store.movePlacement(placementId: placementId, date: day.date, order: newIndex)
    }

    /// System iconography per role rather than custom badge chrome — free, theme-aware, and reads
    /// the way the rest of macOS already does (a numbered stop echoes Maps' own numbered pins).
    private func symbolName(for entry: ChainEntry) -> String {
        let isEdge = entry.location.asTransit != nil
        switch entry.role {
        case .start: return isEdge ? "airplane.arrival" : "sunrise"
        case .checkin: return "bag"
        case .end: return isEdge ? "airplane.departure" : "moon.stars"
        case .stop:
            let n = (entry.index ?? 0) + 1
            return n <= 50 ? "\(n).circle.fill" : "mappin.circle.fill"
        }
    }

    private func subtext(for entry: ChainEntry) -> String {
        switch entry.role {
        case .start: anchorSubtext(role: .start, location: entry.location)
        case .checkin: anchorSubtext(role: .checkin, location: entry.location)
        case .end: anchorSubtext(role: .end, location: entry.location)
        case .stop: entry.location.base.address ?? "Stop \((entry.index ?? 0) + 1)"
        }
    }
}
