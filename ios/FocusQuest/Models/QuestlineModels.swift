import Foundation

// MARK: - Questlines

struct Questline: Codable, Identifiable {
    let id: Int
    let userId: Int
    let title: String
    let description: String?
    let color: String?
    let status: String
    let total: Int
    let done: Int
    let ready: Bool
    let rewardXpAwarded: Int?
    let completedAt: String?
    let createdAt: String
    let campaignId: Int?
    let chapterOrder: Int?
    let chapterBeat: String?

    var progress: Double { total > 0 ? Double(done) / Double(total) : 0 }
}

struct QuestlineDetail: Codable {
    let questline: Questline
    let quests: [Quest]
}

struct QuestlineInput: Encodable {
    var title: String
    var description: String?
    var color: String?
    var questTitles: [String]?
}

struct QuestlineUpdate: Encodable {
    var title: String?
    var description: String?
    var color: String?
    var campaignId: Int?
    var chapterOrder: Int?
}

struct QuestlineClaimResult: Codable {
    let questline: Questline
    let xpAwarded: Int
    let totalPoints: Int
    let currentLevel: Int
    let levelName: String
    let leveledUp: Bool
    let newlyUnlocked: [String]
}

struct SuggestQuestlineQuestsInput: Encodable { let goal: String }
struct SuggestedQuestlineQuests: Codable { let quests: [String] }

// MARK: - Campaigns

struct Campaign: Codable, Identifiable {
    let id: Int
    let userId: Int
    let title: String
    let arcPremise: String?
    let endingBeat: String?
    let storySource: String
    let status: String
    let total: Int
    let done: Int
    let ready: Bool
    let rewardXpAwarded: Int?
    let completedAt: String?
    let createdAt: String

    var progress: Double { total > 0 ? Double(done) / Double(total) : 0 }
}

struct CampaignChapter: Codable, Identifiable {
    var id: Int { questlineId }
    let questlineId: Int
    let title: String
    let chapterOrder: Int?
    let chapterBeat: String?
    let status: String
    let total: Int
    let done: Int
}

struct CampaignDetail: Codable {
    let campaign: Campaign
    let chapters: [CampaignChapter]
    let currentChapterId: Int?
}

struct CampaignInput: Encodable {
    var title: String
    var arcPremise: String?
    var endingBeat: String?
    var storySource: String?
    var chapters: [Chapter]?

    struct Chapter: Encodable {
        var title: String
        var beat: String?
        var questTitles: [String]?
    }
}

struct CampaignUpdate: Encodable {
    var title: String?
    var arcPremise: String?
    var endingBeat: String?
    var status: String?
}

struct CampaignClaimResult: Codable {
    let campaign: Campaign
    let endingBeat: String?
    let xpAwarded: Int
    let totalPoints: Int
    let currentLevel: Int
    let levelName: String
    let leveledUp: Bool
    let newlyUnlocked: [String]?
}

struct SuggestCampaignArcInput: Encodable { let goal: String }

struct SuggestedCampaignArc: Codable {
    let arcPremise: String
    let endingBeat: String
    let source: String
    let chapters: [Chapter]

    struct Chapter: Codable { let title: String; let beat: String }
}
