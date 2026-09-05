import Foundation
import CryptoKit
import Security

/// PKCE + OIDC nonce/state helpers.
///
/// Matches the RN client exactly: the verifier and random values are
/// base64url-encoded raw bytes, and the challenge is base64url(SHA-256(verifier)).
/// The server (`/mobile-auth/token-exchange`) completes the authorization-code
/// grant with the verifier, so the challenge method is S256.
struct PKCEChallenge {
    let verifier: String
    let challenge: String
    let state: String
    let nonce: String

    init() {
        self.verifier = Self.base64URL(Self.randomBytes(32))
        self.state = Self.base64URL(Self.randomBytes(16))
        self.nonce = Self.base64URL(Self.randomBytes(16))
        let digest = SHA256.hash(data: Data(verifier.utf8))
        self.challenge = Self.base64URL(Data(digest))
    }

    private static func randomBytes(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes)
    }

    /// URL-safe base64 with padding stripped (RFC 7636).
    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
