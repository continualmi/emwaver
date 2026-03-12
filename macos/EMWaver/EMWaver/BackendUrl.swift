import Foundation

enum BackendUrl {
    static func resolve() -> URL? {
        let active = (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return URL(string: active)
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
