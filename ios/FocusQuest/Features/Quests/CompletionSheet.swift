import SwiftUI

extension TaskCompletionResult: Identifiable { var id: Int { task.id } }

/// Celebration shown after completing a quest — XP, level-up, and any badges or
/// surprise rewards the server awarded.
struct CompletionSheet: View {
    let result: TaskCompletionResult
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: Theme.Space.lg) {
            Spacer()
            Text(result.leveledUp ? "🎉" : "⭐️").font(.system(size: 72))
            Text(result.leveledUp ? "Level \(result.newLevel)!" : "Quest complete!")
                .font(.largeTitle.bold())
            Text("+\(result.pointsAwarded) XP")
                .font(.title2.bold())
                .foregroundStyle(Theme.accent)

            if result.xpMultiplier > 1 {
                Text("🔥 \(String(format: "%.2f", result.xpMultiplier))× streak bonus")
                    .font(.subheadline).foregroundStyle(Theme.gold)
            }
            if let reaction = result.companionReaction {
                Text("“\(reaction)”").font(.callout).italic().foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if !result.newBadges.isEmpty {
                VStack(spacing: Theme.Space.sm) {
                    Text("New badges").font(.headline)
                    ForEach(result.newBadges) { badge in
                        Label(badge.name, systemImage: "rosette").foregroundStyle(Theme.gold)
                    }
                }
            }
            if let surprise = result.surpriseReward {
                Text(surprise.type == "gear"
                     ? "🎁 Surprise gear: \(surprise.gear?.name ?? "?")"
                     : "🎁 Surprise +\(surprise.xpAmount ?? 0) XP")
                    .font(.subheadline).foregroundStyle(Theme.success)
            }
            Spacer()
            PrimaryButton(title: "Onward", systemImage: "arrow.right") { dismiss() }
                .padding(.horizontal, Theme.Space.xl)
                .padding(.bottom, Theme.Space.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .multilineTextAlignment(.center)
        .background(Theme.screenBackground)
        .presentationDetents([.medium, .large])
    }
}
