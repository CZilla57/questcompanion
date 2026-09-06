import SwiftUI
import Combine

/// Drives a Pomodoro-style focus session. The countdown is derived from a
/// wall-clock `phaseEndDate` so it stays correct across backgrounding. Focus
/// intervals are reported to the server (`recordInterval`), which owns XP; the
/// session is finalized with `complete`.
@MainActor
final class FocusViewModel: ObservableObject {
    enum Phase { case focus, shortBreak, longBreak }

    @Published var presets: [FocusPreset] = []
    @Published var setup: Loadable<Void> = .idle
    @Published var selectedPreset: FocusPresetKey = .classic
    @Published var quests: [Quest] = []
    @Published var selectedTaskId: Int?

    @Published private(set) var session: FocusSession?
    @Published private(set) var phase: Phase = .focus
    @Published private(set) var remaining: Int = 0
    @Published private(set) var isBusy = false
    @Published private(set) var isPaused = false
    @Published var lastResult: FocusSessionResult?
    @Published var error: String?

    private var phaseEndDate: Date?
    private var phaseStartDate: Date?
    private var pausedAt: Date?
    private var ticker: AnyCancellable?

    var preset: FocusPreset? { presets.first { $0.key == (session?.preset ?? selectedPreset) } }
    var isActive: Bool { session != nil }

    // MARK: - Loading

    func load() async {
        setup = .loading
        do {
            async let presetsResult = FocusService.presets()
            async let activeResult = FocusService.active()
            async let questsResult = try? QuestService.list(date: TZ.today)
            let (p, active) = try await (presetsResult, activeResult)
            presets = p
            quests = (await questsResult)?.filter { !$0.completed } ?? []
            if let active { adopt(active) }
            setup = .loaded(())
        } catch {
            setup = .failed(error.userMessage)
        }
    }

    // MARK: - Lifecycle

