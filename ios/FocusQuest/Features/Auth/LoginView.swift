import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthManager

    var body: some View {
        VStack(spacing: Theme.Space.xl) {
            Spacer()
            VStack(spacing: Theme.Space.md) {
                Text("⚔️").font(.system(size: 72))
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
