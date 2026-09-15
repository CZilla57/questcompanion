import SwiftUI

/// The recurring-cadence form — the "Repeats" and "Timing" sections shared by
/// the create sheet (`AddQuestSheet`) and the edit sheet (`EditRecurringSheet`).
/// It owns only the schedule fields; the caller supplies title/priority/category
/// and the submit button. Drop it into a `Form`; it renders two `Section`s.
///
/// Days are numbered 0 = Sunday … 6 = Saturday, matching the API.
struct RecurringFormView: View {
    @Binding var draft: RecurringDraft

    private static let hm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()

    var body: some View {
        Group {
            Section("Repeats") {
                Picker("Frequency", selection: Binding(
                    get: { draft.frequency },
                    set: { setFrequency($0) }
                )) {
                    ForEach(Frequency.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)

                if draft.frequency == .weekly {
                    WeekdayPicker(selection: $draft.daysOfWeek, singleSelect: false)
                    if draft.daysOfWeek.isEmpty {
                        Text("Select at least one day.").font(.outfitCaption).foregroundStyle(Theme.danger)
                    }
                } else {
                    if draft.frequency == .yearly {
                        Picker("Month", selection: $draft.monthOfYear) {
                            ForEach(1...12, id: \.self) { Text(Self.monthName($0)).tag($0) }
                        }
                    }
                    Picker("On", selection: Binding(
                        get: { draft.monthlyMode },
                        set: { setMonthlyMode($0) }
                    )) {
                        Text("Day of month").tag(MonthlyMode.dayOfMonth)
                        Text("Nth weekday").tag(MonthlyMode.nthWeekday)
                    }
                    .pickerStyle(.segmented)

                    if draft.monthlyMode == .dayOfMonth {
                        Stepper("Day \(draft.dayOfMonth)", value: $draft.dayOfMonth, in: 1...31)
                    } else {
                        Picker("Week", selection: $draft.weekOfMonth) {
                            ForEach(1...4, id: \.self) { Text(Self.ordinal($0)).tag($0) }
                        }
                        WeekdayPicker(selection: $draft.daysOfWeek, singleSelect: true)
                    }
                }
            }

            Section("Timing") {
                DatePicker("Time of day", selection: Binding(
                    get: { Self.hm.date(from: draft.timeOfDay) ?? Date() },
                    set: { draft.timeOfDay = Self.hm.string(from: $0) }
                ), displayedComponents: .hourAndMinute)
                DatePicker("Starts", selection: $draft.startDate, displayedComponents: .date)
                Toggle("End date", isOn: $draft.hasEndDate.animation())
                if draft.hasEndDate {
                    DatePicker("Ends", selection: $draft.endDate, in: draft.startDate..., displayedComponents: .date)
                }
                Stepper("Remind \(draft.leadDays) day\(draft.leadDays == 1 ? "" : "s") ahead", value: $draft.leadDays, in: 0...60)
            }
        }
    }

    // MARK: - Cadence edits (mirror the web form's transitions)

    private func setFrequency(_ f: Frequency) {
        draft.frequency = f
        draft.leadDays = f.defaultLeadDays
        // Only monthly/yearly render the single-weekday selector; seed Monday so
        // an nth_weekday rule never shows an empty (dishonest) selection.
        if f != .weekly, draft.monthlyMode == .nthWeekday, draft.daysOfWeek.isEmpty {
            draft.daysOfWeek = [1]
        }
    }

    private func setMonthlyMode(_ m: MonthlyMode) {
        draft.monthlyMode = m
        if m == .nthWeekday, draft.daysOfWeek.isEmpty { draft.daysOfWeek = [1] }
    }

    // MARK: - Helpers

    private static func monthName(_ m: Int) -> String {
        DateFormatter().monthSymbols[max(0, min(11, m - 1))]
    }

    private static func ordinal(_ n: Int) -> String {
        switch n {
        case 1: return "1st"; case 2: return "2nd"; case 3: return "3rd"; default: return "\(n)th"
        }
    }
}

/// Seven-day picker. `singleSelect` collapses selection to one weekday (for the
/// monthly/yearly "nth weekday" rule); otherwise it's a multi-select (weekly).
/// Days are numbered 0 = Sunday … 6 = Saturday, matching the API.
struct WeekdayPicker: View {
    @Binding var selection: [Int]
    var singleSelect: Bool

    private let labels = ["S", "M", "T", "W", "T", "F", "S"]

    var body: some View {
        HStack(spacing: Theme.Space.xs) {
            ForEach(0..<7, id: \.self) { day in
                let on = selection.contains(day)
                Button {
                    if singleSelect {
                        selection = [day]
                    } else if on {
                        selection.removeAll { $0 == day }
                    } else {
                        selection.append(day)
                    }
                } label: {
                    Text(labels[day])
                        .font(.outfitSubheadline)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(on ? Theme.accent : Color.clear)
                        .foregroundStyle(on ? Theme.screenBackground : Theme.mutedForeground)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Theme.accent : Theme.cardBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day])
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.vertical, 2)
    }
}
