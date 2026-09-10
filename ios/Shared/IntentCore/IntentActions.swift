import Foundation

/// The only networking surface App Intents use. Lives in IntentCore so both the
/// app process (Siri) and the widget-extension process (interactive buttons) call
/// one implementation. Each caller invokes `authorize()` first.
enum IntentActions {
    /// Load the session token from the Keychain into the shared client.
    /// Returns false when the user isn't signed in.
    static func authorize() async -> Bool {
        guard let token = Keychain.get(account: Keychain.sessionTokenAccount) else { return false }
        await APIClient.shared.setToken(token)
        return true
    }

    static func todaysQuests() async throws -> [Quest] {
        try await QuestService.list()
    }

    static func momentumNext() async throws -> Quest? {
        try await QuestService.momentum().suggestions.first?.task
    }

    static func completeQuest(id: Int) async throws -> TaskCompletionResult {
        try await QuestService.complete(id: id)
    }

    static func startFocus(preset: FocusPresetKey) async throws -> FocusSessionCreated {
        try await FocusService.start(preset: preset, taskId: nil)
    }

    static func stats() async throws -> UserStats { try await UserService.stats() }

    static func brainCheckin(mode: BrainMode) async throws -> BrainState {
        try await BrainService.checkin(mode: mode, source: "siri")
    }
}
