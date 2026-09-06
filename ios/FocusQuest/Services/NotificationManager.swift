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
        }
        // TODO(Phase1 Task4): route quest.<id> nudges
    }
}
