import SwiftUI
import TripKrakenKit
import TripKrakenStore

/// Blank-slate trip creation (ADR-0010), port of the web app's "New Trip" form. The duplicate-name
/// hint is advisory only, matching `checkTripNameCollision`'s own doc comment — there is no DB
/// index to enforce uniqueness (ADR-0040), so this never blocks Create, it only informs.
struct TripCreateView: View {
    let existingTrips: [TripSummary]
    let onCreate: (String) -> Void
    @Environment(TripStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var startDate = Date()
    @State private var endDate = Date()
    @State private var errorMessage: String?

    private var duplicateHint: String? {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, checkTripNameCollision(name: trimmed, existing: existingTrips) != nil else { return nil }
        return "A trip named \"\(trimmed)\" already exists — this will create another one."
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Trip name", text: $name)
                DatePicker("Start", selection: $startDate, in: ...endDate, displayedComponents: .date)
                DatePicker("End", selection: $endDate, in: startDate..., displayedComponents: .date)
                if let duplicateHint {
                    Text(duplicateHint).font(.caption).foregroundStyle(.secondary)
                }
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.orange)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("New Trip")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 220)
    }

    private func create() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        do {
            let id = try store.createTrip(name: trimmed, startDate: isoDate(from: startDate), endDate: isoDate(from: endDate))
            onCreate(id)
            dismiss()
        } catch {
            errorMessage = "Couldn't create the trip: \(error.localizedDescription)"
        }
    }
}
