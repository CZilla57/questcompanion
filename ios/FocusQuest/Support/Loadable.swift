import SwiftUI

/// Four-state async value used by the screen view models.
enum Loadable<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? { if case .loaded(let v) = self { return v } else { return nil } }
}

/// Renders the right view for a `Loadable`, handing loaded content to a builder.
/// Keeps each feature screen from re-implementing the loading/error dance.
struct AsyncContentView<Value, Content: View>: View {
    let state: Loadable<Value>
    let retry: () -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .idle, .loading:
            LoadingView()
        case .failed(let message):
            ErrorRetryView(message: message, retry: retry)
        case .loaded(let value):
            content(value)
        }
    }
}

extension Error {
    /// Best user-facing string for any thrown error.
    var userMessage: String {
        (self as? LocalizedError)?.errorDescription ?? localizedDescription
    }
}
