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

    /// Re-read from the store on every access instead of trusting the `location` the sheet was
    /// opened with — that parameter is a plain value type captured once at presentation time
    /// (`DayDetailView`'s `.sheet(item:)`), so it never reflects a mutation like the Stepper's own
    /// `setVisitDuration` call. Falls back to the captured value only if the Location has since
    /// been removed from the trip entirely.
    private var liveLocation: TripKrakenKit.Location {
        store.trip?.locations.first { $0.base.id == location.base.id } ?? location
    }

    var body: some View {
        Form {
            if liveLocation.base.rating != nil || liveLocation.base.reviewCount != nil {
                LabeledContent("Rating") {
                    HStack(spacing: 4) {
                        if let rating = liveLocation.base.rating {
                            Image(systemName: "star.fill").foregroundStyle(.yellow).font(.caption)
                            Text(String(format: "%.1f", rating))
                        }
                        if let count = liveLocation.base.reviewCount {
                            Text("(\(count) reviews)").foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if let address = liveLocation.base.address {
                LabeledContent("Address", value: address)
            }

            if liveLocation.base.openTime != nil || liveLocation.base.closeTime != nil {
                LabeledContent("Hours", value: "\(liveLocation.base.openTime ?? "?")–\(liveLocation.base.closeTime ?? "?")")
            }

            if let activity = liveLocation.asActivity {
                LabeledContent("Visit duration") {
                    Stepper(
                        formatDuration(resolveVisitDuration(activity.base.visitDuration)),
                        onIncrement: { adjustVisitDuration(.up) },
                        onDecrement: { adjustVisitDuration(.down) }
                    )
                }
            }

            if let categories = liveLocation.base.categories, !categories.isEmpty {
                LabeledContent("Categories", value: categories.map { $0.replacingOccurrences(of: "_", with: " ") }.joined(separator: ", "))
            }

            switch liveLocation.base.enrichmentStatus {
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
        .navigationTitle(liveLocation.base.name)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    commitNote()
                    dismiss()
                }
            }
        }
        .onAppear { noteDraft = liveLocation.base.note ?? "" }
        .frame(minWidth: 380, minHeight: 440)
    }

    private func adjustVisitDuration(_ direction: StepDirection) {
        guard let activity = liveLocation.asActivity else { return }
        let next = nextVisitDuration(resolveVisitDuration(activity.base.visitDuration), direction: direction)
        try? store.setVisitDuration(locationId: activity.base.id, minutes: next)
    }

    private func commitNote() {
        guard noteDraft != (liveLocation.base.note ?? "") else { return }
        try? store.setLocationNote(locationId: liveLocation.base.id, note: noteDraft)
    }
}
