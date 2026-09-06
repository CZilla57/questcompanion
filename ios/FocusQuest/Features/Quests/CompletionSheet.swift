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
            Image(systemName: result.leveledUp ? "sparkles" : "star.fill")
                .font(.system(size: 68)).foregroundStyle(Theme.accent)
            Text(result.leveledUp ? "Level \(result.newLevel)!" : "Quest complete!")
                .font(.outfitLargeTitleBold)
            Text("+\(result.pointsAwarded) XP")
                .font(.outfitTitle2Bold)
                .foregroundStyle(Theme.accent)

            if result.xpMultiplier > 1 {
                Label("\(String(format: "%.2f", result.xpMultiplier))× streak bonus", systemImage: "flame.fill")
                    .font(.outfitSubheadline).foregroundStyle(Theme.gold)
                    .labelStyle(TealIconLabelStyle(spacing: 3))
            }
            if let reaction = result.companionReaction {
                Text("“\(reaction)”").font(.outfitCallout).italic().foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if !result.newBadges.isEmpty {
                VStack(spacing: Theme.Space.sm) {
                    Text("New badges").font(.outfitHeadline)
                    ForEach(result.newBadges) { badge in
                        Label(badge.name, systemImage: "rosette").foregroundStyle(Theme.gold)
                    }
                }
            }
            if let surprise = result.surpriseReward {
                Label(surprise.type == "gear"
                      ? "Surprise gear: \(surprise.gear?.name ?? "?")"
                      : "Surprise +\(surprise.xpAmount ?? 0) XP",
                      systemImage: "gift.fill")
                    .font(.outfitSubheadline).foregroundStyle(Theme.success)
                    .labelStyle(TealIconLabelStyle())
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
