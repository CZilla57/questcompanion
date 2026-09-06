import CoreHaptics
import UIKit

/// Tasteful haptic feedback for the reward loop — a quick success tap on quest
/// complete, a richer celebratory pattern on level-up, and a distinct cue when a
/// focus interval ends. Every call is gated on a single Settings toggle so this
/// helper is the one source of truth; unset ⇒ on, mirroring `LocalNotificationPrefs`.
@MainActor
enum Haptics {
    static let enabledKey = "haptics.enabled"

    static var isEnabled: Bool { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }

    // MARK: - Public triggers

    /// Quest complete — a single, unobtrusive success tap.
    static func success() {
        guard isEnabled else { return }
        notify(.success)
    }

    /// Level-up — a celebratory build-and-pop. Falls back to a success tap where
    /// Core Haptics isn't available.
    static func levelUp() {
        guard isEnabled else { return }
        guard playCustom(levelUpEvents()) else { notify(.success); return }
    }

    /// Focus interval / session ended — a gentle two-beat cue, distinct from the
    /// level-up flourish. Same graceful fallback.
    static func timerDone() {
        guard isEnabled else { return }
        guard playCustom(timerDoneEvents()) else { notify(.success); return }
    }

    // MARK: - UIKit feedback

    private static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(type)
    }

    // MARK: - Core Haptics engine

    /// Whether the current hardware can play custom Core Haptics patterns.
    private static let supportsHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    /// One shared engine — spinning up a fresh engine per tap is wasteful and adds
    /// latency. Lazily created and restarted if the system stops it.
    private static var engine: CHHapticEngine?

    /// Returns a running engine, or nil if Core Haptics is unavailable / failed to
    /// start (callers fall back to notification feedback).
    private static func runningEngine() -> CHHapticEngine? {
        guard supportsHaptics else { return nil }
        if let engine { return engine }
        do {
            let engine = try CHHapticEngine()
            // The system can reset the engine (e.g. after an audio-session change);
            // restart it so the next pattern still plays.
            engine.resetHandler = { try? engine.start() }
            // Drop our reference when it stops so we recreate cleanly next time.
            engine.stoppedHandler = { _ in Haptics.engine = nil }
            try engine.start()
            self.engine = engine
            return engine
        } catch {
            engine = nil
            return nil
        }
    }

    /// Plays a custom pattern. Returns false if it couldn't run so the caller can
    /// fall back to notification feedback.
    private static func playCustom(_ events: [CHHapticEvent]) -> Bool {
        guard let engine = runningEngine() else { return false }
        do {
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Patterns

    /// Rising transients into a fuller buzz — reads as a small win.
    private static func levelUpEvents() -> [CHHapticEvent] {
        [
            transient(at: 0, intensity: 0.6, sharpness: 0.4),
            transient(at: 0.09, intensity: 0.8, sharpness: 0.5),
            CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    .init(parameterID: .hapticIntensity, value: 1.0),
                    .init(parameterID: .hapticSharpness, value: 0.6),
                ],
                relativeTime: 0.18, duration: 0.3),
        ]
    }

    /// Two soft, evenly spaced taps — a calm "that's done", no urgency.
    private static func timerDoneEvents() -> [CHHapticEvent] {
        [
            transient(at: 0, intensity: 0.7, sharpness: 0.3),
            transient(at: 0.16, intensity: 0.7, sharpness: 0.3),
        ]
    }

    private static func transient(at time: TimeInterval, intensity: Float, sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                .init(parameterID: .hapticIntensity, value: intensity),
                .init(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time)
    }
}
