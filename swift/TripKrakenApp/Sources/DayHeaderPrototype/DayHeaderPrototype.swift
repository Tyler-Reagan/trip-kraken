import SwiftUI

// THROWAWAY PROTOTYPE — answers one question for issue #235 (day-header parity, UI-parity pass):
// given metro / calendar date / "Day N" all need to appear in DayDetailView's new header, in what
// visual arrangement does that priority order (metro first, date second, day-ordinal last) actually
// read? Not routed through the real app or TripStore — sample days are hand-built fixtures covering
// the edge cases that matter for this question (no metro, two metros, a long metro name, a long
// custom label), kept entirely in memory. Delete this target (and the entry in Package.swift) once
// slice 4 lands for real in DayDetailView.
//
// Web/route-based prototypes switch variants via a URL param + floating bottom bar; there's no URL
// here, so the bottom bar is a real `.safeAreaInset` pinned control instead, same idea.
//
// Run with: swift run DayHeaderPrototype

@main
struct DayHeaderPrototypeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                // Capped to the real app's content-pane range (`ContentView`'s
                // `.navigationSplitViewColumnWidth(min: 320, ideal: 420, max: 640)`) so resizing
                // this window stays representative of what the header will actually have to work
                // with — the first round's screenshot was wider than production ever allows.
                .frame(minWidth: 320, idealWidth: 420, maxWidth: 640, minHeight: 500)
        }
        .windowResizability(.contentSize)
    }
}

// MARK: - Fixtures

private struct SampleDay: Identifiable {
    let id: Int
    let dayNumber: Int
    let date: Date
    let label: String?
    let metroNames: [String]
    let stopCount: Int
    let totalMinutes: Int
    let hasAnyDuration: Bool
    let note: String
}

private func makeDate(_ y: Int, _ m: Int, _ d: Int) -> Date {
    DateComponents(calendar: .init(identifier: .gregorian), year: y, month: m, day: d).date!
}

private let sampleDays: [SampleDay] = [
    SampleDay(
        id: 1, dayNumber: 1, date: makeDate(2026, 10, 17), label: "Arrival",
        metroNames: ["Tokyo"], stopCount: 4, totalMinutes: 310, hasAnyDuration: true,
        note: "baseline — short metro name, has a label"
    ),
    SampleDay(
        id: 2, dayNumber: 2, date: makeDate(2026, 10, 18), label: nil,
        metroNames: ["Kanazawa Historic District"], stopCount: 2, totalMinutes: 95, hasAnyDuration: true,
        note: "long metro name, no label, light day"
    ),
    SampleDay(
        id: 3, dayNumber: 3, date: makeDate(2026, 10, 19), label: "Day trip",
        metroNames: ["Kyoto", "Nara"], stopCount: 6, totalMinutes: 405, hasAnyDuration: true,
        note: "two metros — badge/text crowding"
    ),
    SampleDay(
        id: 4, dayNumber: 4, date: makeDate(2026, 10, 20), label: nil,
        metroNames: [], stopCount: 3, totalMinutes: 0, hasAnyDuration: false,
        note: "no metro at all — must degrade gracefully"
    ),
    SampleDay(
        id: 5, dayNumber: 5, date: makeDate(2026, 10, 21), label: "Big food crawl + family visit day",
        metroNames: ["Osaka"], stopCount: 5, totalMinutes: 260, hasAnyDuration: true,
        note: "long custom label competing for the same row"
    ),
]

private let dayColors: [Color] = [.orange, .yellow, .green, .mint, .teal, .blue, .indigo, .purple, .pink, .red]
private func dayColor(_ n: Int) -> Color { dayColors[(n - 1) % dayColors.count] }

/// Placeholder only — the real app has no per-metro color system yet (`DayPalette` is keyed by day
/// number, not metro). A stable hash keeps a given metro name's color consistent across the fixtures
/// in this one run, which is all variant E needs to answer the layout question; picking a real metro
/// color source is a separate follow-up if this direction is the one that ships.
private let metroColors: [Color] = [.blue, .purple, .pink, .brown, .indigo, .mint, .cyan, .orange]
private func metroColor(_ name: String) -> Color {
    let sum = name.unicodeScalars.reduce(0) { $0 + Int($1.value) }
    return metroColors[sum % metroColors.count]
}

