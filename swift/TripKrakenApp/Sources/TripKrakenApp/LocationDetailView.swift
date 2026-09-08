import SwiftUI
import TripKrakenKit
import TripKrakenStore

/// The native equivalent of the web app's `LocationInspector` — name, rating, address, hours, an
/// Activity's visit-duration stepper, categories, enrichment status, and an editable note.
/// Deliberately simpler than the web version: hours render as a single "HH:MM–HH:MM" line (from
/// `openTime`/`closeTime`) rather than `hoursJson` grouped and collapsed per weekday-range, and
/// the note commits explicitly on Save/dismiss rather than debouncing as you type.
struct LocationDetailView: View {
    let location: TripKrakenKit.Location
    @Environment(TripStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var noteDraft: String = ""

    var body: some View {
        Form {
            if location.base.rating != nil || location.base.reviewCount != nil {
                LabeledContent("Rating") {
                    HStack(spacing: 4) {
                        if let rating = location.base.rating {
                            Image(systemName: "star.fill").foregroundStyle(.yellow).font(.caption)
                            Text(String(format: "%.1f", rating))
                        }
                        if let count = location.base.reviewCount {
                            Text("(\(count) reviews)").foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if let address = location.base.address {
                LabeledContent("Address", value: address)
            }

            if location.base.openTime != nil || location.base.closeTime != nil {
                LabeledContent("Hours", value: "\(location.base.openTime ?? "?")–\(location.base.closeTime ?? "?")")
            }

            if let activity = location.asActivity {
                LabeledContent("Visit duration") {
                    Stepper(
                        formatDuration(resolveVisitDuration(activity.base.visitDuration)),
                        onIncrement: { adjustVisitDuration(.up) },
                        onDecrement: { adjustVisitDuration(.down) }
                    )
                }
            }

            if let categories = location.base.categories, !categories.isEmpty {
                LabeledContent("Categories", value: categories.map { $0.replacingOccurrences(of: "_", with: " ") }.joined(separator: ", "))
            }

            switch location.base.enrichmentStatus {
            case .pending:
                Label("Fetching details…", systemImage: "arrow.triangle.2.circlepath").foregroundStyle(.secondary)
            case .failed:
                Label("Details unavailable", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
            case .done:
                EmptyView()
            }

            Section("Notes") {
                TextEditor(text: $noteDraft)
                    .frame(minHeight: 80)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(location.base.name)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    commitNote()
                    dismiss()
                }
            }
        }
        .onAppear { noteDraft = location.base.note ?? "" }
        .frame(minWidth: 380, minHeight: 440)
    }

    private func adjustVisitDuration(_ direction: StepDirection) {
        guard let activity = location.asActivity else { return }
        let next = nextVisitDuration(resolveVisitDuration(activity.base.visitDuration), direction: direction)
        try? store.setVisitDuration(locationId: activity.base.id, minutes: next)
    }

    private func commitNote() {
        guard noteDraft != (location.base.note ?? "") else { return }
        try? store.setLocationNote(locationId: location.base.id, note: noteDraft)
    }
}
