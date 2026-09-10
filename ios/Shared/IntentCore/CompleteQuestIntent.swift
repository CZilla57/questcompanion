import AppIntents
import WidgetKit

struct CompleteQuestIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete a Quest"
    static var description = IntentDescription("Mark a FocusQuest quest done.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Quest")
    var quest: QuestEntity?

    init() {}
    init(quest: QuestEntity?) { self.quest = quest }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            let targetId: Int?
            if let quest { targetId = quest.id }
            else { targetId = try await IntentActions.momentumNext()?.id }
            guard let id = targetId else { return .result(dialog: "You're all clear — no quests to complete.") }

            let result = try await IntentActions.completeQuest(id: id)
            WidgetCenter.shared.reloadAllTimelines()
            let levelLine = result.leveledUp ? " You reached level \(result.newLevel)!" : ""
            return .result(dialog: "Completed “\(result.task.title)” — \(result.pointsAwarded) points.\(levelLine)")
        } catch {
            return .result(dialog: "I couldn't complete that quest just now. Please try again.")
        }
    }
}
