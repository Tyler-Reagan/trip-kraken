import SwiftUI
import TripKrakenKit

struct DayDetailView: View {
    let day: DerivedDay

    var body: some View {
        List(dayChainEntries(day), id: \.self) { entry in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.location.base.name).font(.body)
                    Text(subtext(for: entry)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if entry.role == .stop, let minutes = entry.location.base.visitDuration {
                    Text(formatDuration(minutes)).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 2)
        }
        .navigationTitle("Day \(day.dayNumber) · \(day.date)")
    }

    private func subtext(for entry: ChainEntry) -> String {
        switch entry.role {
        case .start: anchorSubtext(role: .start, location: entry.location)
        case .checkin: anchorSubtext(role: .checkin, location: entry.location)
        case .end: anchorSubtext(role: .end, location: entry.location)
        case .stop: "Stop \((entry.index ?? 0) + 1)"
        }
    }
}