    func start() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let created = try await FocusService.start(preset: selectedPreset, taskId: selectedTaskId)
            adopt(created.session)
            // Ask once (idempotent); the timer still runs if denied — scheduling no-ops.
            _ = await NotificationManager.shared.requestAuthorizationIfNeeded()
        } catch {
            self.error = error.userMessage
        }
    }

    func stop() async {
        guard let session else { return }
        stopTicker()
        let partial = phase == .focus ? elapsedInPhase() : nil
        isBusy = true
        defer { isBusy = false }
        do {
            let result = try await FocusService.complete(sessionId: session.id, partialSeconds: partial)
            lastResult = result
        } catch {
            self.error = error.userMessage
        }
        NotificationManager.shared.cancelFocusPhaseAlerts(sessionId: session.id)
        reset()
    }

    /// Skip the current break and jump to the next focus interval.
    func skipBreak() {
        guard phase != .focus else { return }
        beginFocus()
    }

    /// Pause/resume the countdown (client-only, like the web). Resuming shifts
    /// the wall-clock phase window forward by the paused duration.
    func togglePause() {
        guard isActive else { return }
        if isPaused {
            if let pausedAt {
                let delta = Date().timeIntervalSince(pausedAt)
                phaseEndDate = phaseEndDate?.addingTimeInterval(delta)
                phaseStartDate = phaseStartDate?.addingTimeInterval(delta)
            }
            pausedAt = nil
            isPaused = false
            startTicker()
            // Window moved forward — reschedule against the new end.
            scheduleCurrentPhaseAlert()
        } else {
            pausedAt = Date()
            isPaused = true
            stopTicker()
            // No fixed end while paused — drop the pending alert. Cancel by exact
            // id (not the async prefix fetch) so a quick pause→resume can't have an
            // in-flight cancel clobber the alert resume re-schedules for this session.
            if let session {
                NotificationManager.shared.cancelFocusPhaseAlerts(sessionId: session.id, phases: Self.allPhaseKeys)
            }
        }
    }

    // MARK: - Ticking

    private func adopt(_ session: FocusSession) {
        self.session = session
        // A restored session resumes into a focus interval.
        beginFocus()
    }

    private func startTicker() {
        ticker?.cancel()
        tick()
        ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
            .sink { [weak self] _ in self?.tick() }
    }

    private func stopTicker() { ticker?.cancel(); ticker = nil }

    private func tick() {
        guard let end = phaseEndDate else { return }
        let secs = Int(end.timeIntervalSinceNow.rounded(.up))
        remaining = max(0, secs)
        if secs <= 0 { Task { await handlePhaseEnd() } }
    }

    private func handlePhaseEnd() async {
        switch phase {
        case .focus:
            await recordFocusInterval()
        case .shortBreak, .longBreak:
            beginFocus()
        }
    }

    private func recordFocusInterval() async {
        guard let session else { return }
        stopTicker()
        let nextIndex = session.completedIntervals + 1
        do {
            let updated = try await FocusService.recordInterval(sessionId: session.id, intervalIndex: nextIndex)
            self.session = updated
            if updated.completedIntervals >= updated.plannedCycles {
                await stop() // all planned cycles done — finalize
            } else {
                beginBreak(after: updated.completedIntervals)
            }
        } catch {
            self.error = error.userMessage
            beginBreak(after: session.completedIntervals + 1)
        }
    }

    private func beginFocus() {
        guard let preset else { return }
        phase = .focus
        setPhaseWindow(minutes: preset.focusMinutes)
    }

    private func beginBreak(after completedIntervals: Int) {
        guard let preset else { return }
        let isLong = preset.longBreakEvery > 0 && completedIntervals % preset.longBreakEvery == 0
        phase = isLong ? .longBreak : .shortBreak
        setPhaseWindow(minutes: isLong ? preset.longBreakMinutes : preset.breakMinutes)
    }

    private func setPhaseWindow(minutes: Int) {
        let now = Date()
        phaseStartDate = now
        phaseEndDate = now.addingTimeInterval(TimeInterval(minutes * 60))
        startTicker()
        scheduleCurrentPhaseAlert()
    }

    // MARK: - Phase-end alerts

    /// Every phase key an alert can be filed under. Used to clear the *other*
    /// phases' pending alerts when scheduling the current one.
    private static let allPhaseKeys = ["focus", "shortBreak", "longBreak"]

    /// Schedules the single pending local notification for the end of the current
    /// phase, so exactly one stays queued for the session. Stale alerts for the
    /// other phases are cleared by exact identifier (a synchronous, disjoint
    /// remove — never the id we're about to add); the new request then replaces
    /// any pending one filed under its own identifier.
    private func scheduleCurrentPhaseAlert() {
        guard let session, let end = phaseEndDate else { return }
        let content = phaseAlertContent()
        let staleKeys = Self.allPhaseKeys.filter { $0 != content.key }
        NotificationManager.shared.cancelFocusPhaseAlerts(sessionId: session.id, phases: staleKeys)
        NotificationManager.shared.scheduleFocusPhaseEnd(
            sessionId: session.id, phase: content.key, fireDate: end,
            title: content.title, body: content.body)
    }

    /// Copy for the alert that fires when the *current* phase ends — it names what
    /// is finishing and points gently at what's next (no guilt, no pressure).
    private func phaseAlertContent() -> (title: String, body: String, key: String) {
        switch phase {
        case .focus:
            return ("Focus complete", "Focus interval done. Take a breath.", "focus")
        case .shortBreak:
            return ("Break's over", "Ready for the next round?", "shortBreak")
        case .longBreak:
            return ("Break's over", "Ready for the next round?", "longBreak")
        }
    }

    private func elapsedInPhase() -> Int {
        guard let start = phaseStartDate else { return 0 }
        // While paused the clock is frozen at pausedAt, so count only up to then.
        let reference = pausedAt ?? Date()
        return max(0, Int(reference.timeIntervalSince(start)))
    }

    private func reset() {
        session = nil
        phaseEndDate = nil
        phaseStartDate = nil
        pausedAt = nil
        isPaused = false
        remaining = 0
        phase = .focus
    }

    // MARK: - Display helpers

    var phaseLabel: String {
        switch phase {
        case .focus: return "Focus"
        case .shortBreak: return "Short break"
        case .longBreak: return "Long break"
        }
    }

    var timeString: String {
        String(format: "%02d:%02d", remaining / 60, remaining % 60)
    }

    var progress: Double {
        guard let preset else { return 0 }
        let total: Int
        switch phase {
        case .focus: total = preset.focusMinutes * 60
        case .shortBreak: total = preset.breakMinutes * 60
        case .longBreak: total = preset.longBreakMinutes * 60
        }
        guard total > 0 else { return 0 }
        return 1 - Double(remaining) / Double(total)
    }
}
