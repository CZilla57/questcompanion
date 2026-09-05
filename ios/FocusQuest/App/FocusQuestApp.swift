import SwiftUI
import UIKit

@main
struct FocusQuestApp: App {
    @StateObject private var auth = AuthManager()

    init() { Theme.configureUIKitAppearance() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .tint(Theme.accent)
                .font(.outfitBody) // default typeface for text without an explicit style
                .preferredColorScheme(.dark) // dark-only, matching the web app
        }
    }
}
