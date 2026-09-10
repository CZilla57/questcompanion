import ActivityKit
import WidgetKit
import SwiftUI

/// The Focus session Live Activity: a lock-screen banner plus Dynamic Island
/// presentations. The countdown uses `Text(timerInterval:)`, which updates itself
/// on-device with no pushes — so the lock-screen timer stays correct on its own.
struct FocusActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusLockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.cyan)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.phase.label, systemImage: phaseIcon(context))
                        .font(.caption)
                        .foregroundStyle(.cyan)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    countdown(context)
                        .font(.title3.monospacedDigit())
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let title = context.attributes.questTitle {
                        Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            } compactLeading: {
                Image(systemName: phaseIcon(context)).foregroundStyle(.cyan)
            } compactTrailing: {
                countdown(context).monospacedDigit()
            } minimal: {
                Image(systemName: phaseIcon(context)).foregroundStyle(.cyan)
            }
            .keylineTint(.cyan)
            .widgetURL(URL(string: "focusquest://focus"))
        }
    }

    private func phaseIcon(_ context: ActivityViewContext<FocusActivityAttributes>) -> String {
        context.state.phase == .focus ? "timer" : "cup.and.saucer"
    }

    @ViewBuilder
    private func countdown(_ context: ActivityViewContext<FocusActivityAttributes>) -> some View {
        if context.state.isPaused {
            Text("Paused")
        } else {
            Text(timerInterval: Date()...context.state.phaseEndDate, countsDown: true)
                .multilineTextAlignment(.trailing)
        }
    }
}

/// Lock-screen / banner presentation for the Focus Live Activity.
struct FocusLockScreenView: View {
    let context: ActivityViewContext<FocusActivityAttributes>

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(context.state.phase.label.uppercased())
                    .font(.caption2.bold())
                    .foregroundStyle(.cyan)
                Text(context.attributes.questTitle ?? context.attributes.presetLabel)
                    .font(.subheadline.bold())
                    .lineLimit(1)
            }
            Spacer(minLength: 12)
            if context.state.isPaused {
                Text("Paused")
                    .font(.title2.bold())
            } else {
                Text(timerInterval: Date()...context.state.phaseEndDate, countsDown: true)
                    .font(.title.bold().monospacedDigit())
                    .frame(maxWidth: 120)
            }
        }
        .padding()
    }
}
