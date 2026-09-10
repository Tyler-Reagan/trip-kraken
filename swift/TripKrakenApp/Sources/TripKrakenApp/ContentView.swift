import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore
import UniformTypeIdentifiers

/// The sidebar's selectable rows — a Day, or the standing `Unscheduled` row (ADR/planning: Slice 2
/// landed on a sidebar row over a toolbar-sheet or inline-in-the-day-list, after comparing all
/// three in a throwaway prototype). Widening this from a bare day number is the one structural
/// cost of that choice — `TripMapView` still only knows about days, so `selectedDayBinding` below
/// is the seam that hides the extra case from it.
enum SidebarSelection: Hashable {
    case day(Int)
    case unscheduled
}

struct ContentView: View {
    let placesProvider: MapKitPlacesProvider
    let optimizeProvider: OptimizeProviding
    @Environment(TripStore.self) private var store
    @Environment(PathGeometryCache.self) private var geometryCache
    @State private var sidebarSelection: SidebarSelection?
    /// A one-shot "fly the camera here" request, set only by an explicit button in
    /// `DayDetailView` — never by anything on the map itself. Clicking a map annotation only
    /// selects/highlights it; if selecting also flew the camera, zooming into a stop would push
    /// every other stop outside the viewport with no annotation left to click to get back out.
    /// The external button has no such dead end, since it's a list item, not a map pin.
    @State private var focusedLocationId: String?
    /// Which metro the map is browsing — shared between `TripMapView`'s own segmented picker and
    /// `DayHeaderView`'s metro chips (issue #235); lifted here so both can write to the same state.
    @State private var browsedMetroId: String?
    @State private var isEnriching = false
    @State private var isAddingLocation = false
    @State private var isCreatingTrip = false
    @State private var isImportingTurso = false
    @State private var isOptimizing = false
    @State private var importAlert: SimpleAlert?
    @State private var optimizeAlert: SimpleAlert?
    /// Slice 1's pre-optimize notices (`NoticeStack`) own this dismissal state here, not in the
    /// view itself, so a trip switch (`.onChange(of: store.trip?.id)` below) can reset both at
    /// once — otherwise dismissing a warning on one trip would incorrectly suppress it after
    /// switching to another, since `ContentView` doesn't remount on a trip switch.
    @State private var dismissedMetroSignature: String?
    @State private var enrichmentDismissed = false

    private struct SimpleAlert: Identifiable {
        let id = UUID()
        let message: String
    }

    private var selectedDayBinding: Binding<Int?> {
        Binding(
            get: { if case .day(let n) = sidebarSelection { n } else { nil } },
            set: { if let n = $0 { sidebarSelection = .day(n) } }
        )
    }

    private var tripSummaries: [TripSummary] { (try? store.listTripSummaries()) ?? [] }

