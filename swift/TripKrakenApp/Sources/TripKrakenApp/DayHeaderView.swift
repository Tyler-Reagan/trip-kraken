import SwiftUI
import TripKrakenKit
import TripKrakenStore

/// The day-header block above `DayDetailView`'s stop list (Slice 4, UI-parity pass, issue #235).
/// Validated in the `DayHeaderPrototype` throwaway target as variant E, a hybrid of two rounds of
/// exploration: metro carries the color-coding (not the day, which has its own colors elsewhere —
/// the map, `UnscheduledRow`'s day badge), the day's own editable label is the headline, and the
/// day's ordinal number is demoted to a small trailing stat, since on its own it's the least useful
/// of the four.
///
/// Two columns rather than one stacked block, deliberately: everything demoted (Day N, stop count,
/// duration, light-day) lives in a compact trailing stack instead of a fourth full-width row, so the
/// header uses the pane's width for something real instead of padding, and stays three lines tall
/// regardless of column width.
struct DayHeaderView: View {
    let day: DerivedDay
    let metros: [TripMetro]
    @Binding var browsedMetroId: String?
    @Environment(TripStore.self) private var store

    /// A local draft, committed explicitly rather than bound straight to the store (mirrors
    /// `LocationDetailView.noteDraft`) — a `TextField` bound to a computed `Binding` that writes
    /// through on every keystroke fights SwiftUI's own editing state: each character triggers
    /// `store.setDayLabel`, `store.days` recomputes, this view gets a fresh `day`, and the binding
    /// gets rebuilt mid-edit, which is what made the field uneditable rather than merely inefficient.
    @State private var labelDraft: String

    init(day: DerivedDay, metros: [TripMetro], browsedMetroId: Binding<String?>) {
        self.day = day
        self.metros = metros
        self._browsedMetroId = browsedMetroId
        self._labelDraft = State(initialValue: day.label ?? "")
    }

    /// Web's `LIGHT_DAY_THRESHOLD` (`DayCard.tsx`) — a presentation constant, not domain logic, so
    /// it lives here rather than in TripKrakenKit alongside `resolveVisitDuration`.
    private let lightDayThresholdMinutes = 240

    private var dayMetros: [TripMetro] {
        metros.filter { $0.dayNumbers.contains(day.dayNumber) }
    }

    /// Commits `labelDraft` for `date` — always, not just when it looks changed, since the caller
    /// already knows when a commit is warranted (a day switch, losing focus, or Return) and a
    /// same-value write is a harmless no-op.
    private func commitLabel(for date: IsoDate) {
        let trimmed = labelDraft.trimmingCharacters(in: .whitespaces)
        try? store.setDayLabel(date: date, label: trimmed.isEmpty ? nil : trimmed)
    }

    private var totalMinutes: Int {
        day.stops.reduce(0) { $0 + resolveVisitDuration($1.location.base.visitDuration) }
    }

    /// A raw check on purpose, not the resolved total above — "Light day" is a signal about
    /// durations someone actually chose; a day made entirely of invented defaults isn't evidence of
    /// anything (mirrors `DayCard.tsx`'s own `anyHasDuration`).
    private var anyHasDuration: Bool {
        day.stops.contains { $0.location.base.visitDuration != nil }
    }

    private var isLightDay: Bool {
        anyHasDuration && totalMinutes < lightDayThresholdMinutes && !day.stops.isEmpty
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                if !dayMetros.isEmpty {
                    HStack(spacing: 10) {
                        ForEach(dayMetros, id: \.id) { metro in
                            metroChip(metro)
                        }
                    }
                }
                TextField("Add label…", text: $labelDraft)
                    .textFieldStyle(.plain)
                    .font(.title3.bold())
                    .lineLimit(1)
                    .onSubmit { commitLabel(for: day.date) }
                Text(formatted(day.date)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text("Day \(day.dayNumber)").foregroundStyle(.tertiary)
                Text("\(day.stops.count) stop\(day.stops.count == 1 ? "" : "s")")
                if anyHasDuration {
                    Text(formatDuration(totalMinutes))
                }
                if isLightDay {
                    Text("Light day").fontWeight(.semibold).foregroundStyle(.orange)
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .padding(.vertical, 10)
        // This view's identity persists across a day switch (same type/position in the tree, just a
        // new `day` value), so `labelDraft` would otherwise keep showing the *previous* day's edit.
        // Flush it under the day it belongs to, then reseed for the day that's now showing.
        .onChange(of: day.date) { oldDate, _ in
            commitLabel(for: oldDate)
            labelDraft = day.label ?? ""
        }
        // Covers the one path `onChange(of: day.date)` can't: switching away to the Unscheduled
        // sidebar row, which removes this view from the hierarchy rather than updating its `day`.
        .onDisappear { commitLabel(for: day.date) }
    }

    /// A colored dot + uppercase name, clickable — mirrors the web app's metro badge
    /// (`focusMap({ tier: "metro", metroId })` in `DayCard.tsx`) by driving the same `browsedMetroId`
    /// the map's own segmented picker writes to, rather than a second, parallel focus mechanism.
    private func metroChip(_ metro: TripMetro) -> some View {
        Button {
            browsedMetroId = metro.id
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(MetroPalette.color(metros.firstIndex(of: metro) ?? 0))
                    .frame(width: 7, height: 7)
                Text(metro.label.uppercased())
                    .font(.caption).fontWeight(.semibold)
                    .tracking(0.8)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .help("Show \(metro.label) on the map")
    }
}
