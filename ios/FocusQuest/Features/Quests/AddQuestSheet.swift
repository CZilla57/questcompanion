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

    // Standard-only. A standard quest is due *today* by default — the server
    // rejects a non-anchored quest with no dueDate — and "Anchor" is the web's
    // escape hatch for a deadline-free quest (sends `isAnchored`, no dueDate).
    @State private var isAnchored = false
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
                    RecurringFormView(draft: $draft)
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
        Section {
            Toggle("No deadline (anchor)", isOn: $isAnchored.animation())
            if !isAnchored {
                DatePicker("Due date", selection: $dueDate, displayedComponents: .date)
                Toggle("Due time", isOn: $hasDueTime.animation())
                if hasDueTime {
                    DatePicker("Time", selection: $dueTime, displayedComponents: .hourAndMinute)
                }
            }
        } header: {
            Text("Schedule")
        } footer: {
            Text(isAnchored
                ? "Anchored quests have no deadline — they stay on your list until done."
                : "Defaults to today. Turn on Anchor to keep it around with no due date.")
        }
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

            if let r = parsed.recurrence, allowsRecurring {
                // Recurrence detected → flip to the Recurring form, pre-filled.
                mode = .recurring
                draft.apply(r)
                if let t = parsed.dueTime { draft.timeOfDay = t }
            } else {
                // One-off fill (or recurring not allowed in a questline context).
                if let d = parsed.dueDate.flatMap({ DateUtils.parse($0) }) {
                    isAnchored = false
                    dueDate = d
                }
                if let t = parsed.dueTime, let parsedTime = Self.hm.date(from: t) {
                    hasDueTime = true
                    dueTime = parsedTime
                }
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
                // Exactly one of the two, mirroring the web create form: an
                // anchored quest carries no dueDate, otherwise dueDate (today by
                // default) is required by the server.
                if isAnchored {
                    input.isAnchored = true
                } else {
                    input.dueDate = DateUtils.ymd(dueDate)
                    if hasDueTime { input.dueTime = Self.hm.string(from: dueTime) }
                }
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
}
