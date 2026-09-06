import SwiftUI
import AuthenticationServices

/// The system Sign in with Apple button. Its tap runs our Auth0 `apple`-connection
/// web flow (see `AuthManager.loginWithApple`) rather than the native
/// ASAuthorizationController, so the resulting session is one identity across
/// web / RN / native.
private struct AppleSignInButton: UIViewRepresentable {
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .white)
        button.cornerRadius = 12
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
    }

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}

struct LoginView: View {
    @EnvironmentObject private var auth: AuthManager

    var body: some View {
        VStack(spacing: Theme.Space.xl) {
            Spacer()
            VStack(spacing: Theme.Space.md) {
                Image(systemName: "shield.lefthalf.filled").font(.system(size: 68)).foregroundStyle(Theme.accent)
                Text("FocusQuest").font(.outfitLargeTitleBold)
                Text("Turn your to-do list into an adventure. Complete quests, level up your hero, and build momentum.")
                    .font(.outfitBody)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Space.xl)
            }
            Spacer()
            VStack(spacing: Theme.Space.md) {
                PrimaryButton(title: "Sign in", systemImage: "person.crop.circle", isLoading: auth.isWorking) {
                    Task { await auth.login() }
                }
                AppleSignInButton { Task { await auth.loginWithApple() } }
                    .frame(height: 50)
                    .disabled(auth.isWorking)
                    .opacity(auth.isWorking ? 0.5 : 1)
                if let error = auth.loginError {
                    Text(error).font(.outfitFootnote).foregroundStyle(Theme.danger).multilineTextAlignment(.center)
                }
                Text("You'll sign in securely through your browser.")
                    .font(.outfitCaption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, Theme.Space.xl)
            .padding(.bottom, Theme.Space.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.screenBackground)
    }
}