private func dateText(_ day: SampleDay) -> String {
    let f = DateFormatter()
    f.dateFormat = "EEE, MMM d"
    return f.string(from: day.date)
}

private func metroText(_ day: SampleDay) -> String {
    day.metroNames.isEmpty ? "No metro" : day.metroNames.joined(separator: " + ")
}

private func minutesText(_ minutes: Int) -> String {
    let h = minutes / 60, m = minutes % 60
    if h == 0 { return "\(m)m" }
    return m == 0 ? "\(h)h" : "\(h)h \(m)m"
}

private let lightDayThreshold = 240

// MARK: - Shared secondary row (kept uniform across variants on purpose — the comparison is about
// the metro/date/day hierarchy, not this row)

private struct StatsAndLabelRow: View {
    let day: SampleDay
    @Binding var labelDraft: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            TextField("Add label…", text: $labelDraft)
                .textFieldStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Text("\(day.stopCount) stop\(day.stopCount == 1 ? "" : "s")")
                if day.hasAnyDuration {
                    Text(minutesText(day.totalMinutes))
                }
                if day.hasAnyDuration && day.totalMinutes < lightDayThreshold && day.stopCount > 0 {
                    Text("Light day").fontWeight(.semibold).foregroundStyle(.orange)
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
    }
}

// MARK: - Variant A — headline metro, date subtitle, day number reduced to a leading marker dot

private struct VariantA: View {
    let day: SampleDay
    @Binding var labelDraft: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Text("\(day.dayNumber)")
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 20, height: 20)
                    .background(dayColor(day.dayNumber), in: Circle())
                    .foregroundStyle(.black.opacity(0.75))
                VStack(alignment: .leading, spacing: 1) {
                    Text(metroText(day)).font(.title3.bold()).lineLimit(1)
                    Text(dateText(day)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            StatsAndLabelRow(day: day, labelDraft: $labelDraft)
        }
    }
}

// MARK: - Variant B — metro as an uppercase eyebrow, date as the headline, "Day N" a small trailing tag

private struct VariantB: View {
    let day: SampleDay
    @Binding var labelDraft: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(metroText(day).uppercased())
                    .font(.caption).fontWeight(.semibold)
                    .tracking(0.8)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(dateText(day)).font(.title2.bold()).lineLimit(1)
                    Text("Day \(day.dayNumber)")
                        .font(.caption2).fontWeight(.medium)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
            StatsAndLabelRow(day: day, labelDraft: $labelDraft)
        }
    }
}

// MARK: - Variant C — metro as a bordered pill, date plain text, day number an ambient dot with no
// visible numeral (most radical: the ordinal is present only as a hover affordance)

private struct VariantC: View {
    let day: SampleDay
    @Binding var labelDraft: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(metroText(day))
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .overlay(Capsule().stroke(.secondary.opacity(0.4)))
                Text(dateText(day)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                Circle()
                    .fill(dayColor(day.dayNumber))
                    .frame(width: 10, height: 10)
                    .help("Day \(day.dayNumber)")
            }
            StatsAndLabelRow(day: day, labelDraft: $labelDraft)
        }
    }
}

// MARK: - Variant D — strict typographic ladder: three decreasing font weights/sizes, one per line,
// in exactly the stated priority order

private struct VariantD: View {
    let day: SampleDay
    @Binding var labelDraft: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(metroText(day)).font(.title2.bold()).lineLimit(1)
                Text(dateText(day)).font(.subheadline).lineLimit(1)
                Text("Day \(day.dayNumber)").font(.caption2).foregroundStyle(.tertiary)
            }
            StatsAndLabelRow(day: day, labelDraft: $labelDraft)
        }
    }
}

