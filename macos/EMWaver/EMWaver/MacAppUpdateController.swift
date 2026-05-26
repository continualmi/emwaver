import Foundation
import Combine
import Sparkle

@MainActor
final class MacAppUpdateController: NSObject, ObservableObject, SPUUpdaterDelegate {
    private lazy var updaterController = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: self,
        userDriverDelegate: nil
    )

    override init() {
        super.init()
        _ = updaterController
    }

    func checkForUpdates() {
        updaterController.checkForUpdates(nil)
    }

    nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        "https://emwaver.ai/updates/macos/appcast.xml"
    }
}
