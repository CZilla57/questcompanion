import AppIntents

/// Start a focus session from Siri / Shortcuts without opening the app. The
/// session is created server-side; the app adopts the live timer the next time the
/// Focus tab appears or the app returns to the foreground (see `FocusViewModel`).
struct StartFocusIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a Focus Session"
    static var description = IntentDescription("Start a FocusQuest focus session in the background.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Preset", default: .classic)
    var preset: FocusPresetOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            _ = try await IntentActions.startFocus(preset: preset.key)
            // Reflect the running session for widgets; app adopts the live timer on next open.
            if var snap = WidgetSharedStore.read() { snap.activeFocus = true; snap.updatedAt = .now; WidgetSharedStore.write(snap) }
            return .result(dialog: "Started a \(preset.rawValue == "deep" ? "Deep Work" : preset.rawValue.capitalized) focus session. Open FocusQuest to run the timer.")
        } catch {
            return .result(dialog: "I couldn't start a focus session just now. Please try again.")
        }
    }
}
