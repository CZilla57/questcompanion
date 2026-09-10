import SwiftUI
import UIKit

/// Outfit — the web app's typeface (bundled as a variable font, see
/// Resources/Fonts/Outfit.ttf, registered via Info.plist `UIAppFonts`).
///
/// Weights are pulled off the variable `wght` axis through a font descriptor,
/// and every face is wrapped in `UIFontMetrics` so it still scales with Dynamic
/// Type — the Outfit equivalent of using SwiftUI's built-in text styles.
enum AppFont {
    static let family = "Outfit"

    static func uiFont(_ size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: family,
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        // Falls back to the system font if the family failed to register.
        if descriptor.postscriptName.isEmpty && UIFont(name: family, size: size) == nil {
            return .systemFont(ofSize: size, weight: weight)
        }
        return UIFont(descriptor: descriptor, size: size)
    }

    static func font(_ size: CGFloat, weight: UIFont.Weight, textStyle: UIFont.TextStyle) -> Font {
        let scaled = UIFontMetrics(forTextStyle: textStyle).scaledFont(for: uiFont(size, weight: weight))
        return Font(scaled)
    }
}

/// Outfit-backed drop-ins for the system text styles used across the app.
/// Point sizes mirror the default (Large) sizes of the matching iOS styles.
extension Font {
    static let outfitLargeTitleBold = AppFont.font(34, weight: .bold, textStyle: .largeTitle)
    static let outfitTitle2         = AppFont.font(22, weight: .regular, textStyle: .title2)
    static let outfitTitle2Bold     = AppFont.font(22, weight: .bold, textStyle: .title2)
    static let outfitTitle3Bold     = AppFont.font(20, weight: .bold, textStyle: .title3)
    static let outfitHeadline       = AppFont.font(17, weight: .semibold, textStyle: .headline)
    static let outfitBody           = AppFont.font(17, weight: .regular, textStyle: .body)
    static let outfitCallout        = AppFont.font(16, weight: .regular, textStyle: .callout)
    static let outfitSubheadline    = AppFont.font(15, weight: .regular, textStyle: .subheadline)
    static let outfitSubheadlineBold = AppFont.font(15, weight: .semibold, textStyle: .subheadline)
    static let outfitFootnote       = AppFont.font(13, weight: .regular, textStyle: .footnote)
    static let outfitCaption        = AppFont.font(12, weight: .regular, textStyle: .caption1)
    static let outfitCaptionBold    = AppFont.font(12, weight: .semibold, textStyle: .caption1)
    static let outfitCaption2       = AppFont.font(11, weight: .regular, textStyle: .caption2)
}
