import Foundation

/// Auth endpoints: the mobile token exchange and session lifecycle.
/// Mirrors `artifacts/focusquest-mobile/src/auth/token-exchange.ts`.
enum AuthService {
    private struct ExchangeBody: Encodable {
        let code: String
        let code_verifier: String
        let redirect_uri: String
        let state: String
        let nonce: String?
    }

    private struct TokenResponse: Decodable { let token: String }

    /// Posts the authorization code to `/mobile-auth/token-exchange` and returns
    /// the opaque FocusQuest session token.
    static func exchangeCode(code: String, verifier: String, state: String, nonce: String?) async throws -> String {
        let body = ExchangeBody(
            code: code,
            code_verifier: verifier,
            redirect_uri: AppConfig.redirectURI,
            state: state,
            nonce: nonce
        )
        let response: TokenResponse = try await APIClient.shared.post("mobile-auth/token-exchange", body: body)
        return response.token
    }

    /// Best-effort server-side session invalidation. Must run while the bearer
    /// token is still attached.
    static func serverLogout() async throws {
        try await APIClient.shared.send("mobile-auth/logout", method: .post)
    }

    /// Resolves the currently authenticated user (or nil when the session is
    /// gone). Used on launch to validate a restored token.
    static func currentUser() async throws -> AuthUserEnvelope {
        try await APIClient.shared.get("auth/user")
    }
}
