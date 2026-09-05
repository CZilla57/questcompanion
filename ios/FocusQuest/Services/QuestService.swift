import Foundation

/// Task/quest endpoints. (`Quest` is the model name to avoid clashing with
/// Swift's `Task` concurrency type.)
enum QuestService {
    /// Quests for a given local date. `date` is YYYY-MM-DD; nil returns the
    /// default (today) set the server computes from `tz`.
    static func list(date: String? = nil, completed: Bool? = nil, category: TaskCategory? = nil) async throws -> [Quest] {
        try await APIClient.shared.get("tasks", query: [
            "date": date,
            "completed": completed.map { String($0) },
            "category": category?.rawValue,
            "tz": TZ.identifier,
        ])
    }

    static func create(_ input: TaskInput) async throws -> Quest {
        try await APIClient.shared.post("tasks", body: input)
    }

    static func update(id: Int, _ update: TaskUpdate) async throws -> Quest {
        try await APIClient.shared.patch("tasks/\(id)", body: update)
    }

    static func delete(id: Int) async throws {
        try await APIClient.shared.send("tasks/\(id)", method: .delete)
    }

    static func complete(id: Int) async throws -> TaskCompletionResult {
        try await APIClient.shared.request(
            "tasks/\(id)/complete", method: .post, query: ["tz": TZ.identifier], body: Optional<Empty>.none
        )
    }

    static func uncomplete(id: Int) async throws -> Quest {
        try await APIClient.shared.post("tasks/\(id)/uncomplete")
    }

    static func pinFocus(id: Int, pin: Bool) async throws -> Quest {
        try await APIClient.shared.post("tasks/\(id)/focus", body: FocusToggleInput(pin: pin))
    }

    static func toggleStep(taskId: Int, stepId: Int, done: Bool) async throws -> StepToggleResponse {
        try await APIClient.shared.request(
            "tasks/\(taskId)/steps/\(stepId)", method: .patch, body: StepToggleInput(done: done)
        )
    }

    static func breakdown(id: Int) async throws -> [TaskStep] {
        try await APIClient.shared.post("tasks/\(id)/breakdown")
    }

    static func applyDifficulty(id: Int, level: Difficulty) async throws -> Quest {
        try await APIClient.shared.post("tasks/\(id)/difficulty", body: ApplyDifficultyInput(level: level))
    }

    // MARK: - Quick add

    static func parse(_ text: String) async throws -> ParsedQuickAdd {
        try await APIClient.shared.post("tasks/parse", body: ParseQuickAddInput(text: text, today: TZ.today))
    }

    // MARK: - Momentum

    static func momentum(minutes: Int? = nil) async throws -> MomentumResponse {
        try await APIClient.shared.get("tasks/momentum", query: [
            "minutes": minutes.map { String($0) },
            "tz": TZ.identifier,
        ])
    }

    // MARK: - Recurring

    static func recurringList() async throws -> [RecurringTask] {
        try await APIClient.shared.get("recurring-tasks")
    }

    static func recurringToggle(id: Int) async throws -> RecurringTask {
        try await APIClient.shared.post("recurring-tasks/\(id)/toggle")
    }
}
