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

    /// A non-tab destination nested inside a tab (e.g. Reflection lives under the
    /// More tab). Set alongside `tab` when a deep link targets one of these so the
    /// hosting view can present it, then cleared once presented/dismissed.
    enum DetailRoute: Equatable { case reflection }
    @Published var pendingDetail: DetailRoute?
}
