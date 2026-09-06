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

    func login() async {
        guard !isWorking else { return }
        isWorking = true
        loginError = nil
        defer { isWorking = false }
        do {
            let web = OAuthWebSession()
            let authorization = try await web.authorize()
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
