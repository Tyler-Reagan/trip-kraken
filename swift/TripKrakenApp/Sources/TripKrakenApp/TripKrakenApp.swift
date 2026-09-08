import Foundation
import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

@main
struct TripKrakenApp: App {
    private let store: TripStore
    private let geometryCache: PathGeometryCache
    private let placesProvider: MapKitPlacesProvider

    init() {
        do {
            let store = TripStore(container: try TripKrakenContainer.live())
            try store.seedIfEmpty(with: .sample)
            self.store = store
        } catch {
            fatalError("Failed to open the TripKraken store: \(error)")
        }
        self.geometryCache = PathGeometryCache(provider: TripKrakenApp.makeGeometryProvider())
        self.placesProvider = MapKitPlacesProvider()
    }

    /// `TRIPKRAKEN_API_BASE_URL` lets a dev point this at a non-default server; defaults to the
    /// local Next.js dev server's own default port.
    private static func makeGeometryProvider() -> PathGeometryProviding {
        let base = ProcessInfo.processInfo.environment["TRIPKRAKEN_API_BASE_URL"] ?? "http://localhost:3000"
        let endpoint = URL(string: base)!.appending(path: "api/path-geometry")
        return CompositeGeometryProvider(onDevice: MapKitGeometryProvider(), server: HTTPPathGeometryProvider(endpoint: endpoint))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(placesProvider: placesProvider)
                .environment(store)
                .environment(geometryCache)
        }
        .defaultSize(width: 1100, height: 650)
    }
}
