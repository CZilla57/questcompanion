import SwiftUI

/// Shared tab selection so one screen can send the user to another tab
/// (e.g. Today's "View All" → the Quests tab), matching the web app's
/// in-page links between sections.
@MainActor
final class AppRouter: ObservableObject {
    /// Single shared router so non-View entry points (e.g. the notification-center
    /// delegate handling a notification tap) can drive the same tab selection the UI
    /// observes.
    static let shared = AppRouter()

    enum Tab: Int { case today, quests, focus, hero, more }
    @Published var tab: Tab = .today
}
