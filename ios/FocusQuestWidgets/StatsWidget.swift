import WidgetKit
import SwiftUI

/// At-a-glance stats: level, streak, today's progress (+coins when known).
/// Home small tile and a compact rectangular Lock-Screen accessory. Reads the
/// shared v2 snapshot via `FocusProvider`.
struct StatsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FocusQuestStats", provider: FocusProvider()) { entry in
            StatsView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Stats")
        .description("Level, streak, and today's progress.")
        .supportedFamilies([.systemSmall, .accessoryRectangular])
    }
}

private let statsAccent = Color.cyan

struct StatsView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot

    private var progress: Double {
        guard snapshot.todayTotal > 0 else { return 0 }
        return min(1, Double(snapshot.todayCompleted) / Double(snapshot.todayTotal))
    }

    var body: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label("\(snapshot.streakDays)-day streak", systemImage: "flame.fill")
                    .font(.headline)
                Text("Lvl \(snapshot.level) · \(snapshot.levelName)")
                    .font(.caption).lineLimit(1)
            }
            .widgetAccentable()
        default: // systemSmall
            small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text("LVL \(snapshot.level)").font(.caption.bold()).foregroundStyle(statsAccent)
                Text(snapshot.levelName).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            Label("\(snapshot.streakDays)-day streak", systemImage: "flame.fill")
                .font(.caption2.bold()).foregroundStyle(.primary).lineLimit(1)
            Spacer(minLength: 4)
            HStack(spacing: 10) {
                Gauge(value: progress) {
                    EmptyView()
                } currentValueLabel: {
                    Text("\(snapshot.todayCompleted)")
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(statsAccent)
                .scaleEffect(0.9)
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(snapshot.todayCompleted)/\(snapshot.todayTotal)")
                        .font(.caption.bold())
                    Text("today").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let coins = snapshot.coins {
                Label("\(coins)", systemImage: "circle.hexagongrid.fill")
                    .font(.caption2.bold()).foregroundStyle(.yellow).lineLimit(1)
            }
        }
    }
}
