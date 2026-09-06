import SwiftUI

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var prefs: NotificationPrefs?
    @Published var recapEmail: Bool = false
    @Published var loading = true

    func load() async {
        loading = true
        prefs = try? await UserService.notificationPrefs()
        recapEmail = (try? await ProgressService.recaps())?.emailEnabled ?? false
        loading = false
    }

    func savePrefs() async {
        guard let prefs else { return }
        _ = try? await UserService.updateNotificationPrefs(prefs)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var auth: AuthManager
    @StateObject private var model = SettingsViewModel()
    @State private var confirmSignOut = false

    var body: some View {
        NeonList {
            Section("Account") {
                if let user = auth.authUser {
                    HStack {
                        AvatarBadge(name: user.displayName.isEmpty ? (user.email ?? "?") : user.displayName, colorHex: nil, size: 44)
                        VStack(alignment: .leading) {
                            Text(user.displayName.isEmpty ? "FocusQuest Hero" : user.displayName).font(.outfitHeadline)
                            if let email = user.email { Text(email).font(.outfitCaption).foregroundStyle(.secondary) }
                        }
                    }
                }
            }

            if let prefs = model.prefs {
                Section("Notifications") {
                    Toggle("Context reminders", isOn: binding(\.reminders))
                    Toggle("Hyperfocus protection", isOn: binding(\.protection))
                    Toggle("Evening reflection", isOn: binding(\.reflection))
                    Toggle("Hero care", isOn: binding(\.hero))
                    Stepper("Quiet hours start: \(prefs.quietHoursStart):00", value: binding(\.quietHoursStart), in: 0...23)
                        .onChange(of: prefs.quietHoursStart) { Task { await model.savePrefs() } }
                    Stepper("Quiet hours end: \(prefs.quietHoursEnd):00", value: binding(\.quietHoursEnd), in: 0...23)
                        .onChange(of: prefs.quietHoursEnd) { Task { await model.savePrefs() } }
                }
            } else if model.loading {
                Section { HStack { ProgressView(); Text("Loading…").foregroundStyle(.secondary) } }
            }

            Section("Weekly recap") {
                Label(model.recapEmail ? "Email recaps on" : "Email recaps off", systemImage: "envelope")
                    .foregroundStyle(.secondary)
                    .labelStyle(TealIconLabelStyle())
            }

            Section {
                LabeledContent("Time zone", value: TimeZone.current.identifier)
                LabeledContent("Version", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "—")
            }

            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
            }
        }
        .tint(Theme.accent)
        .navigationTitle("Settings")
        .task { await model.load() }
        .confirmationDialog("Sign out of FocusQuest?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await auth.logout() } }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func binding(_ keyPath: WritableKeyPath<NotificationPrefs, Bool>) -> Binding<Bool> {
        Binding(
            get: { model.prefs?[keyPath: keyPath] ?? false },
            set: { model.prefs?[keyPath: keyPath] = $0; Task { await model.savePrefs() } }
        )
    }

    private func binding(_ keyPath: WritableKeyPath<NotificationPrefs, Int>) -> Binding<Int> {
        Binding(
            get: { model.prefs?[keyPath: keyPath] ?? 0 },
            set: { model.prefs?[keyPath: keyPath] = $0 }
        )
    }
}
