import ActivityKit
import Foundation

/// Owns the Focus session Live Activity (Dynamic Island + lock-screen countdown)
/// from the app side. Starts on session start, updates on each phase change /
/// pause, and ends on finish. No-ops gracefully when Live Activities are
/// unavailable or the user has disabled them.
@MainActor
final class FocusActivityController {
    static let shared = FocusActivityController()
    private init() {}

    private var activity: Activity<FocusActivityAttributes>?

    func start(questTitle: String?, presetLabel: String, phase: FocusActivityAttributes.Phase, phaseEndDate: Date) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        endAll() // clear any stale Activity from a previous run
        let attributes = FocusActivityAttributes(questTitle: questTitle, presetLabel: presetLabel)
        let state = FocusActivityAttributes.ContentState(phase: phase, phaseEndDate: phaseEndDate, isPaused: false)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
        } catch {
            activity = nil
        }
    }

    func update(phase: FocusActivityAttributes.Phase, phaseEndDate: Date, isPaused: Bool) {
        guard let activity else { return }
        let state = FocusActivityAttributes.ContentState(phase: phase, phaseEndDate: phaseEndDate, isPaused: isPaused)
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    func end() {
        guard let activity else { return }
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    /// End every Focus Activity this app owns (belt-and-suspenders on start).
    private func endAll() {
        activity = nil
        for existing in Activity<FocusActivityAttributes>.activities {
            Task { await existing.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
