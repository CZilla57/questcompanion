import AppIntents

/// Siri phrases + Shortcuts action for capturing a quest.
struct FocusQuestShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddQuestIntent(),
            phrases: [
                "Add a quest to \(.applicationName)",
                "Add a quest in \(.applicationName)",
                "New quest in \(.applicationName)",
            ],
            shortTitle: "Add a Quest",
            systemImageName: "plus.circle"
        )
    }
}
