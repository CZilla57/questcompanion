import Foundation

// The Campaign — D&D layer. Mirrors the server's additive schemas
// (CharacterSheet / SkillCheck / EncounterView / EncounterHit). All optional at
// the completion-result call site so the app still decodes if the server hasn't
// deployed these yet.

struct AbilityScore: Codable, Identifiable {
    /// Ability id: might, intellect, attunement, presence, vigor, finesse.
    let id: String
    let name: String
    let abbreviation: String
    let score: Int
    let modifier: Int
    /// Source kingdom on the Life Kingdoms map, or nil for Finesse.
    let kingdomId: String?

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
    /// crit | success | glancing — never a failure band.
    let band: String
    /// Ability rolled (might, intellect, …).
    let ability: String

    var isCrit: Bool { band == "crit" }
    var abilityName: String { ability.prefix(1).uppercased() + ability.dropFirst() }
    var mathText: String {
        let sign = { (n: Int) in n >= 0 ? "+\(n)" : "\(n)" }
        return "d20 \(d20) \(sign(modifier)) \(sign(proficiency)) = \(total) vs DC \(dc)"
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

/// The blow a quest completion landed on the player's personal encounter.
struct EncounterHit: Codable {
    let name: String
    let tier: Int
    let damage: Int
    let felled: Bool
    /// Upside-only loot coins granted on felling (0 otherwise).
    let coins: Int
    let encounter: EncounterView
}

/// The player's current personal encounter (GET /encounter/current).
struct PersonalEncounterStatus: Codable {
    let name: String
    let tier: Int
    let encounter: EncounterView
}
