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
        AppShortcut(
            intent: StartFocusIntent(),
            phrases: [
                "Start a focus session in \(.applicationName)",
                "Start deep work in \(.applicationName)",
            ],
            shortTitle: "Start Focus",
            systemImageName: "timer"
        )
        AppShortcut(
            intent: CompleteQuestIntent(),
            phrases: [
                "Complete a quest in \(.applicationName)",
                "Mark a quest done in \(.applicationName)",
            ],
            shortTitle: "Complete a Quest",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: CheckStatsIntent(),
            phrases: [
                "What's my streak in \(.applicationName)",
                "Check my \(.applicationName) stats",
            ],
            shortTitle: "Check Stats",
            systemImageName: "chart.bar"
        )
        AppShortcut(
            intent: BrainCheckInIntent(),
            phrases: [
                "Log my brain in \(.applicationName)",
                "Brain check in \(.applicationName)",
            ],
            shortTitle: "Brain Check-In",
            systemImageName: "brain.head.profile"
        )
    }
}
