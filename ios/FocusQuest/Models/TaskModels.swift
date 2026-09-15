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
    // Act III party parity: the same blow landed on each shared party foe (one
    // per accepted partnership). Optional/absent for pre-deploy or no-party.
    let partyHits: [PartyEncounterHit]?
    // Act IV: the consumable spent on this completion's roll, if any. Its boost
    // is already reflected in skillCheck. Optional for pre-deploy decoding.
    let consumableUsed: ConsumableUsed?
    // Act IV "Well-Rested": whether a rested bonus rode this roll (already in
    // skillCheck.total). Optional/absent for pre-deploy.
    let wellRested: Bool?

    /// Whether this completion is worth presenting the CompletionSheet (the d20
    /// roll, rewards, level-up, badges). The server rolls a skill check on every
    /// completion regardless of the quest's day, so a normal completion — any XP
    /// awarded, or a roll to reveal — is celebration-worthy, not just a level-up
    /// or badge. Shared so the Today and Quests tabs can't drift apart: without
    /// it, completing a past-day quest from the Quests tab skipped the dice.
    var shouldCelebrate: Bool {
        leveledUp || !newBadges.isEmpty || pointsAwarded > 0 || skillCheck != nil
    }
}

/// A consumable spent on a completion's roll (Act IV). Shown as a small "used
/// Focus Draught 🧪" note; the boost is already baked into the skill check.
struct ConsumableUsed: Codable {
    let id: String
    let name: String
    let emoji: String
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

// MARK: - Recurring create

enum Frequency: String, Codable, CaseIterable {
    case weekly, monthly, yearly

    /// A starting suggestion, not a rule — a yearly quest with no runway is
    /// nearly useless, but the user owns the field. Mirrors the web's
    /// `defaultLeadDays`.
    var defaultLeadDays: Int {
        switch self {
        case .weekly: return 0
        case .monthly: return 3
        case .yearly: return 14
        }
    }
}

enum MonthlyMode: String, Codable, CaseIterable {
    case dayOfMonth = "day_of_month"
    case nthWeekday = "nth_weekday"
}

/// Mutable form state for the recurring branch of the add-quest sheet. Every
/// control stays populated so switching cadence back and forth never loses the
/// user's earlier answers; `RecurringInput.build` drops the unused ones on send.
struct RecurringDraft {
    var frequency: Frequency = .weekly
    var daysOfWeek: [Int] = [1, 2, 3, 4, 5]   // Mon–Fri (0 = Sun … 6 = Sat)
    var monthlyMode: MonthlyMode = .dayOfMonth
    var dayOfMonth: Int = 1
    var weekOfMonth: Int = 1
    var monthOfYear: Int = Calendar.current.component(.month, from: Date())
    var leadDays: Int = 0
    var timeOfDay: String = "08:00"
    var startDate: Date = Date()
    var hasEndDate: Bool = false
    var endDate: Date = Date()

    /// nth_weekday needs exactly one weekday, and weekly needs at least one —
    /// mirrors the web's `valid` guard so the client blocks the same inputs the
    /// server would reject.
    var needsWeekday: Bool { frequency == .weekly || monthlyMode == .nthWeekday }
    var isValid: Bool { !needsWeekday || !daysOfWeek.isEmpty }
}

/// Wire payload for `POST /recurring-tasks`.
struct RecurringInput: Encodable {
    var title: String
    var description: String?
    var priority: Priority
    var category: TaskCategory?
    var daysOfWeek: [Int]
    var timeOfDay: String
    var startDate: String
    var endDate: String?
    var frequency: Frequency
    var monthlyMode: MonthlyMode?
    var dayOfMonth: Int?
    var weekOfMonth: Int?
    var monthOfYear: Int?
    var leadDays: Int

    // Local formatter so this model stays dependency-free (it's shared with the
    // widget target, which doesn't compile the app's DateUtils).
    private static let ymdFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static func ymd(_ date: Date) -> String { ymdFormatter.string(from: date) }

    /// Send only the fields the chosen rule actually uses — a direct port of the
    /// web's `toRecurrencePayload`, so both surfaces prune identically and the
    /// server's `validateRecurrenceInput` sees the same shape from either client.
    static func build(title: String, description: String?, priority: Priority,
                      category: TaskCategory?, draft: RecurringDraft) -> RecurringInput {
        let category = category == .default ? nil : category   // let the server auto-categorize
        let endDate = draft.hasEndDate ? ymd(draft.endDate) : nil

        if draft.frequency == .weekly {
            return RecurringInput(
                title: title, description: description, priority: priority, category: category,
                daysOfWeek: draft.daysOfWeek, timeOfDay: draft.timeOfDay,
                startDate: ymd(draft.startDate), endDate: endDate,
                frequency: .weekly, monthlyMode: nil, dayOfMonth: nil, weekOfMonth: nil,
                monthOfYear: nil, leadDays: draft.leadDays)
        }

        let byWeekday = draft.monthlyMode == .nthWeekday
        return RecurringInput(
            title: title, description: description, priority: priority, category: category,
            // nth_weekday carries exactly one weekday; day_of_month carries none.
            daysOfWeek: byWeekday ? Array(draft.daysOfWeek.prefix(1)) : [],
            timeOfDay: draft.timeOfDay,
            startDate: ymd(draft.startDate), endDate: endDate,
            frequency: draft.frequency,
            monthlyMode: draft.monthlyMode,
            dayOfMonth: byWeekday ? nil : draft.dayOfMonth,
            weekOfMonth: byWeekday ? draft.weekOfMonth : nil,
            monthOfYear: draft.frequency == .yearly ? draft.monthOfYear : nil,
            leadDays: draft.leadDays)
    }
}
