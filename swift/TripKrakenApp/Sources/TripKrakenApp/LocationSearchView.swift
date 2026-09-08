import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

/// Free-text place search to add a new Location (ADR-0044) — covers all three of the web app's
/// discovery modes in one view: unanchored `locations/search`, anchored `nearby` (via `near`), and
/// along-route (via `routePoints`, picked back up after being deferred — see
/// `MapKitPlacesProvider.searchAlongRoute`'s own doc comment for why it needed real work beyond
/// "call search with a different point"). `near` defaults to the trip's own centroid when opened
/// generally (`ContentView`) rather than truly unanchored, since an unbiased global text search is
/// a worse default for a trip-planning search than "near where this trip already is."
struct LocationSearchView: View {
    let near: Point?
    /// When non-nil (and non-empty), search runs along this corridor instead of near a single
    /// point — typically a gap's own flattened Path geometry (`DayDetailView`'s "Find along the
    /// way" button). Takes priority over `near` when both are supplied.
    var routePoints: [Point]? = nil
    let provider: MapKitPlacesProvider
    @Environment(TripStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [PlaceSearchResult] = []
    @State private var isSearching = false
    @State private var errorMessage: String?

    private var isAlongRoute: Bool { (routePoints?.count ?? 0) >= 2 }

    var body: some View {
        NavigationStack {
            List(results, id: \.self) { result in
                Button {
                    add(result)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(result.name).font(.body)
                        if let address = result.address {
                            Text(address).font(.caption).foregroundStyle(.secondary)
                        }
                        if let category = result.category {
                            Text(category).font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .overlay {
                if let errorMessage {
                    ContentUnavailableView("Search failed", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                } else if results.isEmpty, !isSearching, !query.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .navigationTitle(isAlongRoute ? "Find Along the Way" : "Add a Location")
            .searchable(text: $query, prompt: isAlongRoute ? "Search along this route" : "Search for a place")
            .onSubmit(of: .search) { Task { await search() } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .principal) {
                    if isSearching { ProgressView().controlSize(.small) }
                }
            }
        }
        .frame(minWidth: 420, minHeight: 480)
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        errorMessage = nil
        do {
            if let routePoints, isAlongRoute {
                results = try await provider.searchAlongRoute(query: trimmed, route: routePoints)
            } else {
                results = try await provider.search(query: trimmed, near: near)
            }
        } catch {
            errorMessage = error.localizedDescription
            results = []
        }
        isSearching = false
    }

    /// Writes the enrichment fields the search result already carries immediately, rather than
    /// leaving the new Location `.pending` and re-querying MapKit a second time for data this view
    /// already has in hand.
    private func add(_ result: PlaceSearchResult) {
        guard let id = try? store.addLocation(name: result.name, address: result.address, lat: result.lat, lng: result.lng) else { return }
        try? store.applyEnrichment(locationId: id, address: result.address, phone: result.phone, categories: result.category.map { [$0] })
        dismiss()
    }
}
