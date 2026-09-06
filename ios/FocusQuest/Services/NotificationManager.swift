import Foundation
import UserNotifications
import UIKit

/// On-device local notifications only.
///
/// This service manages **local** user notifications via `UNUserNotificationCenter`
/// — there is no push, no APNs, and no remote-notification background mode involved.
/// It is the foundation for scheduling Focus phase-end alerts (and, later, quest
/// nudges) entirely on the device. It also acts as the notification-center delegate
/// so taps route the user to the right screen and foreground alerts still surface.
@MainActor
final class NotificationManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    /// The current system authorization for local notifications. Refreshed on demand
    /// (e.g. when a screen appears) via `refreshAuthorizationStatus()`.
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined

    private override init() { super.init() }

    // MARK: - Authorization

    /// Re-reads the live authorization status from the system.
    func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    /// Ensures we have permission to post local notifications, requesting it once if
    /// the user has not yet been asked.
    ///
    /// - Returns: `true` if notifications may be posted (authorized/provisional, or a
    ///   freshly granted request), `false` if denied.
    func requestAuthorizationIfNeeded() async -> Bool {
        await refreshAuthorizationStatus()
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            let granted = (try? await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound])) ?? false
            await refreshAuthorizationStatus()
            return granted
        @unknown default:
            await refreshAuthorizationStatus()
            return authorizationStatus == .authorized || authorizationStatus == .provisional
        }
    }

    // MARK: - Focus phase alerts

    /// Schedules a time-sensitive local notification for the end of a Focus phase
    /// (e.g. a focus interval or a break) at `fireDate`.
    ///
    /// Called by the Focus flow when a session starts/advances. Identifiers are keyed
    /// as `focus.<sessionId>.<phase>` so they can be cancelled together per session.
    func scheduleFocusPhaseEnd(sessionId: Int, phase: String, fireDate: Date, title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive

        let components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: fireDate
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(
            identifier: "focus.\(sessionId).\(phase)", content: content, trigger: trigger
        )
        UNUserNotificationCenter.current().add(request)
    }

    /// Cancels every pending Focus alert for the given session (all phases).
    func cancelFocusPhaseAlerts(sessionId: Int) {
        let prefix = "focus.\(sessionId)."
        UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
            let ids = requests
                .map(\.identifier)
                .filter { $0.hasPrefix(prefix) }
            guard !ids.isEmpty else { return }
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
        }
    }

    /// Cancels specific pending Focus alerts for a session by exact identifier
    /// (`focus.<sessionId>.<phase>`). Unlike the prefix variant above, this is a
    /// single synchronous `remove` with no async fetch — so it is safe to call
    /// immediately before scheduling a *different* phase's alert in the same scope
    /// (the removed identifiers are disjoint from the one being added, so no race
    /// can delete the freshly-scheduled request).
    func cancelFocusPhaseAlerts(sessionId: Int, phases: [String]) {
        guard !phases.isEmpty else { return }
        let ids = phases.map { "focus.\(sessionId).\($0)" }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }

    // MARK: - Quest due-time nudges

    /// A quest due-time nudge to keep scheduled. Value type so it can cross the
    /// getPendingNotificationRequests completion (off-main) safely.
    struct QuestDueAlert: Sendable {
        let questId: Int
        let fireDate: Date
        let title: String
    }

    // Build the local request for a quest nudge. `nonisolated` so it can run inside
    // the off-main getPending completion — a plain `static` on this @MainActor class
    // would itself be MainActor-isolated and illegal to call from there.
    private nonisolated static func questRequest(_ alert: QuestDueAlert) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = "Quest time"
        content.body = "\"\(alert.title)\" is scheduled for now."
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        let comps = Calendar.current.dateComponents([.year,.month,.day,.hour,.minute], from: alert.fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        return UNNotificationRequest(identifier: "quest.\(alert.questId)", content: content, trigger: trigger)
    }

    /// Cancel one quest's pending nudge immediately (exact id, synchronous).
    nonisolated func cancelQuestDue(questId: Int) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["quest.\(questId)"])
    }

    /// Reconcile all pending quest nudges to exactly `desired`: remove pending
    /// quest.* not in the set (disjoint from adds — no add/remove race), (re)add the
    /// desired (add replaces a same-id pending, so re-adding is harmless).
    nonisolated func syncQuestDueAlerts(_ desired: [QuestDueAlert]) {
        let center = UNUserNotificationCenter.current()
        let desiredIds = Set(desired.map { "quest.\($0.questId)" })
        center.getPendingNotificationRequests { requests in
            let existing = Set(requests.map(\.identifier).filter { $0.hasPrefix("quest.") })
            let stale = existing.subtracting(desiredIds)
            if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: Array(stale)) }
            for alert in desired { center.add(Self.questRequest(alert)) }
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Keep alerting even when the app is foregrounded at phase end, so the user isn't
    /// left staring at a paused-looking timer with no signal.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// Routes a notification tap to the relevant screen.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let identifier = response.notification.request.identifier
        if identifier.hasPrefix("focus.") {
            AppRouter.shared.tab = .focus
        } else if identifier.hasPrefix("quest.") {
            AppRouter.shared.tab = .quests
        }
    }
}
