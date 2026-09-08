import SwiftUI
import TripKrakenKit
import TripKrakenStore

@main
struct TripKrakenApp: App {
    private let store: TripStore

    init() {
        do {
            let store = TripStore(container: try TripKrakenContainer.live())
            try store.seedIfEmpty(with: .sample)
            self.store = store
        } catch {
            fatalError("Failed to open the TripKraken store: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(store)
        }
        .defaultSize(width: 1100, height: 650)
    }
}