// MARK: - Variant E — hybrid of A and B, per feedback on the first round:
// - Color-coding (A's aesthetic) now marks *metro*, not day — day-as-color was the wrong referent.
// - B's eyebrow+badge layout is kept, but the badge is now a colored metro dot, not a "Day N" pill.
// - The headline slot (large, bold — A's "emphasis" idea) no longer holds the metro name; it holds
//   the editable label instead, since that's the thing actually worth top billing.
// - The label therefore vacates the old bottom edit row, and "Day N" moves into that now-empty
//   slot — demoted to plain caption text alongside stop count/duration, matching "relative day
//   isn't very useful": present for reference, not competing for attention.

private struct VariantE: View {
    let day: SampleDay
    @Binding var labelDraft: String

    var body: some View {
        // Two columns instead of one stacked block: everything demoted in round one (Day N, stop
        // count, duration, light-day) now lives in a compact trailing stack roughly matching the
        // leading column's height, rather than a fourth full-width row underneath. Uses the pane's
        // width for something real and cuts the header's height by about a line.
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    ForEach(day.metroNames, id: \.self) { metro in
                        Circle().fill(metroColor(metro)).frame(width: 7, height: 7)
                    }
                    Text(day.metroNames.isEmpty ? "NO METRO" : day.metroNames.joined(separator: " + ").uppercased())
                        .font(.caption).fontWeight(.semibold)
                        .tracking(0.8)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                TextField("Add label…", text: $labelDraft)
                    .textFieldStyle(.plain)
                    .font(.title3.bold())
                    .lineLimit(1)
                Text(dateText(day)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text("Day \(day.dayNumber)").foregroundStyle(.tertiary)
                Text("\(day.stopCount) stop\(day.stopCount == 1 ? "" : "s")")
                if day.hasAnyDuration {
                    Text(minutesText(day.totalMinutes))
                }
                if day.hasAnyDuration && day.totalMinutes < lightDayThreshold && day.stopCount > 0 {
                    Text("Light day").fontWeight(.semibold).foregroundStyle(.orange)
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
    }
}

// MARK: - Switcher shell

private enum Variant: String, CaseIterable, Identifiable {
    case e = "E · Hybrid (A×B)"
    case a = "A · Marker + Headline"
    case b = "B · Eyebrow + Tag"
    case c = "C · Pill + Ambient Dot"
    case d = "D · Typographic Ladder"
    var id: String { rawValue }
}

private struct RootView: View {
    @State private var variant: Variant = .e
    @State private var labelDrafts: [Int: String] = Dictionary(
        uniqueKeysWithValues: sampleDays.map { ($0.id, $0.label ?? "") }
    )

    var body: some View {
        ScrollView {
            // No card/box framing — the real header sits directly in the content pane, separated
            // from the day's stop list below by a plain Divider, not boxed like a card.
            VStack(alignment: .leading, spacing: 0) {
                ForEach(sampleDays) { day in
                    VStack(alignment: .leading, spacing: 4) {
                        header(for: day).padding(.vertical, 10)
                        Text(day.note)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .italic()
                            .padding(.bottom, 8)
                        Divider()
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .safeAreaInset(edge: .bottom) {
            Picker("Variant", selection: $variant) {
                ForEach(Variant.allCases) { v in Text(v.rawValue).tag(v) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(10)
            .background(.bar)
        }
        .navigationTitle("Day header prototype — \(variant.rawValue)")
    }

    @ViewBuilder
    private func header(for day: SampleDay) -> some View {
        let binding = Binding(
            get: { labelDrafts[day.id] ?? "" },
            set: { labelDrafts[day.id] = $0 }
        )
        switch variant {
        case .e: VariantE(day: day, labelDraft: binding)
        case .a: VariantA(day: day, labelDraft: binding)
        case .b: VariantB(day: day, labelDraft: binding)
        case .c: VariantC(day: day, labelDraft: binding)
        case .d: VariantD(day: day, labelDraft: binding)
        }
    }
}
