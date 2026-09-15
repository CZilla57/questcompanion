import SwiftUI

/// Edit an existing recurring template. Pre-fills title/priority/category and the
/// full cadence rule from the template, reuses the shared `RecurringFormView`,
/// and PATCHes on save. Deleting a template is deferred — pausing (the list's
/// toggle) covers "stop it for now".
struct EditRecurringSheet: View {
    let task: RecurringTask
    /// Called with the saved template so the caller can refresh its list.
    var onSaved: (RecurringTask) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var priority: Priority
    @State private var category: TaskCategory
    @State private var draft: RecurringDraft

    @State private var isWorking = false
    @State private var error: String?

    init(task: RecurringTask, onSaved: @escaping (RecurringTask) -> Void) {
        self.task = task
        self.onSaved = onSaved
        _title = State(initialValue: task.title)
        _priority = State(initialValue: task.priority)
        _category = State(initialValue: task.category)
        _draft = State(initialValue: RecurringDraft(from: task))
    }

    private var canSubmit: Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty, !isWorking else { return false }
        return draft.isValid
    }

    var body: some View {
        NavigationStack {
            Form {
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

                RecurringFormView(draft: $draft)

                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger).font(.outfitFootnote) }
                }
            }
            .navigationTitle("Edit Quest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await submit() } }.disabled(!canSubmit)
                }
            }
        }
    }

    private func submit() async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let update = RecurringUpdate.build(
                title: title.trimmingCharacters(in: .whitespaces),
                priority: priority, category: category, draft: draft)
            let saved = try await QuestService.recurringUpdate(id: task.id, update)
            onSaved(saved)
            dismiss()
        } catch {
            self.error = error.userMessage
        }
    }
}
