import SwiftUI
import UIKit

// Renders the same LPC pixel-art hero as the web app by compositing the shared
// sprite sheets (bundled under Resources/HeroSprites, flattened to `dir__name`).
// A "look" resolves to an ordered set of PNG layers (body, hair, outfit, gear…),
// each a 9-frame south-facing strip; we draw the standing frame (frame 0).

// MARK: - Catalog (generated from the web catalog.ts → catalog.json)

struct HeroCatalogEntry: Decodable {
    let id: String
    let category: String
    let zIndex: Int
    let res: String
}

enum HeroCatalog {
    static let byId: [String: HeroCatalogEntry] = {
        guard let url = Bundle.main.url(forResource: "catalog", withExtension: "json")
                ?? Bundle.main.url(forResource: "catalog", withExtension: "json", subdirectory: "HeroSprites"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([HeroCatalogEntry].self, from: data)
        else { return [:] }
        return Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }()
}

// MARK: - Look + layer resolution (ports resolve-layers.ts)

struct HeroSpriteLook {
    var skin: String
    var build: String
    var hairStyle: String
    var hairColor: String
    var beardStyle: String
    var beardColor: String
    var glasses: String
    var earrings: String
    var avatarClass: String
    var tier: Int
    var equipped: [(slot: String, spriteId: String, rarity: String)]
}

extension AvatarProfile {
    /// Build the renderer look from the avatar payload, defaulting missing
    /// fields the same way the web `apiHeroToLook` does.
    var heroLook: HeroSpriteLook {
        HeroSpriteLook(
            skin: avatarSkin.isEmpty ? "light" : avatarSkin,
            build: avatarBodyBuild ?? "male",
            hairStyle: avatarHairStyle ?? "short",
            hairColor: avatarHairColor ?? "brown",
            beardStyle: avatarBeardStyle ?? "none",
            beardColor: avatarBeardColor ?? "brown",
            glasses: avatarGlasses ?? "none",
            earrings: avatarEarrings ?? "none",
            avatarClass: avatarClass.isEmpty ? "fighter" : avatarClass,
            tier: min(3, max(0, (level - 1) / 10)),
            equipped: equippedGear.compactMap { g in
                guard let sprite = g.spriteId else { return nil }
                return (slot: g.slot, spriteId: sprite, rarity: g.rarity)
            }
        )
    }
}

private struct ResolvedHeroLayer: Identifiable {
    let id = UUID()
    let res: String
    let zIndex: Int
    let tint: Color?
}

private let heroGearCategories: Set<String> = ["weapon", "helmet", "armor", "boots", "accessory"]

private func rarityTint(_ rarity: String) -> Color? {
    switch rarity {
    case "rare": return Color(hex: "3b82f6")
    case "epic": return Color(hex: "a855f7")
    case "legendary": return Color(hex: "f59e0b")
    default: return nil // common
    }
}

private func resolveHeroLayers(_ look: HeroSpriteLook) -> [ResolvedHeroLayer] {
    // Rarity tint keyed by the catalog category the gear occupies.
    var tintByCategory: [String: Color] = [:]
    for g in look.equipped {
        if let entry = HeroCatalog.byId["gear:\(g.spriteId):\(look.build)"], let tint = rarityTint(g.rarity) {
            tintByCategory[entry.category] = tint
        }
    }

    var ids: [String] = ["body:\(look.build):\(look.skin)"]
    if look.hairStyle != "bald" { ids.append("hair:\(look.hairStyle):\(look.hairColor)") }
    if look.earrings != "none" { ids.append("earrings:\(look.earrings)") }
    if look.beardStyle != "none" { ids.append("beard:\(look.beardStyle):\(look.beardColor)") }
    if look.glasses != "none" { ids.append("glasses:\(look.glasses)") }
    ids.append("outfit:\(look.avatarClass):t\(look.tier):\(look.build)")
    for g in look.equipped { ids.append("gear:\(g.spriteId):\(look.build)") }

    var layers: [ResolvedHeroLayer] = []
    for id in ids {
        guard let entry = HeroCatalog.byId[id] else { continue } // unbuilt asset → skip, like the web
        let tint = heroGearCategories.contains(entry.category) ? tintByCategory[entry.category] : nil
        layers.append(ResolvedHeroLayer(res: entry.res, zIndex: entry.zIndex, tint: tint))
    }
    return layers.sorted { $0.zIndex < $1.zIndex }
}

// MARK: - Sprite loading (frame 0 of the strip, cached)

private enum HeroSprites {
    private static var frameCache: [String: UIImage] = [:]

    private static func strip(_ res: String) -> UIImage? {
        UIImage(named: res)
            ?? Bundle.main.url(forResource: res, withExtension: "png", subdirectory: "HeroSprites")
                .flatMap { UIImage(contentsOfFile: $0.path) }
            ?? Bundle.main.url(forResource: res, withExtension: "png")
                .flatMap { UIImage(contentsOfFile: $0.path) }
    }

    /// The standing pose: first square frame of the horizontal strip.
    static func standingFrame(_ res: String) -> UIImage? {
        if let cached = frameCache[res] { return cached }
        guard let cg = strip(res)?.cgImage else { return nil }
        let side = cg.height // square frames; the strip is `height` tall
        guard side > 0, let sub = cg.cropping(to: CGRect(x: 0, y: 0, width: side, height: side)) else { return nil }
        let img = UIImage(cgImage: sub)
        frameCache[res] = img
        return img
    }
}

// MARK: - View

struct PixelHeroView: View {
    let look: HeroSpriteLook
    var size: CGFloat = 128

    private var layers: [ResolvedHeroLayer] { resolveHeroLayers(look) }

    var body: some View {
        ZStack {
            ForEach(layers) { layer in
                if let img = HeroSprites.standingFrame(layer.res) {
                    layerView(img, tint: layer.tint)
                }
            }
        }
        .frame(width: size, height: size)
    }

    @ViewBuilder
    private func layerView(_ img: UIImage, tint: Color?) -> some View {
        let base = Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
        if let tint {
            // Tint opaque pixels toward the gear rarity color (web uses source-atop
            // at ~0.55), leaving transparent areas untouched.
            base.overlay(tint.opacity(0.55).mask(base))
        } else {
            base
        }
    }
}
