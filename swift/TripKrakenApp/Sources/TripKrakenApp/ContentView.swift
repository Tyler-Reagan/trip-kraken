import SwiftUI
import TripKrakenKit

struct ContentView: View {
    private let trip = TripWithDetails.sample
    @State private var selectedDayNumber: Int?

    private var days: [DerivedDay] { deriveTripPlanDays(trip) }

    var body: some View {
        NavigationSplitView {
            List(days, id: \.dayNumber, selection: $selectedDayNumber) { day in
                VStack(alignment: .leading, spacing: 2) {
                    Text("Day \(day.dayNumber)").font(.headline)
                    Text(day.label ?? formatted(day.date)).font(.caption).foregroundStyle(.secondary)
                }
                .tag(day.dayNumber)
            }
            .navigationTitle(trip.name)
            .frame(minWidth: 180)
        } detail: {
            if let day = days.first(where: { $0.dayNumber == selectedDayNumber }) {
                DayDetailView(day: day)
            } else {
                ContentUnavailableView("Select a day", systemImage: "calendar")
            }
        }
        .onAppear { selectedDayNumber = days.first?.dayNumber }
        .frame(minWidth: 700, minHeight: 450)
    }
}

#Preview {
    ContentView()
}
