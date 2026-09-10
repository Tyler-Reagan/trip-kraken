import AppKit
import Foundation
import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

/// `swift run`'s executable has no `.app` bundle or Info.plist, and without one macOS doesn't
/// reliably treat the process as a regular foreground app — the window can appear without ever
/// becoming key, so it can't be brought to the front and text fields don't receive keystrokes, even
/// launched from an interactive terminal. Xcode-built/bundled runs don't need this; this only
/// matters for the raw `swift run` path.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct TripKrakenApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    private let store: TripStore
    private let geometryCache: PathGeometryCache
    private let placesProvider: MapKitPlacesProvider
    private let optimizeProvider: OptimizeProviding

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
        self.optimizeProvider = HTTPOptimizeProvider(endpoint: TripKrakenApp.apiBaseURL.appending(path: "api/optimize"))
    }

    /// `TRIPKRAKEN_API_BASE_URL` lets a dev point this at a non-default server; defaults to the
    /// local Next.js dev server's own default port.
    private static var apiBaseURL: URL {
        URL(string: ProcessInfo.processInfo.environment["TRIPKRAKEN_API_BASE_URL"] ?? "http://localhost:3000")!
    }

    private static func makeGeometryProvider() -> PathGeometryProviding {
        let endpoint = apiBaseURL.appending(path: "api/path-geometry")
        return CompositeGeometryProvider(onDevice: MapKitGeometryProvider(), server: HTTPPathGeometryProvider(endpoint: endpoint))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(placesProvider: placesProvider, optimizeProvider: optimizeProvider)
                .environment(store)
                .environment(geometryCache)
        }
        .defaultSize(width: 1100, height: 650)
    }
}
