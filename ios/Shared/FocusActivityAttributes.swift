import ActivityKit
import Foundation

/// Shape of the Focus Live Activity, shared between the app (which starts,
/// updates, and ends the Activity) and the widget extension (which renders it on
/// the lock screen and in the Dynamic Island). Compiled into BOTH targets.
struct FocusActivityAttributes: ActivityAttributes {
    /// The parts of the Activity that change as the session advances.
    public struct ContentState: Codable, Hashable {
        var phase: Phase
        /// Wall-clock end of the current phase — drives the self-updating
        /// `Text(timerInterval:)` countdown without any push.
        var phaseEndDate: Date
        var isPaused: Bool
    }

    /// Fixed for the life of the session.
    var questTitle: String?
    var presetLabel: String

    enum Phase: String, Codable, Hashable {
        case focus, shortBreak, longBreak

        var label: String {
            switch self {
            case .focus: return "Focus"
            case .shortBreak: return "Short break"
            case .longBreak: return "Long break"
            }
        }
    }
}
