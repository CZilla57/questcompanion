import Foundation

enum BrainService {
    static func state() async throws -> BrainState {
        try await APIClient.shared.get("brain/state", query: ["tz": TZ.identifier])
    }

    static func checkin(mode: BrainMode, source: String = "tap") async throws -> BrainState {
        try await APIClient.shared.post(
            "brain/checkins", body: BrainCheckinRequest(mode: mode, source: source, tz: TZ.identifier)
        )
    }

    static func pauseHyperfocus(minutes: Int) async throws -> BrainState {
        try await APIClient.shared.post("users/me/hyperfocus/pause", body: HyperfocusPauseInput(minutes: minutes))
    }

    static func logRescue(taskId: Int?, blocker: String, intervention: String) async throws {
        let _: Empty = try await APIClient.shared.request(
            "rescue/events", method: .post,
            body: RescueEventRequest(taskId: taskId, blocker: blocker, intervention: intervention)
        )
    }
}

enum ReflectionService {
    static func today() async throws -> ReflectionResponse {
        try await APIClient.shared.get("reflections/today", query: ["tz": TZ.identifier])
    }

    static func answer(chips: [String], freeText: String?) async throws -> ReflectionAnswerResponse {
        try await APIClient.shared.post(
            "reflections/today", body: ReflectionAnswerRequest(chips: chips, freeText: freeText, tz: TZ.identifier)
        )
    }
}
