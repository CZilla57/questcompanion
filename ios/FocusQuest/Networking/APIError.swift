import Foundation

/// Errors surfaced by `APIClient`.
enum APIError: Error, LocalizedError {
    /// The request could not be built (bad URL/query).
    case invalidRequest(String)
    /// Transport failure (no network, DNS, TLS, timeout).
    case transport(Error)
    /// The server returned a non-2xx status. `message` is the decoded
    /// `{ "error": ... }` envelope when present.
    case http(status: Int, message: String?)
    /// The session token was rejected (401). The auth layer signs out on this.
    case unauthorized
    /// The response body could not be decoded into the expected type.
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let why): return "Invalid request: \(why)"
        case .transport(let err): return err.localizedDescription
        case .http(let status, let message): return message ?? "Request failed (HTTP \(status))"
        case .unauthorized: return "Your session expired. Please sign in again."
        case .decoding: return "The server sent something unexpected."
        }
    }

    /// Whether the error is worth offering a retry for.
    var isRetryable: Bool {
        switch self {
        case .transport: return true
        case .http(let status, _): return status >= 500
        default: return false
        }
    }
}
