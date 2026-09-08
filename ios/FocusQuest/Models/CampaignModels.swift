import Foundation
import SwiftUI

// The Campaign — D&D layer. Mirrors the server's additive schemas
// (CharacterSheet / SkillCheck / EncounterView / EncounterHit). All optional at
// the completion-result call site so the app still decodes if the server hasn't
// deployed these yet.

/// Sub-step fill toward the next ability point. The integer score only steps at
/// a band boundary, so this shows how far the current life area has carried the
/// score toward its next point — the felt "that quest nudged my Might" loop.
/// Optional at the call site so the app decodes against a pre-progress server.
struct AbilityProgress: Codable {
    /// Fill toward the next point, 0..1. 1 once the ability is maxed.
    let fraction: Double
    /// Signal units still needed for the next point; 0 when maxed.
    let toNext: Int
    /// The score the next step reaches, or nil when already at the max.
    let nextScore: Int?
    /// True at the top of the ladder — no further point to climb toward.
    let atMax: Bool

    /// Clamped 0…1 fill for the bar.
    var clampedFraction: Double { min(1, max(0, fraction)) }
}

struct AbilityScore: Codable, Identifiable {
    /// Ability id: might, intellect, attunement, presence, vigor, finesse.
    let id: String
    let name: String
    let abbreviation: String
    let score: Int
    let modifier: Int
    /// Source kingdom on the Life Kingdoms map, or nil for Finesse.
    let kingdomId: String?
    /// Fill toward the next ability point (Act I). Optional — decodes against a
    /// server that hasn't deployed it yet.
    let progress: AbilityProgress?

    /// Signed modifier for display: +3, +0, -1.
    var modifierText: String { modifier >= 0 ? "+\(modifier)" : "\(modifier)" }
}

struct CharacterSheet: Codable {
    let abilities: [AbilityScore]
    let proficiencyBonus: Int
    let heroClass: String
    let level: Int
    let battlePower: Int

    var proficiencyText: String { proficiencyBonus >= 0 ? "+\(proficiencyBonus)" : "\(proficiencyBonus)" }
}

/// A resolved d20 skill check returned on quest completion.
struct SkillCheck: Codable {
    let d20: Int
    let modifier: Int
    let proficiency: Int
    let total: Int
    let dc: Int
    /// crit | success | partial | fail. Every band completes the quest in full;
    /// "fail" is never a penalty — it offers a gentler next step (see offerRescue).
    let band: String
    /// Ability rolled (might, intellect, …).
    let ability: String

    var isCrit: Bool { band == "crit" }
    /// The lowest band offers the supportive rescue pathway; never a loss.
    var offerRescue: Bool { band == "fail" }
    var abilityName: String { ability.prefix(1).uppercased() + ability.dropFirst() }
    var mathText: String {
        let sign = { (n: Int) in n >= 0 ? "+\(n)" : "\(n)" }
        // Act IV: a flat consumable bonus (e.g. Focus Draught +3) lands in `total`
        // but not in modifier/proficiency; surface the residual so the sum reads
        // correctly. Advantage/reroll alter `d20` itself, so they leave no residual.
        let bonus = total - d20 - modifier - proficiency
        let bonusText = bonus != 0 ? " \(sign(bonus))" : ""
        return "d20 \(d20) \(sign(modifier)) \(sign(proficiency))\(bonusText) = \(total) vs DC \(dc)"
    }
}

/// A boss/encounter's health, reframed from hp + damage.
struct EncounterView: Codable {
    let hp: Int
    let totalDamage: Int
    let hpRemaining: Int
    let percentRemaining: Double
    /// fresh | bloodied | wounded | resting.
    let phase: String
    /// active | resting.
    let status: String
    let felled: Bool

    var phaseLabel: String {
        switch phase {
        case "fresh": return "Standing strong"
        case "bloodied": return "Bloodied"
        case "wounded": return "Barely standing"
        case "resting": return "At rest"
        default: return ""
        }
    }
}

extension EncounterView {
    /// The remaining-HP bar warms as the foe weakens, so a shrinking bar reads as
    /// the player's progress rather than the foe's health per se.
    var hpBarColor: Color {
        switch phase {
        case "wounded": return Theme.danger
        case "bloodied": return Theme.gold
        default: return Theme.accent // fresh / resting
        }
    }
}

/// The blow a quest completion landed on the player's personal encounter.
struct EncounterHit: Codable {
    let name: String
    let tier: Int
    let damage: Int
    let felled: Bool
    /// Upside-only loot coins granted on felling (0 otherwise).
    let coins: Int
    /// The Campaign — second wave: the treasure reveal on a fell (gear and/or
    /// bonus coins). Optional so the app decodes before the loot server deploys.
    let loot: LootDrop?
    /// Act III (Living World): why the foe stands against you, and — on a fell —
    /// the celebratory defeat beat + how the realm shifts. Optional so the app
    /// decodes against a pre-deploy server. Anti-shame: only ever a win.
    let motive: String?
    let defeatBeat: String?
    let worldNote: String?
    let encounter: EncounterView
}

/// A treasure drop on an encounter fell — a gear item, or a coins-only "small
/// find" (rarity/gear nil). Mirrors the server's LootDrop; reuses GearRewardInfo.
struct LootDrop: Codable {
    let rarity: String?
    let gear: GearRewardInfo?
    let bonusCoins: Int
}

/// The player's current personal encounter (GET /encounter/current).
struct PersonalEncounterStatus: Codable {
    let name: String
    let tier: Int
    /// Act III: why the foe stands against you — shown while it lives. Optional
    /// so the app decodes against a pre-deploy server.
    let motive: String?
    let encounter: EncounterView
}

// The Campaign — Phase 3: the Dungeon Master's narrated beat for today.

/// Which beat to fetch. "morning" is the quest board; "camp" is the evening
/// make-camp. Chosen client-side from the local hour.
enum DmBeatKind: String {
    case morning, camp
}

/// A single grounded beat in the DM's voice (GET /dm/beat?kind=…). `source`
/// distinguishes the model's prose from the templated fallback; the app renders
/// them identically — the DM never fabricates in either path.
struct DmBeat: Codable {
    let kind: String
    let narrative: String
    let source: String
}

/// The envelope: `beat` is null when the day has nothing real to narrate, so
/// the card simply doesn't appear.
struct DmBeatResponse: Codable {
    let beat: DmBeat?
}

// Act III (Living World) — naming the companion + setting its disposition.

/// The three companion tones. `warm` is the default (the original voice).
enum CompanionDisposition: String, CaseIterable, Identifiable {
    case warm, wry, stoic
    var id: String { rawValue }
    var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
    var hint: String {
        switch self {
        case .warm: return "Encouraging and kind"
        case .wry: return "Dry and teasing"
        case .stoic: return "Calm and grounded"
        }
    }
}

/// PATCH body. `name` is omitted when nil (leave unchanged); disposition always sent.
struct CompanionUpdate: Encodable {
    let name: String?
    let disposition: String
    enum CodingKeys: String, CodingKey { case name, disposition }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(disposition, forKey: .disposition)
        if let name { try c.encode(name, forKey: .name) }
    }
}

struct CompanionIdentity: Codable {
    let name: String?
    let disposition: String
}
