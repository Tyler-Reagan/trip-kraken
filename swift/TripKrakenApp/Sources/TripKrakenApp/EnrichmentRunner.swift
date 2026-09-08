import Foundation
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

/// Manual retry/recovery path (ADR-0044) — mirrors the web app's `POST /api/trips/[id]/enrich`:
/// walks every `.pending`/`.failed` Location (`enrichableLocations`, already tested on its own)
/// and asks `MapKitPlacesProvider` to resolve it. The provider already serializes its own requests
/// one at a time with backoff, so this just awaits each call in turn rather than fanning out
/// concurrently.
@MainActor
func enrichPendingLocations(store: TripStore, provider: MapKitPlacesProvider) async {
    guard let trip = store.trip else { return }
    for location in enrichableLocations(trip) {
        await enrich(location, store: store, provider: provider)
    }
}

@MainActor
private func enrich(_ location: TripKrakenKit.Location, store: TripStore, provider: MapKitPlacesProvider) async {
    let near = location.base.lat.flatMap { lat in location.base.lng.map { Point(lat: lat, lng: $0) } }
    do {
        guard let match = try await provider.enrich(name: location.base.name, near: near) else {
            try? store.markEnrichmentFailed(locationId: location.base.id, error: "No match found")
            return
        }
        try? store.applyEnrichment(
            locationId: location.base.id, address: match.address, phone: match.phone,
            categories: match.category.map { [$0] }
        )
    } catch {
        try? store.markEnrichmentFailed(locationId: location.base.id, error: error.localizedDescription)
    }
}
