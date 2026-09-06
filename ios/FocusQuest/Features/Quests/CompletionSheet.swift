import SwiftUI
import UIKit

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

            // The Campaign — Phase 1: the d20 skill check.
            if let check = result.skillCheck {
                DiceRollView(check: check)
                if let narration = result.skillCheckNarration {
                    Text(narration).font(.outfitCaption).italic().foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }

            // The Campaign — Phase 2: the blow on your personal encounter.
            if let hit = result.encounterHit {
                if hit.felled {
                    Label("\(hit.name) felled! +\(hit.coins) coins", systemImage: "burst.fill")
                        .font(.outfitSubheadline).foregroundStyle(Theme.gold)
                        .labelStyle(TealIconLabelStyle())
                } else {
                    Label("Struck \(hit.name) for \(hit.damage) · \(hit.encounter.phaseLabel)", systemImage: "shield.lefthalf.filled")
                        .font(.outfitSubheadline).foregroundStyle(Theme.accent)
                        .labelStyle(TealIconLabelStyle())
                }
            }

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
        // Celebrate once as the sheet appears — richer buzz on a level-up or crit.
        .onAppear {
            (result.leveledUp || result.skillCheck?.isCrit == true) ? Haptics.levelUp() : Haptics.success()
        }
    }
}

/// The Campaign — Phase 1: an animated d20 that flickers through faces and
/// settles on the rolled value, colored by outcome band (gold crit, teal
/// success, muted glancing — never red). Honors Reduce Motion.
private struct DiceRollView: View {
    let check: SkillCheck
    @State private var shown = 1
    @State private var settled = false

    private var bandColor: Color {
        switch check.band {
        case "crit": return Theme.gold
        case "glancing": return .secondary
        default: return Theme.accent
        }
    }

    var body: some View {
        VStack(spacing: Theme.Space.sm) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(bandColor.opacity(0.15))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(bandColor, lineWidth: 2))
                    .frame(width: 76, height: 76)
                Text("\(shown)")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(bandColor)
            }
            .scaleEffect(settled ? 1 : 0.7)
            Text("\(check.abilityName) check\(check.isCrit ? " — Critical!" : "")")
                .font(.outfitSubheadlineBold).foregroundStyle(bandColor)
            Text(check.mathText).font(.outfitCaption).foregroundStyle(.secondary)
        }
        .onAppear(perform: roll)
    }

    private func roll() {
        guard !UIAccessibility.isReduceMotionEnabled else {
            shown = check.d20; settled = true; return
        }
        var ticks = 0
        Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { timer in
            ticks += 1
            if ticks >= 12 {
                timer.invalidate()
                shown = check.d20
                withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) { settled = true }
            } else {
                shown = Int.random(in: 1...20)
            }
        }
    }
}
