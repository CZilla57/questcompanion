import WidgetKit
import SwiftUI

/// Entry point for the FocusQuest widget extension. For now it hosts a single
/// placeholder widget so the extension target compiles and embeds; the Live
/// Activity (Dynamic Island + lock-screen countdown) is added next.
@main
struct FocusQuestWidgetBundle: WidgetBundle {
    var body: some Widget {
        FocusQuestPlaceholderWidget()
        FocusActivityLiveActivity()
    }
}

/// Minimal Home Screen widget placeholder. Real widgets land in Phase 4.
struct FocusQuestPlaceholderWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FocusQuestPlaceholder", provider: PlaceholderProvider()) { _ in
            Text("FocusQuest")
                .font(.headline)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("FocusQuest")
        .description("Placeholder widget.")
        .supportedFamilies([.systemSmall])
    }
}

private struct PlaceholderEntry: TimelineEntry {
    let date: Date
}

private struct PlaceholderProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlaceholderEntry { PlaceholderEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (PlaceholderEntry) -> Void) {
        completion(PlaceholderEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlaceholderEntry>) -> Void) {
        completion(Timeline(entries: [PlaceholderEntry(date: .now)], policy: .never))
    }
}
