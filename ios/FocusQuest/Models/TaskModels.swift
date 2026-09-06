import Foundation

struct Quest: Codable, Identifiable, Equatable {
    let id: Int
    let userId: Int
    let title: String
    let description: String?
    let points: Int
    let completed: Bool
    let completedAt: String?
    let dueDate: String?
    let priority: Priority
    let category: TaskCategory
    let categoryLabel: String
    let createdAt: String
    let estimatedMinutes: Int?
    let actualMinutes: Int?
    let isDailyFocus: Bool?
    let focusDate: String?
    let isAnchored: Bool?
    let dueTime: String?
    let steps: [TaskStep]
    let questlineId: Int?
    let recurringTaskId: Int?
    let difficulty: Difficulty
    let difficultyOfferable: Bool
    let bigSwing: Bool

    static func == (lhs: Quest, rhs: Quest) -> Bool { lhs.id == rhs.id && lhs.completed == rhs.completed }
}

struct TaskStep: Codable, Identifiable, Equatable {
    let id: Int
    let text: String
    let position: Int
    let done: Bool
}

struct StepToggleInput: Encodable { let done: Bool }

struct StepToggleResponse: Codable {
    let id: Int
    let text: String
    let position: Int
    let done: Bool
    let initiationXp: InitiationXp
}

struct FocusToggleInput: Encodable { let pin: Bool }

// MARK: - Quick add

struct ParseQuickAddInput: Encodable {
    let text: String
    let today: String?
}

struct ParsedQuickAdd: Codable {
    let title: String
    let dueDate: String?
    let dueTime: String?
    let priority: String?
    let category: String?
}

struct TranscribeResult: Codable { let text: String }

// MARK: - Create / update

struct TaskInput: Encodable {
    var title: String
    var description: String?
    var points: Int?
    var dueDate: String?
    var priority: Priority?
    var estimatedMinutes: Int?
    var category: TaskCategory?
    var dueTime: String?
    var isAnchored: Bool?
    var questlineId: Int?
    var clientKey: String?
}

struct TaskUpdate: Encodable {
    var title: String?
    var description: String?
    var points: Int?
    var dueDate: String?
    var priority: Priority?
    var estimatedMinutes: Int?
    var actualMinutes: Int?
    var category: TaskCategory?
    var dueTime: String?
    var isAnchored: Bool?
    var questlineId: Int?
}

struct ApplyDifficultyInput: Encodable { let level: Difficulty }

// MARK: - Completion

struct TaskCompletionResult: Codable {
    let task: Quest
    let pointsAwarded: Int
    let bonusAwarded: Bool
    let bonusPoints: Int
    let streakBonus: Int
    let xpMultiplier: Double
    let newTotalPoints: Int
    let newLevel: Int
    let leveledUp: Bool
    let newBadges: [Badge]
    let gearReward: GearRewardInfo?
    let surpriseReward: SurpriseReward?
    let focusBonusAwarded: Bool?
    let focusBonusPoints: Int?
    let heroRevived: Bool?
    let companionReaction: String?
    let newlyUnlocked: [String]
    // The Campaign — optional so the app decodes fine before the server deploys.
    let skillCheck: SkillCheck?
    let skillCheckNarration: String?
    let encounterHit: EncounterHit?
}

struct SurpriseReward: Codable {
    let type: String
    let xpAmount: Int?
    let gear: GearRewardInfo?
}

struct GearRewardInfo: Codable {
    let gearItemId: Int
    let name: String
    let slot: String
    let rarity: String
    let statPower: Int
    let icon: String
}

// MARK: - Momentum

struct MomentumResponse: Codable {
    let mode: BrainMode
    let suggestions: [MomentumSuggestion]
}

struct MomentumSuggestion: Codable, Identifiable {
    var id: Int { task.id }
    let task: Quest
    let reason: String
    let kind: String
}

// MARK: - Recurring

struct RecurringTask: Codable, Identifiable {
    let id: Int
    let userId: Int
    let title: String
    let description: String?
    let priority: Priority
    let daysOfWeek: [Int]
    let timeOfDay: String
    let startDate: String
    let endDate: String?
    let isActive: Bool
    let estimatedPoints: Int?
    let category: TaskCategory
    let categoryLabel: String
    let currentStreak: Int
    let longestStreak: Int
    let totalCompletions: Int
    let lastCompletedDate: String?
    let frequency: String
    let leadDays: Int
    let scheduleLabel: String
    let streakUnit: String
    let createdAt: String
}
