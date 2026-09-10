import Foundation

// The Campaign — second wave (Class Feats): list the hero's feats and use an
// active one. Gated server-side on the campaigns unlock; a locked hero gets
// empty lists, so the caller simply shows nothing.
enum FeatService {
    static func list() async throws -> FeatsResponse {
        try await APIClient.shared.get("users/me/feats", query: ["tz": TZ.identifier])
    }

    static func activate(id: String) async throws -> FeatActivateResult {
        try await APIClient.shared.post(
            "users/me/feats/\(id)/activate", body: FeatActivateInput(tz: TZ.identifier))
    }

    // Act V: choose (or clear) the specialization branch — free respec, anytime.
    @discardableResult
    static func chooseBranch(_ id: String?) async throws -> FeatBranchChoiceResult {
        try await APIClient.shared.post(
            "users/me/feat-branch", body: FeatBranchChoiceInput(branch: id))
    }
}
