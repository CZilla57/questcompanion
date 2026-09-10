import AppIntents

struct BrainCheckInIntent: AppIntent {
    static var title: LocalizedStringResource = "Brain Check-In"
    static var description = IntentDescription("Log how your brain feels right now.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Mode", default: .neutral)
    var mode: BrainModeOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            _ = try await IntentActions.brainCheckin(mode: mode.mode)
            return .result(dialog: "Logged you as \(mode.mode.label.lowercased()). Nice check-in.")
        } catch {
            return .result(dialog: "I couldn't log that just now. Please try again.")
        }
    }
}
