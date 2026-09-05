import Foundation

/// Runtime configuration resolved from Info.plist (populated by Config.xcconfig).
///
/// Mirrors the React Native app's `resolveApiUrl` / `resolveAuthConfig`: the API
/// base URL, the Auth0 issuer, and the Auth0 client id all come from build-time
/// values so no secrets are compiled into source.
enum AppConfig {
    /// Base URL of the API server, e.g. `https://api.focusquest.app`.
    /// The `/api` prefix is appended by `APIClient`, matching the server's
    /// `servers: [{ url: /api }]` in the OpenAPI spec.
    static let apiBaseURL: URL = {
        let raw = infoValue("FQAPIBaseURL")
        guard let url = URL(string: raw), url.scheme != nil else {
            fatalError(
                "FQAPIBaseURL is not configured. Set FQ_API_HOST (and FQ_API_SCHEME) in ios/Config.xcconfig."
            )
        }
        return url
    }()

    /// Auth0 issuer URL, e.g. `https://your-tenant.us.auth0.com`.
    static let auth0Issuer: URL = {
        let domain = normalizeDomain(infoValue("FQAuth0Domain"))
        guard !domain.isEmpty, let url = URL(string: "https://\(domain)") else {
            fatalError("FQAuth0Domain is not configured. Set FQ_AUTH0_DOMAIN in ios/Config.xcconfig.")
        }
        return url
    }()

    /// Auth0 native application client id.
    static let auth0ClientID: String = {
        let id = infoValue("FQAuth0ClientID")
        guard !id.isEmpty else {
            fatalError("FQAuth0ClientID is not configured. Set FQ_AUTH0_CLIENT_ID in ios/Config.xcconfig.")
        }
        return id
    }()

    /// OAuth redirect URI. Matches the RN app (`focusquest://auth`) so the same
    /// Auth0 "Allowed Callback URLs" entry works for both clients.
    static let redirectURI = "focusquest://auth"

    /// OAuth scopes requested — identical to the RN client.
    static let scopes = "openid email profile offline_access"

    // MARK: - Helpers

    private static func infoValue(_ key: String) -> String {
        let value = Bundle.main.object(forInfoDictionaryKey: key) as? String
        return (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizeDomain(_ domain: String) -> String {
        var d = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        if let range = d.range(of: "://") { d = String(d[range.upperBound...]) }
        while d.hasSuffix("/") { d.removeLast() }
        return d
    }
}
