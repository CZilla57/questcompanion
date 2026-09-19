import Foundation
import SwiftUI
import AuthenticationServices

/// App-wide authentication state, mirroring the RN `AuthProvider`.
///
/// - Restores the stored session token on launch.
/// - `login()` runs the Auth0 web flow, exchanges the code for a FocusQuest
///   session token, and persists it in the Keychain.
/// - `logout()` best-effort invalidates the server session, then clears local
///   state.
/// - Wires `APIClient` so every request carries the bearer token and a 401
///   triggers sign-out.
@MainActor
final class AuthManager: ObservableObject {
    enum Status: Equatable {
        case loading
        case anonymous
        case authenticated
    }

    @Published private(set) var status: Status = .loading
    @Published var authUser: AuthUser?
    @Published var loginError: String?
    @Published private(set) var isWorking = false

    private let tokenAccount = Keychain.sessionTokenAccount
    private var token: String?

    init() {
        Task { await bootstrap() }
    }

    private func bootstrap() async {
        token = Keychain.get(account: tokenAccount)
        await wireClient()
        await APIClient.shared.setToken(token)
        if token != nil {
            status = .authenticated
            await NotificationManager.shared.reregisterIfAuthorized()
            // Confirm the token is still valid; sign out silently if not.
            await refreshAuthUser()
        } else {
            status = .anonymous
        }
    }

    private func wireClient() async {
        await APIClient.shared.setUnauthorizedHandler { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        }
    }

    /// Start Sign in with Apple, brokered through Auth0's `apple` connection so the
    /// resulting session token is the same identity as web/RN/native email login.
    func loginWithApple() async { await login(connection: "apple") }

    func login(connection: String? = nil) async {
        guard !isWorking else { return }
        isWorking = true
        loginError = nil
        defer { isWorking = false }
        do {
            let web = OAuthWebSession()
            let authorization = try await web.authorize(connection: connection)
            let token = try await AuthService.exchangeCode(
                code: authorization.code,
                verifier: authorization.pkce.verifier,
                state: authorization.pkce.state,
                nonce: authorization.pkce.nonce
            )
            Keychain.set(token, account: tokenAccount)
            self.token = token
            await APIClient.shared.setToken(token)
            status = .authenticated
            await NotificationManager.shared.reregisterIfAuthorized()
            await refreshAuthUser()
        } catch is CancellationError {
            // Ignore explicit cancellation.
        } catch let error as AuthError where error == .cancelled {
            // User dismissed the browser; not an error worth surfacing.
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // User closed the sign-in browser.
        } catch {
            loginError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func logout() async {
        isWorking = true
        defer { isWorking = false }
        // Deregister the push token FIRST, while the bearer is still valid server-side —
        // once serverLogout() below deletes the session, DELETE /devices/:token 401s and
        // the token is orphaned (keeps receiving this user's pushes after sign-out; the
        // delete route requires being authenticated as the token's current owner, so
        // once we've signed out there is no credential left to retry with). Retry a few
        // times first, since a transient network blip is the common failure mode — this
        // is not a full fix for a device that's offline for the whole window; that
        // residual case self-heals only if someone (this user or another) registers a
        // token on this device again later, since registration upserts by token.
        if let apnsToken = UserDefaults.standard.string(forKey: "apnsToken") {
            var deregistered = false
            for attempt in 0..<3 {
                do {
                    try await DeviceService.unregister(token: apnsToken)
                    deregistered = true
                    break
                } catch {
                    if attempt < 2 {
                        try? await Task.sleep(nanoseconds: UInt64(500_000_000 * (attempt + 1)))
                    }
                }
            }
            if deregistered {
                UserDefaults.standard.removeObject(forKey: "apnsToken")
            }
        }
        // Invalidate the server session while the token is still attached.
        try? await AuthService.serverLogout()
        Keychain.delete(account: tokenAccount)
        token = nil
        await APIClient.shared.setToken(nil)
        authUser = nil
        status = .anonymous
    }

    func refreshAuthUser() async {
        do {
            let envelope = try await AuthService.currentUser()
            authUser = envelope.user
            if envelope.user == nil { handleUnauthorized() }
        } catch APIError.unauthorized {
            handleUnauthorized()
        } catch {
            // Network hiccup — keep the optimistic authenticated state.
        }
    }

    private func handleUnauthorized() {
        Keychain.delete(account: tokenAccount)
        token = nil
        authUser = nil
        status = .anonymous
        Task { await APIClient.shared.setToken(nil) }
    }
}

extension AuthError: Equatable {
    static func == (lhs: AuthError, rhs: AuthError) -> Bool {
        lhs.localizedDescription == rhs.localizedDescription
    }
}
