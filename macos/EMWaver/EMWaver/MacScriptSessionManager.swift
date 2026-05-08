import Combine
import Foundation

import EMWaverScriptRuntime
import EMWaverScriptsUI

@MainActor
private final class LocalTargetedScriptDevice: ScriptDevice {
    private weak var base: MacUSBManager?
    private let deviceID: String?

    init(base: MacUSBManager, deviceID: String?) {
        self.base = base
        self.deviceID = deviceID
    }

    func getBuffer() -> Data { base?.getBuffer() ?? Data() }
    func clearBuffer() { base?.clearBuffer() }
    func loadBuffer(data: Data) { base?.loadBuffer(data: data) }
    func sendPacket(_ data: Data) { base?.sendPacket(data, deviceID: deviceID) }
    func sendCommand(_ command: Data, timeout: Int) -> Data? { base?.sendCommand(command, timeout: timeout, deviceID: deviceID) }
    func transmitBuffer() { base?.transmitBuffer() }
}

struct MacScriptSessionSummary: Identifiable, Equatable {
    let id: String
    let scriptId: String
    let scriptName: String
    let deviceID: String?
    let deviceLabel: String
    let stateText: String
}

@MainActor
private final class MacScriptSession {
    let manager: ScriptPreviewManager
    let scriptId: String
    let scriptName: String
    let deviceID: String?
    let deviceLabel: String
    var cancellable: AnyCancellable?

    init(manager: ScriptPreviewManager, scriptId: String, scriptName: String, deviceID: String?, deviceLabel: String) {
        self.manager = manager
        self.scriptId = scriptId
        self.scriptName = scriptName
        self.deviceID = deviceID
        self.deviceLabel = deviceLabel
    }
}

@MainActor
final class MacScriptSessionManager: ObservableObject {
    @Published private(set) var sessions: [MacScriptSessionSummary] = []
    @Published private(set) var selectedSessionID: String?
    @Published var selectedDeviceID: String?

    private weak var device: MacUSBManager?
    private var sessionsByID: [String: MacScriptSession] = [:]
    private var devicesByID: [String: LocalDeviceDescriptor] = [:]

    var activePreviewManager: ScriptPreviewManager? {
        guard let selectedSessionID else { return nil }
        return sessionsByID[selectedSessionID]?.manager
    }

    var sessionCount: Int {
        sessions.count
    }

    var scriptSessionStatuses: [ScriptsRootView.ScriptSessionStatus] {
        sessions.map {
            ScriptsRootView.ScriptSessionStatus(
                id: $0.id,
                scriptId: $0.scriptId,
                deviceLabel: $0.deviceLabel,
                stateText: $0.stateText
            )
        }
    }

    func attach(device: MacUSBManager) {
        self.device = device
        updateDevices(device.discoveredDevices)
    }

    func updateDevices(_ devices: [LocalDeviceDescriptor]) {
        devicesByID = Dictionary(uniqueKeysWithValues: devices.map { ($0.id, $0) })

        if let selectedDeviceID, devicesByID[selectedDeviceID] != nil {
            return
        }

        selectedDeviceID = devices.first(where: { $0.isActive })?.id
            ?? devices.first(where: { $0.connectionState == .connected })?.id
            ?? devices.first?.id
    }

    func run(_ request: ScriptsRootView.ScriptRunRequest) -> ScriptsRootView.ScriptRunResult? {
        guard let device else { return nil }

        let targetID = selectedDeviceID
        let manager = ScriptPreviewManager()
        manager.attach(device: LocalTargetedScriptDevice(base: device, deviceID: targetID))

        let session = MacScriptSession(
            manager: manager,
            scriptId: request.scriptId,
            scriptName: request.name,
            deviceID: targetID,
            deviceLabel: label(for: targetID)
        )
        session.cancellable = manager.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refreshSummaries()
            }

        manager.render(script: request.source, name: request.name, moduleSources: request.moduleSources)
        guard let scriptInstanceId = manager.activeScriptInstanceId else { return nil }

        sessionsByID[scriptInstanceId] = session
        selectedSessionID = scriptInstanceId
        refreshSummaries()

        return ScriptsRootView.ScriptRunResult(
            scriptInstanceId: scriptInstanceId,
            name: request.name,
            running: true
        )
    }

    func selectSession(_ id: String) {
        guard sessionsByID[id] != nil else { return }
        selectedSessionID = id
        refreshSummaries()
    }

    func stopSelectedSession() {
        guard let selectedSessionID else { return }
        stopSession(selectedSessionID)
    }

    func stopSession(_ id: String) {
        guard let session = sessionsByID[id] else { return }
        session.manager.exitPreview()
        sessionsByID.removeValue(forKey: id)
        if selectedSessionID == id {
            selectedSessionID = sessionsByID.keys.sorted().first
        }
        refreshSummaries()
    }

    private func refreshSummaries() {
        sessions = sessionsByID
            .map { id, session in
                MacScriptSessionSummary(
                    id: id,
                    scriptId: session.scriptId,
                    scriptName: session.manager.activeScriptName ?? session.scriptName,
                    deviceID: session.deviceID,
                    deviceLabel: session.deviceLabel,
                    stateText: session.manager.activeScriptName == nil ? "stopped" : "running"
                )
            }
            .sorted { $0.scriptName.localizedCaseInsensitiveCompare($1.scriptName) == .orderedAscending }
        objectWillChange.send()
    }

    private func label(for deviceID: String?) -> String {
        guard let deviceID, let descriptor = devicesByID[deviceID] else {
            return "Active device"
        }

        return LocalDeviceLabelFormatter.label(for: descriptor)
    }
}
