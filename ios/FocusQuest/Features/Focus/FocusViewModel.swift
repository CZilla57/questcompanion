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
    @Published var lastResult: FocusSessionResult?
    @Published var error: String?

    private var phaseEndDate: Date?
    private var phaseStartDate: Date?
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
        reset()
    }

    /// Skip the current break and jump to the next focus interval.
    func skipBreak() {
        guard phase != .focus else { return }
        beginFocus()
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
    }

    private func elapsedInPhase() -> Int {
        guard let start = phaseStartDate else { return 0 }
        return max(0, Int(Date().timeIntervalSince(start)))
    }

    private func reset() {
        session = nil
        phaseEndDate = nil
        phaseStartDate = nil
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
