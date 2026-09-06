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
    /// True while `reconcile()` walks past-due phases. The catch-up advances phases
    /// through `setPhaseWindow`, which restarts the ticker on windows whose end is
    /// already in the past; without this guard that `tick()` would enqueue a second,
    /// concurrent `handlePhaseEnd()` and risk double-crediting an interval.
    private var isReconciling = false

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
        // While reconciling, the loop owns phase advancement — don't let a past-due
        // tick spawn a second, concurrent handlePhaseEnd.
        if secs <= 0 && !isReconciling { Task { await handlePhaseEnd() } }
    }

    private func handlePhaseEnd() async {
        switch phase {
        case .focus:
            await recordFocusInterval()
        case .shortBreak, .longBreak:
            beginFocus()
        }
    }

    private func recordFocusInterval(boundary: Date = Date()) async {
        guard let session else { return }
        stopTicker()
        let nextIndex = session.completedIntervals + 1
        do {
            let updated = try await FocusService.recordInterval(sessionId: session.id, intervalIndex: nextIndex)
            self.session = updated
            if updated.completedIntervals >= updated.plannedCycles {
                await stop() // all planned cycles done — finalize
            } else {
                beginBreak(after: updated.completedIntervals, from: boundary)
            }
        } catch {
            self.error = error.userMessage
            beginBreak(after: session.completedIntervals + 1, from: boundary)
        }
    }

    private func beginFocus(from: Date = Date()) {
        guard let preset else { return }
        phase = .focus
        setPhaseWindow(minutes: preset.focusMinutes, from: from)
    }

    private func beginBreak(after completedIntervals: Int, from: Date = Date()) {
        guard let preset else { return }
        let isLong = preset.longBreakEvery > 0 && completedIntervals % preset.longBreakEvery == 0
        phase = isLong ? .longBreak : .shortBreak
        setPhaseWindow(minutes: isLong ? preset.longBreakMinutes : preset.breakMinutes, from: from)
    }

    private func setPhaseWindow(minutes: Int, from: Date = Date()) {
        phaseStartDate = from
        phaseEndDate = from.addingTimeInterval(TimeInterval(minutes * 60))
        startTicker()
        scheduleCurrentPhaseAlert()
    }

    // MARK: - Reconcile (foreground catch-up)

    /// Catch up any focus/break phases that elapsed while the app was suspended
    /// (the ticker is paused in the background). Credits each completed focus
    /// interval server-side and advances phase windows from their true historical
    /// boundaries — not `now` — so elapsed breaks don't restart. No-op while paused.
    func reconcile() async {
        guard !isPaused, !isReconciling else { return }
        isReconciling = true
        defer { isReconciling = false }
        while let end = phaseEndDate, session != nil, Date() >= end {
            let boundary = end
            switch phase {
            case .focus:
                // Credits the interval that ended at `boundary`; either finalizes the
                // session (session becomes nil) or opens the break window from `boundary`.
                await recordFocusInterval(boundary: boundary)
            case .shortBreak, .longBreak:
                beginFocus(from: boundary)
            }
            // Safety: every branch must push phaseEndDate strictly past `boundary`
            // (or finalize). If it didn't, stop rather than spin.
            if let newEnd = phaseEndDate, newEnd <= boundary { break }
        }
    }

    // MARK: - Foreground / background lifecycle

    /// Call when the app returns to the foreground: catch up elapsed phases, then
    /// resume ticking the current (future) phase. Safe when idle or paused.
    func onForeground() async {
        guard isActive else { return }
        await reconcile()
        if isActive && !isPaused { startTicker() }
    }

    /// Call when the app is backgrounded: the ticker can't fire while suspended.
    func onBackground() { stopTicker() }

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
