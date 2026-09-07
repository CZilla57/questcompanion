import Foundation

// The Campaign — second wave (Class Feats): the hero's class-specific abilities,
// unlocked by level. Mirrors the server's FeatView / FeatsResponse /
// FeatActivateResult (see api-server lib/class-feats.ts). All the active-only
// fields are optional so a passive feat — or an older server — decodes cleanly.

struct Feat: Codable, Identifiable {
    let id: String
    let heroClass: String
    /// "passive" (always-on bias) or "active" (once-a-day ability).
    let kind: String
    let unlockLevel: Int
    let label: String
    let emoji: String
    let description: String
    /// Active feats: the Stat Perk window activating grants.
    let grants: String?
    /// Passive feats: the home kingdom whose categories get the XP bias.
    let passiveKingdom: String?
    /// Active feats: false once used on the current local day.
    let readyToday: Bool?
    /// Active boost feats: whether the granted window is currently live.
    let active: Bool?
    let expiresAt: String?
    /// Mend (streak shield): whether the shield stock is already at the cap.
    let atMax: Bool?

    var isActive: Bool { kind == "active" }
    /// An active feat can be used right now: ready today and not already maxed.
    var isUsable: Bool { isActive && readyToday == true && atMax != true }
}

/// GET /users/me/feats — empty on both lists until the campaign layer unlocks.
struct FeatsResponse: Codable {
    let unlocked: [Feat]
    let locked: [Feat]
}

/// POST /users/me/feats/:id/activate — `activated` is false with a gentle reason
/// (locked / on_cooldown / at_max); never an error.
struct FeatActivateResult: Codable {
    let activated: Bool
    let reason: String
    let expiresAt: String?
    let owned: Int?
}

struct FeatActivateInput: Encodable {
    let tz: String
}
