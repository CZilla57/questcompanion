import Foundation

enum QuestlineService {
    static func list(status: String? = nil) async throws -> [Questline] {
        try await APIClient.shared.get("questlines", query: ["status": status])
    }

    static func detail(id: Int) async throws -> QuestlineDetail {
        try await APIClient.shared.get("questlines/\(id)")
    }

    static func create(_ input: QuestlineInput) async throws -> Questline {
        try await APIClient.shared.post("questlines", body: input)
    }

    static func update(id: Int, _ update: QuestlineUpdate) async throws -> Questline {
        try await APIClient.shared.patch("questlines/\(id)", body: update)
    }

    static func delete(id: Int) async throws {
        try await APIClient.shared.send("questlines/\(id)", method: .delete)
    }

    static func claim(id: Int) async throws -> QuestlineClaimResult {
        try await APIClient.shared.post("questlines/\(id)/claim")
    }

    static func suggestQuests(goal: String) async throws -> SuggestedQuestlineQuests {
        try await APIClient.shared.post("questlines/suggest-quests", body: SuggestQuestlineQuestsInput(goal: goal))
    }
}

enum CampaignService {
    static func list() async throws -> [Campaign] {
        try await APIClient.shared.get("campaigns")
    }

    static func detail(id: Int) async throws -> CampaignDetail {
        try await APIClient.shared.get("campaigns/\(id)")
    }

    static func create(_ input: CampaignInput) async throws -> Campaign {
        try await APIClient.shared.post("campaigns", body: input)
    }

    static func update(id: Int, _ update: CampaignUpdate) async throws -> Campaign {
        try await APIClient.shared.patch("campaigns/\(id)", body: update)
    }

    static func delete(id: Int) async throws {
        try await APIClient.shared.send("campaigns/\(id)", method: .delete)
    }

    static func claim(id: Int) async throws -> CampaignClaimResult {
        try await APIClient.shared.post("campaigns/\(id)/claim")
    }

    static func suggestArc(goal: String) async throws -> SuggestedCampaignArc {
        try await APIClient.shared.post("campaigns/suggest-arc", body: SuggestCampaignArcInput(goal: goal))
    }
}
