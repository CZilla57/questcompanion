import AppIntents

struct QuestEntity: AppEntity {
    let id: Int
    let title: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Quest" }
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
    static var defaultQuery = QuestEntityQuery()

    init(id: Int, title: String) { self.id = id; self.title = title }
    init(quest: Quest) { self.id = quest.id; self.title = quest.title }
}

struct QuestEntityQuery: EntityQuery {
    func entities(for ids: [Int]) async throws -> [QuestEntity] {
        guard await IntentActions.authorize() else { return [] }
        let quests = try await IntentActions.todaysQuests()
        let byId = Dictionary(uniqueKeysWithValues: quests.map { ($0.id, $0) })
        return ids.compactMap { byId[$0].map(QuestEntity.init(quest:)) }
    }

    /// Live picker: today's not-yet-completed quests.
    func suggestedEntities() async throws -> [QuestEntity] {
        guard await IntentActions.authorize() else { return [] }
        return try await IntentActions.todaysQuests()
            .filter { !$0.completed }
            .map(QuestEntity.init(quest:))
    }
}
