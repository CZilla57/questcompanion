import Foundation

/// HTTP verbs used by the FocusQuest API.
enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

/// A thin async/await JSON client for the FocusQuest REST API.
///
/// Responsibilities mirror the RN `api-client-react` package: it prepends the
/// `/api` base path, attaches the `Authorization: Bearer <sid>` header from the
/// token store, encodes/decodes JSON, and maps failures onto `APIError`. A 401
/// is reported to the `onUnauthorized` hook so the auth layer can sign out.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let base: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    /// The current bearer token, owned by the actor so reads never hop off it.
    private var token: String?
    /// Called once when any request comes back 401.
    private var onUnauthorized: @Sendable () -> Void = {}

    init(baseURL: URL = AppConfig.apiBaseURL) {
        self.base = baseURL.appendingPathComponent("api")
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    func setToken(_ token: String?) { self.token = token }
    func setUnauthorizedHandler(_ handler: @escaping @Sendable () -> Void) { onUnauthorized = handler }

    // MARK: - Convenience verbs

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try await request(path, method: .get, query: query, body: Optional<Empty>.none)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await request(path, method: .post, body: body)
    }

    func post<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: .post, body: Optional<Empty>.none)
    }

    func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await request(path, method: .patch, body: body)
    }

    @discardableResult
    func delete<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: .delete, body: Optional<Empty>.none)
    }

    /// POST/DELETE where the caller doesn't care about the response body.
    func send(_ path: String, method: HTTPMethod) async throws {
        let _: Empty = try await request(path, method: method, body: Optional<Empty>.none)
    }

    // MARK: - Core

    func request<T: Decodable, B: Encodable>(
        _ path: String,
        method: HTTPMethod,
        query: [String: String?] = [:],
        body: B?
    ) async throws -> T {
        guard var components = URLComponents(
            url: base.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.invalidRequest(path)
        }
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty { components.queryItems = items }
        guard let url = components.url else { throw APIError.invalidRequest(path) }

        var req = URLRequest(url: url)
        req.httpMethod = method.rawValue
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do { req.httpBody = try encoder.encode(body) }
            catch { throw APIError.decoding(error) }
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(status: -1, message: nil)
        }

        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 {
                onUnauthorized()
                throw APIError.unauthorized
            }
            let message = (try? decoder.decode(ErrorEnvelope.self, from: data))?.error
            throw APIError.http(status: http.statusCode, message: message)
        }

        // Endpoints that return no body (204, or empty) resolve to `Empty`.
        if T.self == Empty.self {
            return Empty() as! T
        }
        if data.isEmpty, let empty = Empty() as? T {
            return empty
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}

/// Placeholder for empty request/response bodies.
struct Empty: Codable {}

/// `{ "error": "..." }` envelope returned on failures.
struct ErrorEnvelope: Decodable { let error: String }
