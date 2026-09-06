import AppIntents

/// Capture a quest from Siri / Shortcuts without opening the app. Reuses the same
/// /tasks/parse + create path as the in-app quick add.
struct AddQuestIntent: AppIntent {
    static var title: LocalizedStringResource = "Add a Quest"
    static var description = IntentDescription("Capture a new quest in FocusQuest.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Quest", requestValueDialog: "What's the quest?")
    var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(dialog: "I didn't catch a quest to add.")
        }
        // A background intent starts with no token — load it from the Keychain.
        guard let token = Keychain.get(account: Keychain.sessionTokenAccount) else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        await APIClient.shared.setToken(token)

        do {
            let parsed = try? await QuestService.parse(trimmed)
            var input = TaskInput(title: parsed?.title ?? trimmed)
            input.clientKey = UUID().uuidString
            if let parsed {
                input.dueDate = parsed.dueDate
                input.dueTime = parsed.dueTime
                input.priority = parsed.priority.flatMap(Priority.init(rawValue:))
                input.category = parsed.category.flatMap(TaskCategory.init(rawValue:))
            }
            let quest = try await QuestService.create(input)
            return .result(dialog: "Added “\(quest.title)” to FocusQuest.")
        } catch {
            return .result(dialog: "I couldn't add that quest just now. Please try again.")
        }
    }
}
