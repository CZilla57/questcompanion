import Foundation

/// Keeps on-device "your quest is scheduled for now" nudges in sync with the
/// user's upcoming quests. Local notifications only (no push).
@MainActor
enum QuestNudgeScheduler {
    /// Cap on pending quest nudges — headroom under iOS's 64-pending limit so
    /// Focus phase alerts always fit.
    private static let maxPending = 32

    /// Fetch today's + tomorrow's quests and reconcile their due-time nudges.
    /// Safe to call on every app foreground and after any quest mutation.
    static func refresh() async {
        async let today = try? QuestService.list(date: TZ.today)
        async let tomorrow = try? QuestService.list(date: TZ.dateString(daysFromToday: 1))
        let quests = ((await today) ?? []) + ((await tomorrow) ?? [])
        sync(quests: quests)
    }

    /// Pure reconcile against a quest set (deduped by id): schedule the soonest
    /// `maxPending` incomplete quests whose dueDate+dueTime is still in the future.
    static func sync(quests: [Quest]) {
        guard LocalNotificationPrefs.questNudges else {
            NotificationManager.shared.syncQuestDueAlerts([]) // clears all pending quest.* nudges
            return
        }
        let now = Date()
        var byId: [Int: NotificationManager.QuestDueAlert] = [:]
        for q in quests where !q.completed {
            guard let date = q.dueDate, let time = q.dueTime,
                  let fire = DateUtils.dueFireDate(date: date, time: time),
                  fire > now else { continue }
            byId[q.id] = .init(questId: q.id, fireDate: fire, title: q.title)
        }
        let desired = byId.values.sorted { $0.fireDate < $1.fireDate }.prefix(maxPending)
        NotificationManager.shared.syncQuestDueAlerts(Array(desired))
    }

    /// Immediately drop one quest's nudge (on complete/delete) without a full refresh.
    static func cancel(questId: Int) {
        NotificationManager.shared.cancelQuestDue(questId: questId)
    }
}
