import SwiftUI

/// Natural-language quick add. Types the whole quest in one line; optionally
/// previews the parsed fields (`/tasks/parse`) before creating.
struct QuickAddSheet: View {
    /// Called with the created quest so the caller can insert it.
    var onCreated: (Quest) -> Void
    var questlineId: Int? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var parsed: ParsedQuickAdd?
    @State private var isWorking = false
    @State private var error: String?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. Email Dr. Lee tomorrow 9am #health", text: $text, axis: .vertical)
                        .focused($fieldFocused)
                        .lineLimit(1...3)
                        .submitLabel(.done)
                } footer: {
                    Text("Add a due date and category naturally — FocusQuest figures out the rest.")
                }

                if let parsed {
                    Section("Preview") {
                        LabeledContent("Title", value: parsed.title)
                        if let d = parsed.dueDate { LabeledContent("Due", value: DateUtils.dueLabel(d, time: parsed.dueTime) ?? d) }
                        if let p = parsed.priority { LabeledContent("Priority", value: p.capitalized) }
                        if let c = parsed.category { LabeledContent("Category", value: c) }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger).font(.footnote) }
                }
            }
            .navigationTitle("New Quest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { Task { await create() } }
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                }
                ToolbarItem(placement: .keyboard) {
                    Button("Preview") { Task { await preview() } }
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                }
            }
            .onAppear { fieldFocused = true }
        }
    }

    private func preview() async {
        error = nil
        do { parsed = try await QuestService.parse(text) }
        catch { self.error = error.userMessage }
    }

    private func create() async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            // Prefer the parsed title/fields when the user previewed; otherwise
            // send the raw text as the title (the server auto-categorizes).
            var input = TaskInput(title: parsed?.title ?? text)
            input.questlineId = questlineId
            input.clientKey = UUID().uuidString
            if let parsed {
                input.dueDate = parsed.dueDate
                input.dueTime = parsed.dueTime
                input.priority = parsed.priority.flatMap(Priority.init(rawValue:))
                input.category = parsed.category.flatMap(TaskCategory.init(rawValue:))
            }
            let quest = try await QuestService.create(input)
            onCreated(quest)
            dismiss()
        } catch {
            self.error = error.userMessage
        }
    }
}
