import SwiftUI

extension FocusSessionResult: Identifiable { var id: Int { session.id } }

struct FocusView: View {
    @StateObject private var model = FocusViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            AsyncContentView(state: model.setup, retry: { Task { await model.load() } }) { _ in
                Group {
                    if model.isActive { activeSession } else { setup }
                }
                .padding(Theme.Space.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Theme.screenBackground)
            }
            .navigationTitle("Focus")
            .alert("Focus", isPresented: .constant(model.error != nil)) {
                Button("OK") { model.error = nil }
            } message: { Text(model.error ?? "") }
            .sheet(item: $model.lastResult) { result in
                FocusResultSheet(result: result)
            }
            .task { if model.setup.value == nil { await model.load() } }
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .active:     Task { await model.onForeground() }
                case .background: model.onBackground()
                default:          break
                }
            }
        }
    }

    // MARK: - Idle setup

    private var setup: some View {
        VStack(spacing: Theme.Space.lg) {
            Image(systemName: "target").font(.system(size: 52)).foregroundStyle(Theme.accent)
            Text("Start a focus session").font(.outfitTitle3Bold)
            Text("Pick a rhythm and, optionally, the quest you're working on.")
                .font(.outfitSubheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)

            VStack(spacing: Theme.Space.md) {
                ForEach(model.presets) { preset in
                    PresetCard(preset: preset, selected: model.selectedPreset == preset.key) {
                        model.selectedPreset = preset.key
                    }
                }
            }

            if !model.quests.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Theme.Space.sm) {
                        Text("Focus on a quest (optional)").font(.outfitSubheadlineBold)
                        Picker("Quest", selection: $model.selectedTaskId) {
                            Text("None").tag(Int?.none)
                            ForEach(model.quests) { quest in
                                Text(quest.title).tag(Int?.some(quest.id))
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
            }

            PrimaryButton(title: "Start focus", systemImage: "play.fill", isLoading: model.isBusy) {
                Task { await model.start() }
            }
        }
    }

    // MARK: - Active

    private var activeSession: some View {
        VStack(spacing: Theme.Space.xl) {
            Spacer()
            Text(model.phaseLabel.uppercased())
                .font(.outfitSubheadlineBold)
                .foregroundStyle(model.phase == .focus ? Theme.accent : Theme.success)
                .tracking(2)

            ZStack {
                Circle().stroke(Theme.accent.opacity(0.15), lineWidth: 14)
                Circle()
                    .trim(from: 0, to: model.progress)
                    .stroke(model.phase == .focus ? Theme.accent : Theme.success,
                            style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 1), value: model.progress)
                Text(model.timeString).font(.system(size: 56, weight: .bold, design: .rounded)).monospacedDigit()
            }
            .frame(width: 260, height: 260)

            if let session = model.session, let preset = model.preset {
                // Cycle progress dots (web parity): filled = completed intervals.
                HStack(spacing: Theme.Space.sm) {
                    ForEach(0..<preset.plannedCycles, id: \.self) { i in
                        Circle()
                            .fill(i < session.completedIntervals ? Theme.accent : Color.white.opacity(0.15))
                            .frame(width: 10, height: 10)
                    }
                }
            }

            if model.isPaused {
                Text("Paused").font(.outfitCaption).foregroundStyle(.secondary)
            }

            Spacer()

            VStack(spacing: Theme.Space.md) {
                if model.phase != .focus {
                    Button("Skip break") { model.skipBreak() }.buttonStyle(.bordered)
                }
                HStack(spacing: Theme.Space.md) {
                    Button {
                        model.togglePause()
                    } label: {
                        Label(model.isPaused ? "Resume" : "Pause",
                              systemImage: model.isPaused ? "play.fill" : "pause.fill")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .tint(Theme.accent)

                    PrimaryButton(title: "End", systemImage: "stop.fill", tint: Theme.danger, isLoading: model.isBusy) {
                        Task { await model.stop() }
                    }
                }
            }
        }
    }
}

private struct PresetCard: View {
    let preset: FocusPreset
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(preset.label).font(.outfitHeadline)
                    Text("\(preset.focusMinutes)m focus · \(preset.breakMinutes)m break · \(preset.plannedCycles) cycles")
                        .font(.outfitCaption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? Theme.accent : .secondary)
            }
            .padding(Theme.Space.lg)
            .background(selected ? Theme.accentSoft : Theme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct FocusResultSheet: View {
    let result: FocusSessionResult
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: Theme.Space.lg) {
            Spacer()
            Image(systemName: "star.fill").font(.system(size: 60)).foregroundStyle(Theme.accent)
            Text("Session complete").font(.outfitTitle2Bold)
            Text("+\(result.xpDelta) XP").font(.outfitTitle3Bold).foregroundStyle(Theme.accent)
            Text("\(result.session.completedIntervals) focus interval\(result.session.completedIntervals == 1 ? "" : "s") · \(result.session.focusedSeconds / 60) min")
                .font(.outfitSubheadline).foregroundStyle(.secondary)
            Spacer()
            PrimaryButton(title: "Done") { dismiss() }.padding(.horizontal, Theme.Space.xl).padding(.bottom, Theme.Space.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .multilineTextAlignment(.center)
        .background(Theme.screenBackground)
        .presentationDetents([.medium])
    }
}
