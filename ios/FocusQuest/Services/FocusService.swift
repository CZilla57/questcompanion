import Foundation

enum FocusService {
    static func presets() async throws -> [FocusPreset] {
        try await APIClient.shared.get("focus-sessions/presets")
    }

    static func active() async throws -> FocusSession? {
        // The endpoint returns `FocusSession | null`.
        try await APIClient.shared.get("focus-sessions/active")
    }

    static func recent(limit: Int = 10) async throws -> [FocusSession] {
        try await APIClient.shared.get("focus-sessions", query: ["limit": String(limit)])
    }

    static func start(preset: FocusPresetKey, taskId: Int?) async throws -> FocusSessionCreated {
        try await APIClient.shared.request(
            "focus-sessions", method: .post, query: ["tz": TZ.identifier],
            body: StartFocusSessionInput(preset: preset, taskId: taskId)
        )
    }

    static func recordInterval(sessionId: Int, intervalIndex: Int) async throws -> FocusSession {
        try await APIClient.shared.post(
            "focus-sessions/\(sessionId)/interval", body: FocusIntervalInput(intervalIndex: intervalIndex)
        )
    }

    static func complete(sessionId: Int, partialSeconds: Int?) async throws -> FocusSessionResult {
        try await APIClient.shared.post(
            "focus-sessions/\(sessionId)/complete", body: FocusCompleteInput(partialSeconds: partialSeconds)
        )
    }
}
