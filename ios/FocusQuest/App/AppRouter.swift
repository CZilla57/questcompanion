import SwiftUI

/// Shared tab selection so one screen can send the user to another tab
/// (e.g. Today's "View All" → the Quests tab), matching the web app's
/// in-page links between sections.
@MainActor
final class AppRouter: ObservableObject {
    enum Tab: Int { case today, quests, focus, hero, more }
    @Published var tab: Tab = .today
}
