import AppIntents

struct CheckStatsIntent: AppIntent {
    static var title: LocalizedStringResource = "Check My Stats"
    static var description = IntentDescription("Hear your streak, level, and today's progress.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            let s = try await IntentActions.stats()
            return .result(dialog: "You're on a \(s.streakDays)-day streak at level \(s.currentLevel), \(s.levelName). You've done \(s.todayTasksCompleted) of \(s.todayTasksTotal) quests today.")
        } catch {
            return .result(dialog: "I couldn't fetch your stats just now. Please try again.")
        }
    }
}
