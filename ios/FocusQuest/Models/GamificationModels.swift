import Foundation

// MARK: - Badges

struct Badge: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String
    let icon: String
    let category: String
    let requirement: Int
}

struct UserBadge: Codable, Identifiable {
    var id: Int { badge.id }
    let badge: Badge
    let earnedAt: String
}

struct XpDataPoint: Codable, Identifiable {
    var id: String { date }
    let date: String
    let label: String
    let xp: Int
}

// MARK: - Coins & rewards

struct Coins: Codable { let balance: Int }

struct RewardStoreItem: Codable, Identifiable {
    let id: Int
    let userId: Int
    let label: String
    let tier: String
    let coinCost: Int
    let createdAt: String
    let affordable: Bool
    let remaining: Int
}

struct RewardStoreItemInput: Encodable { let label: String; let tier: String }

struct RedeemResult: Codable {
    let redeemed: Bool
    let balance: Int
    let affordable: Bool
    let remaining: Int
}

// MARK: - Mystery box

struct MysteryStatus: Codable {
    let cost: Int
    let balance: Int
    let rewardCount: Int
    let canOpen: Bool
    let reason: String
    let remaining: Int
}

struct MysteryReward: Codable { let id: Int; let rewardText: String }

struct MysteryResult: Codable {
    let opened: Bool
    let reason: String
    let cost: Int
    let balance: Int
    let remaining: Int?
    let bonus: Int?
    let reward: MysteryReward?
}

// MARK: - Stat perks

struct StatPerks: Codable {
    let balance: Int
    let perks: [StatPerk]
}

struct StatPerk: Codable, Identifiable {
    let id: String
    let kind: String
    let label: String
    let emoji: String
    let description: String
    let coinCost: Int
    let affordable: Bool
    let remaining: Int
    let active: Bool?
    let expiresAt: String?
    let owned: Int?
    let atMax: Bool?
}

struct StatPerkPurchaseResult: Codable {
    let purchased: Bool
    let reason: String
    let affordable: Bool
    let balance: Int
    let remaining: Int?
    let expiresAt: String?
    let owned: Int?
}

// MARK: - Dopamine menu

struct DopamineReward: Codable, Identifiable {
    let id: Int
    let userId: Int
    let rewardText: String
    let createdAt: String
}

struct DopamineRewardInput: Encodable { let rewardText: String }

// MARK: - Gear store & avatar

struct GearStoreResponse: Codable {
    let items: [GearStoreItem]
    let coinBalance: Int
    let userLevel: Int
}

struct GearStoreItem: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String
    let slot: String
    let rarity: String
    let statPower: Int
    let costCoins: Int
    let levelRequired: Int
    let icon: String
    let spriteId: String?
    let owned: Bool
    let equipped: Bool
    let canAfford: Bool
    let meetsLevel: Bool
}

struct BuyGearResult: Codable {
    let purchased: Bool
    let reason: String
    let balance: Int
    let remaining: Int
    let coinsSpent: Int?
}

struct EquippedGearItem: Codable, Identifiable {
    let id: Int
    let name: String
    let slot: String
    let rarity: String
    let statPower: Int
    let icon: String
    let spriteId: String?
}

struct AvatarProfile: Codable {
    let avatarColor: String
    let avatarClass: String
    let avatarSkin: String
    let level: Int
    let battlePower: Int
    let equippedGear: [EquippedGearItem]
    let availableColors: [String]
    let availableClasses: [String]
    let availableSkins: [String]
}

struct AvatarUpdateInput: Encodable {
    var avatarColor: String?
    var avatarClass: String?
    var avatarSkin: String?
}

// MARK: - World boss & battle

struct WorldBossStatus: Codable {
    let weekKey: String
    let hp: Int
    let totalDamage: Int
    let defeated: Bool
    let defeatedAt: String?
    let attackedToday: Bool
    let yourContribution: Int
    let yourPower: Int
    let attackXp: Int
    let defeatCoins: Int
    let defeatXp: Int
    let contributors: [WorldBossContributor]
}

struct WorldBossContributor: Codable, Identifiable {
    var id: Int { userId }
    let userId: Int
    let displayName: String
    let avatarColor: String
    let damage: Int
    let isAlly: Bool
}

struct WorldBossAttackResult: Codable {
    let attacked: Bool
    let reason: String?
    let damage: Int?
    let hp: Int
    let totalDamage: Int
    let defeated: Bool
    let justDefeated: Bool
    let xpAwarded: Int
    let coinsAwarded: Int
}

struct BattleStatus: Codable {
    let weekKey: String
    let bossPower: Int
    let yourPower: Int
    let entered: Bool
    let result: String?
    let xpAwarded: Int?
    let roll: Int?
    let foughtAt: String?
    let winXp: Int
    let loseXp: Int
}

struct BattleResult: Codable {
    let result: String
    let xpAwarded: Int
    let bossPower: Int
    let yourPower: Int
    let roll: Int
    let weekKey: String
}

// MARK: - Heatmap

struct HeatmapResponse: Codable { let days: [HeatmapDay] }

struct HeatmapDay: Codable, Identifiable {
    var id: String { date }
    let date: String
    let totalTasks: Int
    let completedTasks: Int
    let xpEarned: Int
}
