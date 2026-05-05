import Combine
import Foundation

@MainActor
final class HostSessionManager: ObservableObject {
    @Published private var scriptRunning: Bool = false
    @Published private var activeScriptName: String = ""

    private let hostSessionIdKey = "emwaver.hostSessionId"
    private(set) var hostSessionId: String

    init() {
        if let existing = UserDefaults.standard.string(forKey: hostSessionIdKey), !existing.isEmpty {
            hostSessionId = existing
        } else {
            let newId = UUID().uuidString
            hostSessionId = newId
            UserDefaults.standard.set(newId, forKey: hostSessionIdKey)
        }
    }

    func setScriptStatus(running: Bool, activeScriptName: String?) {
        self.scriptRunning = running
        self.activeScriptName = (activeScriptName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
