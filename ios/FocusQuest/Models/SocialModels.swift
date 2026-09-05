import Foundation

// MARK: - Accountability partners

struct Partnership: Codable, Identifiable {
    let id: Int
    let requesterId: Int
    let recipientId: Int
    let status: String
    let partner: UserSummary?
    let createdAt: String
    let progress: AllyProgress?
    let hasFreshMilestone: Bool?
    let sentTodayPoke: Bool?
    let sentTodayCheer: Bool?
}

struct PartnerRequestInput: Encodable { let recipientId: Int }

struct AllyProgress: Codable {
    let questsDueToday: Int
    let questsCompletedToday: Int
    let allDoneToday: Bool
}

struct HeroLook: Codable {
    let avatarColor: String
    let avatarClass: String
    let avatarSkin: String
    let level: Int
    let battlePower: Int
    let equippedGear: [EquippedGearItem]
}

struct AllyDetail: Codable {
    let partner: UserSummary
    let progress: AllyProgress
    let hero: HeroLook?
    let badges: [UserBadge]
    let milestones: [ActivityItem]
    let sentTodayPoke: Bool
    let sentTodayCheer: Bool
}

// MARK: - Nudges

struct NudgeInput: Encodable {
    let kind: String
    let reaction: String
    let contextType: String?
}

struct SentNudge: Codable, Identifiable {
    let id: Int
    let kind: String
    let reaction: String
    let createdAt: String
}

struct Nudge: Codable, Identifiable {
    let id: Int
    let kind: String
    let reaction: String
    let reactionLabel: String?
    let contextType: String?
    let sender: UserSummary?
    let createdAt: String
    let readAt: String?
}

struct MarkNudgesReadInput: Encodable { let ids: [Int] }

// MARK: - Body double rooms

struct BodyDoubleOpenRoom: Codable, Identifiable {
    let id: Int
    let host: UserSummary
    let isMine: Bool
    let amMember: Bool
    let memberCount: Int
    let createdAt: String
}

struct BodyDoubleRoomState: Codable, Identifiable {
    let id: Int
    let hostId: Int
    let status: String
    let createdAt: String
    let endedAt: String?
    let isMine: Bool
    let members: [BodyDoubleRoomMember]
    let sprint: BodyDoubleSprint?
    let serverNow: String
}

struct BodyDoubleRoomMember: Codable, Identifiable {
    let id: Int
    let username: String
    let displayName: String?
    let avatarColor: String?
    let currentLevel: Int
    let levelName: String?
    let totalPoints: Int
    let streakDays: Int?
    let isHost: Bool
    let presence: String
    let joinedAt: String
    let waveAt: String?

    var name: String { displayName ?? username }
}

struct BodyDoubleSprint: Codable, Identifiable {
    let id: Int
    let minutes: Int
    let startedBy: Int
    let startedAt: String
}

struct BodyDoubleSprintInput: Encodable { let minutes: Int }

// MARK: - Leaderboard

struct LeaderboardEntry: Codable, Identifiable {
    var id: Int { user.id }
    let rank: Int
    let user: UserSummary
    let points: Int
    let tasksCompleted: Int?
}

struct MyWeekComparison: Codable {
    let timezone: String
    let weekStartDateKey: String
    let quests: MyWeekMetric
    let xp: MyWeekMetric
    let focusMinutes: MyWeekMetric
}

struct MyWeekMetric: Codable {
    let current: Int
    let samePointLastWeek: Int
    let lastWeekTotal: Int
}