    /// The default search bias for the general "add a location" entry point — the average of
    /// every already-geocoded Location, so a search opened with no more specific anchor still
    /// favors "near where this trip already is" over an unbiased global text search. `nil` only
    /// for a trip with no geocoded locations at all.
    private var tripCentroid: Point? {
        let points = (store.trip?.locations ?? []).compactMap { location -> Point? in
            guard let lat = location.base.lat, let lng = location.base.lng else { return nil }
            return Point(lat: lat, lng: lng)
        }
        guard !points.isEmpty else { return nil }
        return Point(
            lat: points.map(\.lat).reduce(0, +) / Double(points.count),
            lng: points.map(\.lng).reduce(0, +) / Double(points.count)
        )
    }

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                tripSwitcher
                Divider()
                List(selection: $sidebarSelection) {
                    Label("Unscheduled (\(store.unscheduledActivities.count))", systemImage: "tray")
                        .tag(SidebarSelection.unscheduled)
                    Section("Days") {
                        ForEach(store.days, id: \.dayNumber) { day in
                            VStack(alignment: .leading, spacing: 2) {
                                // Matches DayHeaderView's own hierarchy (issue #235): the calendar
                                // date is the stable anchor and always shows; "Day N" is the least
                                // useful of the two; a label displaces it, not the date.
                                Text(day.label ?? "Day \(day.dayNumber)").font(.headline)
                                Text(formatted(day.date)).font(.caption).foregroundStyle(.secondary)
                            }
                            .tag(SidebarSelection.day(day.dayNumber))
                        }
                    }
                }
            }
            .frame(minWidth: 180)
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
        } content: {
            VStack(alignment: .leading, spacing: 12) {
                if let trip = store.trip {
                    NoticeStack(
                        data: noticeData(trip),
                        onDismissTransitCaveat: { try? store.setTransitCaveatDismissed(true) },
                        onRetryEnrichment: {
                            isEnriching = true
                            Task {
                                await enrichPendingLocations(store: store, provider: placesProvider)
                                isEnriching = false
                            }
                        },
                        isRetrying: isEnriching,
                        dismissedMetroSignature: $dismissedMetroSignature,
                        enrichmentDismissed: $enrichmentDismissed
                    )
                    .padding([.horizontal, .top])
                }
                switch sidebarSelection {
                case .unscheduled:
                    UnscheduledView(placesProvider: placesProvider)
                case .day(let dayNumber):
                    if let day = store.days.first(where: { $0.dayNumber == dayNumber }) {
                        DayDetailView(
                            day: day, metros: store.metros, placesProvider: placesProvider,
                            focusedLocationId: $focusedLocationId, browsedMetroId: $browsedMetroId
                        )
                    }
                case nil:
                    ContentUnavailableView("Select a day", systemImage: "calendar")
                }
            }
            .frame(minWidth: 320)
            .navigationSplitViewColumnWidth(min: 320, ideal: 420, max: 640)
        } detail: {
            if let trip = store.trip {
                TripMapView(
                    trip: trip, days: store.days, metros: store.metros, selectedDayNumber: selectedDayBinding,
                    focusedLocationId: $focusedLocationId, browsedMetroId: $browsedMetroId
                )
            } else {
                ContentUnavailableView("No trip loaded", systemImage: "map")
            }
        }
        .onAppear { sidebarSelection = store.days.first.map { .day($0.dayNumber) } }
        .onChange(of: store.trip?.id) {
            // Any trip switch — an explicit pick or a fresh `createTrip` — lands here, since both
            // funnel through `store.trip` changing. `PathGeometryCache.held` is keyed by
            // coordinate/profile, not trip id (its own doc comment says so), so it must be cleared
            // by hand or a new trip's map would render stale geometry from the old one.
            geometryCache.reset()
            sidebarSelection = store.days.first.map { .day($0.dayNumber) }
            focusedLocationId = nil
            browsedMetroId = nil
            dismissedMetroSignature = nil
            enrichmentDismissed = false
        }
        .toolbar {
            ToolbarItem {
                Button {
                    isAddingLocation = true
                } label: {
                    Label("Add Location", systemImage: "magnifyingglass")
                }
                .help("Search for a place to add to this trip")
            }
            ToolbarItem {
                Button {
                    isEnriching = true
                    Task {
                        await enrichPendingLocations(store: store, provider: placesProvider)
                        isEnriching = false
                    }
                } label: {
                    if isEnriching {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Enrich", systemImage: "sparkles")
                    }
                }
                .disabled(isEnriching)
                .help("Look up address/phone/category for any location missing them")
            }
            ToolbarItem {
                Button {
                    isOptimizing = true
                    Task {
                        await runOptimize()
                        isOptimizing = false
                    }
                } label: {
                    if isOptimizing {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Optimize", systemImage: "wand.and.stars")
                    }
                }
                .disabled(isOptimizing || store.trip == nil)
                .help("Re-plan every day's order with VROOM (ADR-0045) — replaces the current plan wholesale")
            }
        }
        .sheet(isPresented: $isAddingLocation) {
            LocationSearchView(near: tripCentroid, provider: placesProvider)
        }
        .sheet(isPresented: $isCreatingTrip) {
            TripCreateView(existingTrips: tripSummaries) { _ in }
        }
        .fileImporter(isPresented: $isImportingTurso, allowedContentTypes: [.data]) { result in
            switch result {
            case .success(let url):
                importTursoExport(from: url)
            case .failure(let error):
                importAlert = SimpleAlert(message: "Couldn't open that file: \(error.localizedDescription)")
            }
        }
        .alert(item: $importAlert) { alert in
            Alert(title: Text("Import"), message: Text(alert.message), dismissButton: .default(Text("OK")))
        }
        .alert(item: $optimizeAlert) { alert in
            Alert(title: Text("Optimize"), message: Text(alert.message), dismissButton: .default(Text("OK")))
        }
        .frame(minWidth: 900, minHeight: 500)
    }

    /// ADR-0045: shapes the current trip into an `OptimizeProblem`, calls the trip-less
    /// `/api/optimize` endpoint, and persists the result wholesale. `unplaced`/`warnings` are also
    /// cached on `TripStore.lastUnplaced`/`lastOptimizeWarnings` for `UnscheduledView` to read, on
    /// top of this method's own completion alert.
    private func runOptimize() async {
        guard let trip = store.trip else { return }
        let problem = optimizationProblem(for: trip)
        do {
            let itinerary = try await optimizeProvider.optimize(problem)
            try store.applyOptimizedPlacements(itinerary)
            // Mirrors the web app: "a fresh optimize is the one event that resurfaces" a dismissed
            // enrichment-failure notice, even though retries in between may have fixed some of the
            // named places but not others.
            enrichmentDismissed = false
            var message = "Re-planned \(itinerary.days.count) day\(itinerary.days.count == 1 ? "" : "s")."
            if !itinerary.unplaced.isEmpty {
                message += " \(itinerary.unplaced.count) location\(itinerary.unplaced.count == 1 ? "" : "s") couldn't be placed."
            }
            if !itinerary.warnings.isEmpty {
                message += " " + itinerary.warnings.joined(separator: " ")
            }
            optimizeAlert = SimpleAlert(message: message)
        } catch {
            optimizeAlert = SimpleAlert(message: "Optimize failed: \(error.localizedDescription)")
        }
    }

    /// One-time migration from a Turso/libSQL SQLite export (ADR-0038 keeps Turso itself out of
    /// ongoing Swift-client use — see `TursoImportReader`'s own doc comment). `url.startAccessingSecurityScopedResource()`
    /// is required for a `.fileImporter`-granted path outside the app's sandbox container; without
    /// it, `sqlite3_open_v2` would fail with a permissions error despite the picker having just
    /// shown the user this exact file.
    private func importTursoExport(from url: URL) {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let ids = try store.importFromTursoExport(path: url.path)
            importAlert = SimpleAlert(message: "Imported \(ids.count) trip\(ids.count == 1 ? "" : "s").")
        } catch {
            importAlert = SimpleAlert(message: "Import failed: \(error.localizedDescription)")
        }
    }

    /// Sidebar-level trip switcher — sits above the day list rather than in the window's shared
    /// toolbar, so it reads as part of the sidebar itself (ADR-0038-era "native ergonomics"
    /// direction: a plain `Menu` here, not custom chrome). `TripStore.load`/`createTrip` already
    /// do the actual switching; this is only the entry point plus, via `.onChange(of:
    /// store.trip?.id)` above, the UI-state reset a switch needs.
    private var tripSwitcher: some View {
        Menu {
            ForEach(tripSummaries, id: \.id) { summary in
                Button(summary.name) { try? store.load(tripId: summary.id) }
            }
            Divider()
            Button("New Trip…") { isCreatingTrip = true }
            Button("Import from Turso Export…") { isImportingTurso = true }
        } label: {
            HStack {
                Text(store.trip?.name ?? "Trip").font(.headline)
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
            }
        }
        .menuStyle(.borderlessButton)
        .padding(8)
    }
}

#Preview {
    let store = try! makePreviewStore()
    return ContentView(placesProvider: MapKitPlacesProvider(), optimizeProvider: HTTPOptimizeProvider(endpoint: URL(string: "http://localhost:3000/api/optimize")!))
        .environment(store)
        .environment(PathGeometryCache(provider: NoGeometryProvider()))
}

@MainActor
private func makePreviewStore() throws -> TripStore {
    let store = TripStore(container: try TripKrakenContainer.inMemory())
    try store.seedIfEmpty(with: .sample)
    return store
}
