import Foundation
import UIKit
import AuthenticationServices

/// Result of a successful browser authorization step.
struct AuthorizationResult {
    let code: String
    let pkce: PKCEChallenge
}

/// Drives the Auth0 Authorization Code + PKCE flow via
/// `ASWebAuthenticationSession`, the native counterpart to the RN app's
/// `expo-auth-session`. Discovery is fetched from the OIDC well-known document
/// so the authorization endpoint always matches the tenant.
@MainActor
final class OAuthWebSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    /// - Parameter connection: when set (e.g. `"apple"`), pins the Auth0 connection
    ///   so the browser goes straight to that identity provider instead of the
    ///   Universal Login picker. `nil` keeps the default hosted login.
    func authorize(connection: String? = nil) async throws -> AuthorizationResult {
        let pkce = PKCEChallenge()
        let authEndpoint = try await discoverAuthorizationEndpoint()
        let authURL = buildAuthorizationURL(endpoint: authEndpoint, pkce: pkce, connection: connection)

        let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "focusquest"
            ) { url, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let url {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: AuthError.cancelled)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                continuation.resume(throwing: AuthError.cannotStart)
            }
        }

        return try parseCallback(callbackURL, pkce: pkce)
    }

    // MARK: - Steps

    private func discoverAuthorizationEndpoint() async throws -> URL {
        let url = AppConfig.auth0Issuer.appendingPathComponent(".well-known/openid-configuration")
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw AuthError.discoveryFailed
        }
        let doc = try JSONDecoder().decode(DiscoveryDocument.self, from: data)
        guard let endpoint = URL(string: doc.authorization_endpoint) else {
            throw AuthError.discoveryFailed
        }
        return endpoint
    }

    private func buildAuthorizationURL(endpoint: URL, pkce: PKCEChallenge, connection: String?) -> URL {
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: AppConfig.auth0ClientID),
            URLQueryItem(name: "redirect_uri", value: AppConfig.redirectURI),
            URLQueryItem(name: "scope", value: AppConfig.scopes),
            URLQueryItem(name: "state", value: pkce.state),
            URLQueryItem(name: "nonce", value: pkce.nonce),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        // Pin a specific IdP (e.g. Apple) so the browser skips the login picker.
        if let connection { items.append(URLQueryItem(name: "connection", value: connection)) }
        components.queryItems = items
        return components.url!
    }

    private func parseCallback(_ url: URL, pkce: PKCEChallenge) throws -> AuthorizationResult {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = components?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            let desc = items.first(where: { $0.name == "error_description" })?.value
            throw AuthError.authorizationServer(error, desc)
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else {
            throw AuthError.missingCode
        }
        // Defend against a mismatched state (CSRF).
        let returnedState = items.first(where: { $0.name == "state" })?.value
        guard returnedState == pkce.state else { throw AuthError.stateMismatch }
        return AuthorizationResult(code: code, pkce: pkce)
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow ?? ASPresentationAnchor()
    }

    private struct DiscoveryDocument: Decodable {
        let authorization_endpoint: String
    }
}

enum AuthError: Error, LocalizedError {
    case cancelled
    case cannotStart
    case discoveryFailed
    case missingCode
    case stateMismatch
    case authorizationServer(String, String?)

    var errorDescription: String? {
        switch self {
        case .cancelled: return "Sign-in was cancelled."
        case .cannotStart: return "Could not open the sign-in browser."
        case .discoveryFailed: return "Couldn't reach the identity provider."
        case .missingCode: return "Sign-in did not return an authorization code."
        case .stateMismatch: return "Sign-in failed a security check. Please try again."
        case .authorizationServer(let code, let desc): return desc ?? "Sign-in error: \(code)"
        }
    }
}

private extension UIWindowScene {
    var keyWindow: UIWindow? { windows.first { $0.isKeyWindow } ?? windows.first }
}
