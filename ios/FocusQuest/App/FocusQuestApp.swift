import SwiftUI
import UIKit
import UserNotifications

/// Installs the on-device local-notification delegate before launch completes, so a
/// cold launch from a notification tap is delivered to `NotificationManager`.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationManager.shared
        return true
    }

    /// Forwards the APNs device token to the API so pushes can be addressed to this
    /// device. Fire-and-forget: registration failure here shouldn't affect app launch.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { try? await DeviceService.register(token: hex, environment: DeviceService.currentEnvironment) }
    }

    /// Non-fatal: local notifications still work without a remote token. Logged, not
    /// surfaced to the user.
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("APNs registration failed: \(error.localizedDescription)")
    }
}

@main
struct FocusQuestApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthManager()
    @StateObject private var router = AppRouter.shared

    init() { Theme.configureUIKitAppearance() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(router)
                .tint(Theme.accent)
                .font(.outfitBody) // default typeface for text without an explicit style
                .preferredColorScheme(.dark) // dark-only, matching the web app
                .onOpenURL { url in
                    // Widget / Live Activity "Start Focus" deep link → Focus tab.
                    // (The Auth0 callback `focusquest://auth` is consumed by
                    // ASWebAuthenticationSession and never reaches here.)
                    if url.host == "focus" { router.tab = .focus }
                }
        }
    }
}
