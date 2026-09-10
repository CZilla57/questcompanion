import SwiftUI

/// Renders a Life Kingdom as its pixel-art scene image — the same per-tier art the
/// web app shows (`/kingdoms/scenes/<id>/tier-<n>.png`, bundled here as
/// `kscene-<id>-<n>.png`). Higher tiers reveal more buildings; a night wash keyed
/// off `liveliness` dims quieter kingdoms. The grammar is "asleep", never
/// "ruined" — a dormant place is only dimmed, its art is never swapped for rubble.
struct KingdomSceneImage: View {
    let kingdomId: String
    let tier: Int
    /// `nil` = no reading (the capital measures a lifetime total, not a share of
    /// recent activity) → full art, no wash.
    let liveliness: String?
    /// Fill + crop (the wide capital band) vs. fit the whole tile scene.
    var fill: Bool = false

    private var maxTier: Int { kingdomId == "capital" ? 11 : 5 }
    private var clampedTier: Int { max(0, min(maxTier, tier)) }

    var body: some View {
        Group {
            if let img = Self.image(kingdomId: kingdomId, tier: clampedTier) {
                Image(uiImage: img)
                    .interpolation(.none) // pixel art: nearest-neighbor, no blur
                    .resizable()
                    .aspectRatio(contentMode: fill ? .fill : .fit)
                    .overlay {
                        let dim = Self.dimOpacity(liveliness)
                        if dim > 0 { Color(red: 0.04, green: 0.07, blue: 0.16).opacity(dim) }
                    }
            } else {
                Rectangle().fill(Color.white.opacity(0.05))
                    .aspectRatio(kingdomId == "capital" ? 1024.0 / 192.0 : 320.0 / 192.0, contentMode: fill ? .fill : .fit)
            }
        }
    }

    /// Night-wash strength per liveliness, mirroring the web `ALPHA_BY_LIVELINESS`
    /// (dormant 0.55 → most asleep) as a dark overlay opacity.
    private static func dimOpacity(_ liveliness: String?) -> Double {
        switch liveliness {
        case "dormant": return 0.45
        case "stirring": return 0.24
        case "steady": return 0.08
        default: return 0 // bustling / nil (capital) / unknown → full brightness
        }
    }

    // Static bundle art — cache once. Mirrors PixelHeroView's loose-PNG lookup
    // (the synchronized folder flattens files to the bundle root).
    private static var cache: [String: UIImage] = [:]
    private static func image(kingdomId: String, tier: Int) -> UIImage? {
        let name = "kscene-\(kingdomId)-\(tier)"
        if let cached = cache[name] { return cached }
        let img = UIImage(named: name)
            ?? Bundle.main.url(forResource: name, withExtension: "png")
                .flatMap { UIImage(contentsOfFile: $0.path) }
        if let img { cache[name] = img }
        return img
    }
}
