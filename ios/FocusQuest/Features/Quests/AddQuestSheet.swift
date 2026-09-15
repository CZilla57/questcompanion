import SwiftUI

/// The single add-quest surface for the Today and Quests tabs. A natural-language
/// line at the top parses and *fills* the structured fields below (rather than
/// being the whole flow); a Standard/Recurring toggle switches between a one-off
/// quest (`POST /tasks`) and a recurring template (`POST /recurring-tasks`).
///
/// Recurring quests can't join a questline (the server rejects it), so the toggle
/// is hidden — and the sheet stays Standard — whenever `questlineId` is set.
struct AddQuestSheet: View {
    /// Called with the created one-off quest so the caller can insert it.
    var onCreated: (Quest) -> Void
    var questlineId: Int? = nil
    /// Called after a recurring template is created (the caller may refresh a
    /// recurring list); one-off inserts go through `onCreated` instead.
    var onRecurringCreated: (() -> Void)? = nil

    private enum Mode: String, CaseIterable { case standard = "Standard", recurring = "Recurring" }

    @Environment(\.dismiss) private var dismiss

    // Shared across both modes.
    @State private var mode: Mode = .standard
    @State private var title = ""
    @State private var priority: Priority = .medium
    @State private var category: TaskCategory = .default

    // Standard-only.
    @State private var hasDueDate = false
    @State private var dueDate = Date()
    @State private var hasDueTime = false
    @State private var dueTime = Date()

    // Recurring-only.
    @State private var draft = RecurringDraft()

    // Natural-language quick fill.
    @State private var nlText = ""
    @StateObject private var speech = SpeechRecognizer()

    @State private var isWorking = false
    @State private var error: String?
    @FocusState private var nlFocused: Bool

    private var allowsRecurring: Bool { questlineId == nil }
    private var canSubmit: Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty, !isWorking else { return false }
        return mode == .standard || draft.isValid
    }

    private static let hm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()

    var body: some View {
        NavigationStack {
            Form {
                naturalLanguageSection

                if allowsRecurring {
                    Section {
                        Picker("Type", selection: $mode) {
                            ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                titlePriorityCategorySection

                if mode == .standard {
                    standardSection
                } else {
                    recurringSection
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger).font(.outfitFootnote) }
                }
                if let speechError = speech.error {
                    Section { Text(speechError).foregroundStyle(Theme.danger).font(.outfitFootnote) }
                }
            }
            .navigationTitle("New Quest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { Task { await submit() } }.disabled(!canSubmit)
                }
            }
            .onDisappear { speech.stop() }
        }
    }

    // MARK: - Sections

    private var naturalLanguageSection: some View {
        Section {
            HStack(alignment: .top, spacing: Theme.Space.sm) {
                TextField("e.g. Email Dr. Lee tomorrow 9am #health", text: $nlText, axis: .vertical)
                    .focused($nlFocused)
                    .lineLimit(1...3)
                    .submitLabel(.done)
                Button {
                    if speech.isRecording { speech.stop() } else { Task { await speech.start() } }
                } label: {
                    Image(systemName: speech.isRecording ? "mic.fill" : "mic")
                        .foregroundStyle(speech.isRecording ? Theme.danger : Theme.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dictate quest")
            }
            .onChange(of: speech.transcript) { _, newValue in if !newValue.isEmpty { nlText = newValue } }

            Button {
                Task { await fillFromText() }
            } label: {
                Label("Fill from text", systemImage: "wand.and.stars")
            }
            .disabled(nlText.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
        } footer: {
            Text("Type it naturally and tap Fill — FocusQuest sets the title, due date, and category for you to tweak.")
        }
    }

    private var titlePriorityCategorySection: some View {
        Section {
            TextField("Quest title", text: $title, axis: .vertical)
                .lineLimit(1...3)
            Picker("Priority", selection: $priority) {
                ForEach(Priority.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            }
            Picker("Category", selection: $category) {
                ForEach(TaskCategory.allCases, id: \.self) { Text($0.label).tag($0) }
            }
        }
    }

    private var standardSection: some View {
        Section("Schedule") {
            Toggle("Due date", isOn: $hasDueDate.animation())
            if hasDueDate {
                DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                Toggle("Due time", isOn: $hasDueTime.animation())
                if hasDueTime {
                    DatePicker("Time", selection: $dueTime, displayedComponents: .hourAndMinute)
                }
            }
        }
    }

    @ViewBuilder private var recurringSection: some View {
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

    // MARK: - Actions

    private func fillFromText() async {
        error = nil
        isWorking = true
        defer { isWorking = false }
        do {
            let parsed = try await QuestService.parse(nlText)
            title = parsed.title
            if let p = parsed.priority.flatMap(Priority.init(rawValue:)) { priority = p }
            if let c = parsed.category.flatMap(TaskCategory.init(rawValue:)) { category = c }
            if let d = parsed.dueDate.flatMap({ DateUtils.parse($0) }) {
                hasDueDate = true
                dueDate = d
            }
            if let t = parsed.dueTime, let parsedTime = Self.hm.date(from: t) {
                hasDueTime = true
                dueTime = parsedTime
            }
        } catch {
            self.error = error.userMessage
        }
    }

    private func submit() async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            if mode == .standard {
                var input = TaskInput(title: title.trimmingCharacters(in: .whitespaces))
                input.priority = priority
                input.category = category == .default ? nil : category
                input.questlineId = questlineId
                input.clientKey = UUID().uuidString
                if hasDueDate { input.dueDate = DateUtils.ymd(dueDate) }
                if hasDueDate, hasDueTime { input.dueTime = Self.hm.string(from: dueTime) }
                let quest = try await QuestService.create(input)
                onCreated(quest)
            } else {
                let input = RecurringInput.build(
                    title: title.trimmingCharacters(in: .whitespaces),
                    description: nil, priority: priority, category: category, draft: draft)
                _ = try await QuestService.recurringCreate(input)
                onRecurringCreated?()
            }
            dismiss()
        } catch {
            self.error = error.userMessage
        }
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
private struct WeekdayPicker: View {
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
