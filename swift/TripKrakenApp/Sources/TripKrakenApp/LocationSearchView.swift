import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

/// Free-text place search to add a new Location (ADR-0044) — replaces the web app's unanchored
/// `locations/search` and, via `near`, its anchored `nearby` variant too: both are the same
/// `MapKitPlacesProvider.search` call, just biased differently. `near` defaults to the trip's own
/// centroid when opened generally (`ContentView`) rather than truly unanchored, since an unbiased
/// global text search is a worse default for a trip-planning search than "near where this trip
/// already is." A future per-Location "find something nearby" entry point can pass that
/// Location's own coordinates instead — the view itself doesn't care which.
struct LocationSearchView: View {
    let near: Point?
    let provider: MapKitPlacesProvider
    @Environment(TripStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [PlaceSearchResult] = []
    @State private var isSearching = false
    @State private var errorMessage: String?

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
            .navigationTitle("Add a Location")
            .searchable(text: $query, prompt: "Search for a place")
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
            results = try await provider.search(query: trimmed, near: near)
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
