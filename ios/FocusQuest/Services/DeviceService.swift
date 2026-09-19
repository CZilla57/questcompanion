import Foundation

/// Registers/unregisters this device's APNs token with the API.
enum DeviceService {
    struct RegisterInput: Encodable { let token: String; let provider = "apns"; let environment: String }

    static func register(token: String, environment: String) async throws {
        let _: Empty = try await APIClient.shared.post("devices", body: RegisterInput(token: token, environment: environment))
    }

    static func unregister(token: String) async throws {
        try await APIClient.shared.send("devices/\(token)", method: .delete)
    }

    /// aps-environment baked into the build: "sandbox" for development, else "production".
    static var currentEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}
