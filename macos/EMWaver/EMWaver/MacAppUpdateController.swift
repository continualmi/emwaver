import Foundation
import Combine
import Sparkle
import AppKit

@MainActor
final class MacAppUpdateController: NSObject, ObservableObject, SPUUpdaterDelegate {
    let updatesConfigured: Bool

    private lazy var updaterController: SPUStandardUpdaterController? = {
        guard updatesConfigured else { return nil }
        return SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
    }()

    override init() {
        updatesConfigured = Self.hasConfiguredPublicKey
        super.init()
        _ = updaterController
    }

    func checkForUpdates() {
        guard let updaterController else {
            presentUpdatesUnavailableAlert()
            return
        }
        updaterController.checkForUpdates(nil)
    }

    nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        "https://emwaver.ai/updates/macos/appcast.xml"
    }

    private static var hasConfiguredPublicKey: Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String else {
            return false
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && !trimmed.contains("$(")
    }

    private func presentUpdatesUnavailableAlert() {
        let alert = NSAlert()
        alert.messageText = "Updates are not configured for this build."
        alert.informativeText = "This build is missing the Sparkle signing key, so EMWaver will not check for app updates automatically."
        alert.alertStyle = .informational
        alert.runModal()
    }
}
