import SwiftUI
import UIKit

extension TaskCompletionResult: Identifiable { var id: Int { task.id } }

/// Celebration shown after completing a quest — XP, level-up, and any badges or
/// surprise rewards the server awarded.
struct CompletionSheet: View {
    let result: TaskCompletionResult
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        // A roll can stack many reward rows (well-rested + encounter + party
        // hits + streak + companion + surprise). Scroll the celebration so tall
        // results wrap in full instead of being squeezed to truncated lines;
        // keep "Onward" pinned below the scroll so it's always reachable.
        VStack(spacing: 0) {
        ScrollView {
        VStack(spacing: Theme.Space.lg) {
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
                // Act IV: the consumable that rode this roll (boost already in the check).
                if let used = result.consumableUsed {
                    Text("\(used.emoji) \(used.name) spent")
                        .font(.outfitCaption).foregroundStyle(Theme.accent)
                }
                // Act IV Well-Rested: the earned rested bonus that rode this roll.
                if result.wellRested == true {
                    Text("🛌 Well-Rested bonus")
                        .font(.outfitCaption).foregroundStyle(Theme.accent)
                }
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
                    // Act III: the named foe's defeat beat + how the realm shifts.
                    if let beat = hit.defeatBeat, !beat.isEmpty {
                        Text([beat, hit.worldNote].compactMap { $0 }.joined(separator: " "))
                            .font(.outfitCaption).italic().foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    // The Campaign — second wave: the treasure reveal.
                    if let loot = hit.loot { lootReveal(loot) }
                } else {
                    Label("Struck \(hit.name) for \(hit.damage) · \(hit.encounter.phaseLabel)", systemImage: "shield.lefthalf.filled")
                        .font(.outfitSubheadline).foregroundStyle(Theme.accent)
                        .labelStyle(TealIconLabelStyle())
                }
            }

            // Act III party parity: the same blow lands on each shared party foe.
            // Co-op teamwork — a fell celebrates the foe's defeat beat + world note.
            ForEach(result.partyHits ?? []) { hit in
                if hit.felled {
                    Label("\(hit.foeName) felled together! +\(hit.coins) coins", systemImage: "person.2.fill")
                        .font(.outfitSubheadline).foregroundStyle(Theme.gold)
                        .labelStyle(TealIconLabelStyle())
                    if let beat = hit.defeatBeat, !beat.isEmpty {
                        Text([beat, hit.worldNote].compactMap { $0 }.joined(separator: " "))
                            .font(.outfitCaption).italic().foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    if let loot = hit.loot { lootReveal(loot) }
                } else {
                    Label("Struck \(hit.foeName) for \(hit.damage) with your ally · \(hit.encounter.phaseLabel)", systemImage: "person.2")
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
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
        .padding(.horizontal, Theme.Space.lg)
        .padding(.vertical, Theme.Space.xl)
        }
            PrimaryButton(title: "Onward", systemImage: "arrow.right") { dismiss() }
                .padding(.horizontal, Theme.Space.xl)
                .padding(.top, Theme.Space.sm)
                .padding(.bottom, Theme.Space.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.screenBackground)
        // Open full-height so the whole celebration reads at once; the inner
        // ScrollView still handles a roll with an unusually long stack of rows.
        .presentationDetents([.large])
        // Celebrate once as the sheet appears — richer buzz on a level-up or crit.
        .onAppear {
            (result.leveledUp || result.skillCheck?.isCrit == true) ? Haptics.levelUp() : Haptics.success()
        }
    }

    /// The Campaign — second wave: the treasure reveal on a fell. Rarity-colored
    /// gear, or a small coins-only find — always a gift, never a letdown.
    @ViewBuilder private func lootReveal(_ loot: LootDrop) -> some View {
        if let gear = loot.gear {
            Label("Treasure — \(gear.name) · \(gear.rarity.capitalized) · +\(gear.statPower) power",
                  systemImage: "gift.fill")
                .font(.outfitSubheadline).foregroundStyle(rarityColor(gear.rarity))
                .labelStyle(TealIconLabelStyle())
        } else if loot.bonusCoins > 0 {
            Label("A small find · +\(loot.bonusCoins) coins", systemImage: "gift.fill")
                .font(.outfitSubheadline).foregroundStyle(Theme.gold)
                .labelStyle(TealIconLabelStyle())
        }
    }

    private func rarityColor(_ rarity: String) -> Color {
        switch rarity {
        case "legendary": return Theme.gold
        case "epic": return .purple
        case "rare": return Theme.accent
        default: return .gray
        }
    }
}

/// The Campaign — Phase 1 / Act II: an animated d20 that flickers through faces
/// and settles on the rolled value, colored by outcome band (gold crit, teal
/// success, muted partial/fail — never red; a fail is a full completion that
/// offers a gentler next step, not a loss). Honors Reduce Motion.
private struct DiceRollView: View {
    let check: SkillCheck
    @State private var shown = 1
    @State private var settled = false

    private var bandColor: Color {
        switch check.band {
        case "crit": return Theme.gold
        case "partial", "fail": return .secondary
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
        // Read the settled result, never the flickering faces.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(check.abilityName) check\(check.isCrit ? ", critical" : ""). \(check.mathText), \(check.band).")
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
