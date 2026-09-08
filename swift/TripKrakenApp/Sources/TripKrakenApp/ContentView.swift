import SwiftUI
import TripKrakenKit
import TripKrakenStore

struct ContentView: View {
    @Environment(TripStore.self) private var store
    @State private var selectedDayNumber: Int?
    /// A one-shot "fly the camera here" request, set only by an explicit button in
    /// `DayDetailView` — never by anything on the map itself. Clicking a map annotation only
    /// selects/highlights it; if selecting also flew the camera, zooming into a stop would push
    /// every other stop outside the viewport with no annotation left to click to get back out.
    /// The external button has no such dead end, since it's a list item, not a map pin.
    @State private var focusedLocationId: String?

    var body: some View {
        NavigationSplitView {
            List(store.days, id: \.dayNumber, selection: $selectedDayNumber) { day in
                VStack(alignment: .leading, spacing: 2) {
                    Text("Day \(day.dayNumber)").font(.headline)
                    Text(day.label ?? formatted(day.date)).font(.caption).foregroundStyle(.secondary)
                }
                .tag(day.dayNumber)
            }
            .navigationTitle(store.trip?.name ?? "Trip")
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
        .frame(minWidth: 900, minHeight: 500)
    }
}

#Preview {
    let store = try! makePreviewStore()
    return ContentView()
        .environment(store)
}

@MainActor
private func makePreviewStore() throws -> TripStore {
    let store = TripStore(container: try TripKrakenContainer.inMemory())
    try store.seedIfEmpty(with: .sample)
    return store
}
