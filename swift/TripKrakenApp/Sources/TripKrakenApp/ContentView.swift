import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore
import UniformTypeIdentifiers

struct ContentView: View {
    let placesProvider: MapKitPlacesProvider
    @Environment(TripStore.self) private var store
    @Environment(PathGeometryCache.self) private var geometryCache
    @State private var selectedDayNumber: Int?
    /// A one-shot "fly the camera here" request, set only by an explicit button in
    /// `DayDetailView` — never by anything on the map itself. Clicking a map annotation only
    /// selects/highlights it; if selecting also flew the camera, zooming into a stop would push
    /// every other stop outside the viewport with no annotation left to click to get back out.
    /// The external button has no such dead end, since it's a list item, not a map pin.
    @State private var focusedLocationId: String?
    @State private var isEnriching = false
    @State private var isAddingLocation = false
    @State private var isCreatingTrip = false
    @State private var isImportingTurso = false
    @State private var importAlert: ImportAlert?

    private struct ImportAlert: Identifiable {
        let id = UUID()
        let message: String
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
                List(store.days, id: \.dayNumber, selection: $selectedDayNumber) { day in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Day \(day.dayNumber)").font(.headline)
                        Text(day.label ?? formatted(day.date)).font(.caption).foregroundStyle(.secondary)
                    }
                    .tag(day.dayNumber)
                }
            }
            .frame(minWidth: 180)
        } content: {
            if let day = store.days.first(where: { $0.dayNumber == selectedDayNumber }) {
                DayDetailView(day: day, focusedLocationId: $focusedLocationId)
                    .frame(minWidth: 260)
            } else {
                ContentUnavailableView("Select a day", systemImage: "calendar")
            }
        } detail: {
            if let trip = store.trip {
                TripMapView(trip: trip, days: store.days, metros: store.metros, selectedDayNumber: $selectedDayNumber, focusedLocationId: $focusedLocationId)
            } else {
                ContentUnavailableView("No trip loaded", systemImage: "map")
            }
        }
        .onAppear { selectedDayNumber = store.days.first?.dayNumber }
        .onChange(of: store.trip?.id) {
            // Any trip switch — an explicit pick or a fresh `createTrip` — lands here, since both
            // funnel through `store.trip` changing. `PathGeometryCache.held` is keyed by
            // coordinate/profile, not trip id (its own doc comment says so), so it must be cleared
            // by hand or a new trip's map would render stale geometry from the old one.
            geometryCache.reset()
            selectedDayNumber = store.days.first?.dayNumber
            focusedLocationId = nil
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
                importAlert = ImportAlert(message: "Couldn't open that file: \(error.localizedDescription)")
            }
        }
        .alert(item: $importAlert) { alert in
            Alert(title: Text("Import"), message: Text(alert.message), dismissButton: .default(Text("OK")))
        }
        .frame(minWidth: 900, minHeight: 500)
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
            importAlert = ImportAlert(message: "Imported \(ids.count) trip\(ids.count == 1 ? "" : "s").")
        } catch {
            importAlert = ImportAlert(message: "Import failed: \(error.localizedDescription)")
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
    return ContentView(placesProvider: MapKitPlacesProvider())
        .environment(store)
}

@MainActor
private func makePreviewStore() throws -> TripStore {
    let store = TripStore(container: try TripKrakenContainer.inMemory())
    try store.seedIfEmpty(with: .sample)
    return store
}
