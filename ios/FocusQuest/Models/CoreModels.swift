import Foundation

// MARK: - Auth

struct AuthUser: Codable, Equatable, Identifiable {
    let id: String
    let email: String?
    let firstName: String?
    let lastName: String?
    let profileImageUrl: String?

    var displayName: String {
        [firstName, lastName].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }
}

struct AuthUserEnvelope: Codable {
    let user: AuthUser?
}

// MARK: - User / stats

struct User: Codable, Identifiable {
    let id: Int
    let username: String
    let displayName: String?
    let avatarColor: String?
    let totalPoints: Int
    let weeklyPoints: Int?
    let currentLevel: Int
    let levelName: String?
    let streakDays: Int
    let longestStreak: Int?
    let pointsToNextLevel: Int?
    let createdAt: String
    let renameAvailableAt: String?

    var name: String { displayName ?? username }
}

struct UserSummary: Codable, Identifiable {
    let id: Int
    let username: String
    let displayName: String?
    let avatarColor: String?
    let currentLevel: Int
    let levelName: String?
    let totalPoints: Int
    let streakDays: Int?

    var name: String { displayName ?? username }
}

struct UserStats: Codable {
    let todayPoints: Int
    let todayTasksTotal: Int
    let todayTasksCompleted: Int
    let allDayBonusEarned: Bool
    let weeklyPoints: Int
    let totalPoints: Int
    let currentLevel: Int
    let levelName: String
    let streakDays: Int
    let streakFreezes: Int
    let onboardingComplete: Bool
    let pointsToNextLevel: Int
    let pointsIntoLevel: Int
    let recentActivity: [ActivityItem]
    /// Kept as raw strings so an unrecognized server feature never fails decode.
    let unlockedFeatures: [String]

    var features: Set<FeatureKey> { Set(unlockedFeatures.compactMap { FeatureKey(rawValue: $0) }) }

    /// Fraction of the way through the current level band (0...1).
    var levelProgress: Double {
        let denom = pointsIntoLevel + pointsToNextLevel
        guard denom > 0 else { return 0 }
        return min(1, max(0, Double(pointsIntoLevel) / Double(denom)))
    }

    var todayProgress: Double {
        guard todayTasksTotal > 0 else { return 0 }
        return min(1, Double(todayTasksCompleted) / Double(todayTasksTotal))
    }
}

struct ActivityItem: Codable, Identifiable {
    let id: Int
    let userId: Int
    let username: String?
    let type: String
    let description: String
    let points: Int
    let createdAt: String
}

// MARK: - Hero

struct HeroStatus: Codable {
    let stage: String
    let mood: String
    let lastFedAt: String
    let activity: Activity
    let companion: Companion

    struct Activity: Codable {
        let id: String
        let text: String
    }

    struct Companion: Codable {
        let beat: String
        let line: String
        let bondTier: Int
        let bondTierName: String
        let bondQuestsCompleted: Int
    }

    /// SF Symbol counterpart of the hero mood, rendered in electric teal.
    var stageSymbol: String {
        switch stage {
        case "well_fed": return "face.smiling.fill"
        case "peckish": return "face.smiling"
        case "hungry": return "face.dashed"
        case "starving": return "face.dashed.fill"
        case "fainted": return "moon.zzz.fill"
        default: return "person.fill"
        }
    }
}

// MARK: - Kingdoms

struct KingdomsResponse: Codable {
    let worldResting: Bool
    let kingdoms: [KingdomState]
    let invitation: KingdomInvitation?
}

struct KingdomState: Codable, Identifiable {
    let id: String
    let name: String
    let isCapital: Bool
    let lifetimePoints: Int
    let tier: Int
    let tierName: String
    let liveliness: String?
}

struct KingdomInvitation: Codable {
    let kingdomId: String
    let kingdomName: String
}

// MARK: - Health

struct HealthStatus: Codable {
    let status: String
}
