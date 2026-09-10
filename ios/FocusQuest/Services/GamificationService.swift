import Foundation

enum BadgeService {
    static func all() async throws -> [Badge] { try await APIClient.shared.get("badges") }
    static func mine() async throws -> [UserBadge] { try await APIClient.shared.get("users/me/badges") }
}

enum ProgressService {
    static func insights(days: Int = 30) async throws -> InsightsResponse {
        try await APIClient.shared.get("users/me/insights", query: ["days": String(days), "tz": TZ.identifier])
    }

    static func patterns() async throws -> PatternSummary {
        try await APIClient.shared.get("users/me/patterns", query: ["tz": TZ.identifier])
    }

    static func heatmap(days: Int = 90) async throws -> HeatmapResponse {
        try await APIClient.shared.get("calendar/heatmap", query: ["days": String(days)])
    }

    static func leaderboard(period: String = "week") async throws -> [LeaderboardEntry] {
        try await APIClient.shared.get("leaderboard", query: ["period": period])
    }

    static func myWeek() async throws -> MyWeekComparison {
        try await APIClient.shared.get("leaderboard/my-week")
    }

    static func recaps() async throws -> RecapsResponse {
        try await APIClient.shared.get("recaps")
    }
}

enum RewardsService {
    static func coins() async throws -> Coins { try await APIClient.shared.get("coins") }

    static func rewardStore() async throws -> [RewardStoreItem] {
        try await APIClient.shared.get("rewards-store")
    }

    static func addReward(label: String, tier: String) async throws -> RewardStoreItem {
        try await APIClient.shared.post("rewards-store", body: RewardStoreItemInput(label: label, tier: tier))
    }

    static func deleteReward(id: Int) async throws {
        try await APIClient.shared.send("rewards-store/\(id)", method: .delete)
    }

    static func redeem(id: Int) async throws -> RedeemResult {
        try await APIClient.shared.post("rewards-store/\(id)/redeem")
    }

    // Dopamine menu
    static func dopamineRewards() async throws -> [DopamineReward] {
        try await APIClient.shared.get("dopamine-rewards")
    }

    static func addDopamineReward(text: String) async throws -> DopamineReward {
        try await APIClient.shared.post("dopamine-rewards", body: DopamineRewardInput(rewardText: text))
    }

    static func deleteDopamineReward(id: Int) async throws {
        try await APIClient.shared.send("dopamine-rewards/\(id)", method: .delete)
    }

    // Mystery box
    static func mysteryStatus() async throws -> MysteryStatus {
        try await APIClient.shared.get("mystery-box")
    }

    static func openMystery() async throws -> MysteryResult {
        try await APIClient.shared.post("mystery-box/open")
    }

    // Stat perks
    static func statPerks() async throws -> StatPerks {
        try await APIClient.shared.get("stat-perks")
    }

    static func buyPerk(id: String) async throws -> StatPerkPurchaseResult {
        try await APIClient.shared.post("stat-perks/\(id)/buy")
    }

    // Act IV consumables: buy a potion, then queue ONE to boost the next roll.
    static func consumables() async throws -> ConsumablesResponse {
        try await APIClient.shared.get("consumables")
    }

    static func buyConsumable(id: String) async throws -> ConsumablePurchaseResult {
        try await APIClient.shared.post("consumables/\(id)/buy")
    }

    /// Queue a consumable for the next roll, or pass "none" to clear the queue.
    @discardableResult
    static func activateConsumable(id: String) async throws -> ConsumableQueue {
        try await APIClient.shared.post("consumables/\(id)/activate")
    }
}

enum HeroService {
    static func avatar() async throws -> AvatarProfile { try await APIClient.shared.get("avatar") }

    static func updateAvatar(_ input: AvatarUpdateInput) async throws -> AvatarProfile {
        try await APIClient.shared.patch("avatar", body: input)
    }

    static func gearStore() async throws -> GearStoreResponse { try await APIClient.shared.get("gear/store") }

    static func buyGear(id: Int) async throws -> BuyGearResult { try await APIClient.shared.post("gear/\(id)/buy") }

    static func equipGear(id: Int) async throws -> AvatarProfile { try await APIClient.shared.post("gear/\(id)/equip") }

    static func unequipGear(id: Int) async throws -> AvatarProfile { try await APIClient.shared.post("gear/\(id)/unequip") }

    static func inventory() async throws -> InventoryResponse { try await APIClient.shared.get("gear/inventory") }

    static func salvageGear(id: Int) async throws -> SalvageResult { try await APIClient.shared.post("gear/\(id)/salvage") }

    static func attuneGear(id: Int) async throws { try await APIClient.shared.send("gear/\(id)/attune", method: .post) }

    static func unattuneGear(id: Int) async throws { try await APIClient.shared.send("gear/\(id)/unattune", method: .post) }

    // World boss & battle
    static func worldBoss() async throws -> WorldBossStatus { try await APIClient.shared.get("world-boss/current") }
    static func attackBoss() async throws -> WorldBossAttackResult { try await APIClient.shared.post("world-boss/attack") }
    static func battle() async throws -> BattleStatus { try await APIClient.shared.get("battle/current") }
    static func enterBattle() async throws -> BattleResult { try await APIClient.shared.post("battle/enter") }
}
