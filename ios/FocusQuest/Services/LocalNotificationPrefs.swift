import Foundation

/// User toggles for the app's on-device (local) notification categories, stored in
/// UserDefaults so both the Settings screen (@AppStorage) and the schedulers read
/// the same source of truth. Unset ⇒ on.
enum LocalNotificationPrefs {
    static let focusAlertsKey = "localNotif.focusAlerts"
    static let questNudgesKey = "localNotif.questNudges"

    static var focusAlerts: Bool { UserDefaults.standard.object(forKey: focusAlertsKey) as? Bool ?? true }
    static var questNudges: Bool { UserDefaults.standard.object(forKey: questNudgesKey) as? Bool ?? true }
}
