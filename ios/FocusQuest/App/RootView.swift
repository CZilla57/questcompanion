import SwiftUI

/// Routes between the loading splash, the login screen, and the main app based
/// on auth status — the native equivalent of the RN `_layout` gate.
struct RootView: View {
    @EnvironmentObject private var auth: AuthManager

    var body: some View {
        switch auth.status {
        case .loading:
            SplashView()
        case .anonymous:
            LoginView()
        case .authenticated:
            MainTabView()
        }
    }
}

struct SplashView: View {
    var body: some View {
        VStack(spacing: Theme.Space.lg) {
            Text("⚔️").font(.system(size: 60))
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.screenBackground)
    }
}
