import Foundation

enum AppConfig {
    static var backendBaseURL: URL {
        if let rawValue = Bundle.main.object(forInfoDictionaryKey: "BackendBaseURL") as? String,
           let url = URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
           !rawValue.isEmpty {
            return url
        }
        return URL(string: "http://10.0.2.2:8000")!
    }
}
