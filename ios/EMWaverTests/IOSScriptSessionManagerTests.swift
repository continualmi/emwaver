import XCTest
import EMWaverScriptsUI
@testable import EMWaver

@MainActor
final class IOSScriptSessionManagerTests: XCTestCase {
    func testKeepsMultipleVisibleSessionRowsAndStopsIndividually() {
        let manager = IOSScriptSessionManager()
        let device = USBManager()

        let first = manager.run(
            scriptRequest(id: "script-a", name: "Alpha"),
            device: device,
            deviceLabel: "USB A"
        )
        let second = manager.run(
            scriptRequest(id: "script-b", name: "Beta"),
            device: device,
            deviceLabel: "USB B"
        )

        XCTAssertNotNil(first)
        XCTAssertNotNil(second)
        XCTAssertEqual(manager.sessionStatuses.count, 2)
        XCTAssertEqual(Set(manager.sessionStatuses.map(\.scriptId)), ["script-a", "script-b"])
        XCTAssertEqual(Set(manager.sessionStatuses.map(\.deviceLabel)), ["USB A", "USB B"])

        manager.stopSession(first!.scriptInstanceId)

        XCTAssertEqual(manager.sessionStatuses.count, 1)
        XCTAssertEqual(manager.sessionStatuses.first?.scriptId, "script-b")
        XCTAssertTrue(manager.hasRunningSessions)
        XCTAssertEqual(manager.activeScriptName, "Beta")
    }

    private func scriptRequest(id: String, name: String) -> ScriptsRootView.ScriptRunRequest {
        ScriptsRootView.ScriptRunRequest(
            scriptId: id,
            name: name,
            source: """
            UI.render(UI.text({ text: "\(name)" }));
            """,
            moduleSources: [:]
        )
    }
}
