import SwiftUI
import TripKrakenKit
import TripKrakenStore

struct ContentView: View {
    @Environment(TripStore.self) private var store
    @State private var selectedDayNumber: Int?

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
        } detail: {
            if let day = store.days.first(where: { $0.dayNumber == selectedDayNumber }) {
                DayDetailView(day: day)
            } else {
                ContentUnavailableView("Select a day", systemImage: "calendar")
            }
        }
        .onAppear { selectedDayNumber = store.days.first?.dayNumber }
        .frame(minWidth: 700, minHeight: 450)
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
