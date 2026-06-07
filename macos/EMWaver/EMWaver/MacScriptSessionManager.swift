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

    func getBuffer() -> Data { base?.getBuffer(deviceID: deviceID) ?? Data() }
    func clearBuffer() { base?.clearBuffer(deviceID: deviceID) }
    func loadBuffer(data: Data) { base?.loadBuffer(data: data, deviceID: deviceID) }
    func sendPacket(_ data: Data) { base?.sendPacket(data, deviceID: deviceID) }
    func sendCommand(_ command: Data, timeout: Int) -> Data? { base?.sendCommand(command, timeout: timeout, deviceID: deviceID) }
    func transmitBuffer() { base?.transmitBuffer(deviceID: deviceID) }
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
    let deviceBridge: LocalTargetedScriptDevice
    let scriptId: String
    let scriptName: String
    let deviceID: String?
    let deviceLabel: String
    let hardwareUID: String?
    let transportSessionClaimed: Bool
    var cancellable: AnyCancellable?

    init(
        manager: ScriptPreviewManager,
        deviceBridge: LocalTargetedScriptDevice,
        scriptId: String,
        scriptName: String,
        deviceID: String?,
        deviceLabel: String,
        hardwareUID: String?,
        transportSessionClaimed: Bool
    ) {
        self.manager = manager
        self.deviceBridge = deviceBridge
        self.scriptId = scriptId
        self.scriptName = scriptName
        self.deviceID = deviceID
        self.deviceLabel = deviceLabel
        self.hardwareUID = hardwareUID
        self.transportSessionClaimed = transportSessionClaimed
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
    private var userSelectedDeviceID: String?

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
                deviceId: $0.deviceID ?? "active",
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

        if let userSelectedDeviceID {
            if let selected = devicesByID[userSelectedDeviceID],
               Self.hardwareUID(from: selected.identifierText) != nil {
                selectedDeviceID = userSelectedDeviceID
                return
            }
            self.userSelectedDeviceID = nil
        }

        selectedDeviceID = preferredDeviceID(in: devices)
    }

    func selectDeviceID(_ id: String?) {
        guard let id,
              let descriptor = devicesByID[id],
              Self.hardwareUID(from: descriptor.identifierText) != nil else {
            userSelectedDeviceID = nil
            selectedDeviceID = preferredDeviceID(in: Array(devicesByID.values))
            return
        }
        userSelectedDeviceID = id
        selectedDeviceID = id
    }

    private func preferredDeviceID(in devices: [LocalDeviceDescriptor]) -> String? {
        devices.filter { Self.hardwareUID(from: $0.identifierText) != nil }
            .sorted { lhs, rhs in
                let lhsState = connectionPriority(lhs.connectionState)
                let rhsState = connectionPriority(rhs.connectionState)
                if lhsState != rhsState { return lhsState < rhsState }

                let lhsTransport = transportPriority(lhs.transport)
                let rhsTransport = transportPriority(rhs.transport)
                if lhsTransport != rhsTransport { return lhsTransport < rhsTransport }

                if lhs.isActive != rhs.isActive { return lhs.isActive && !rhs.isActive }
                return LocalDeviceLabelFormatter.label(for: lhs)
                    .localizedStandardCompare(LocalDeviceLabelFormatter.label(for: rhs)) == .orderedAscending
            }.first?.id
    }

    private static func hardwareUID(from identifierText: String?) -> String? {
        guard let identifierText, identifierText.hasPrefix("UID ") else { return nil }
        let uid = String(identifierText.dropFirst("UID ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard uid.count == 12, uid.allSatisfy(\.isHexDigit) else { return nil }
        return uid
    }

    private func connectionPriority(_ state: LocalDeviceDescriptor.ConnectionState) -> Int {
        switch state {
        case .connected:
            return 0
        case .connecting:
            return 1
        case .discovered:
            return 2
        case .disconnected:
            return 3
        }
    }

    private func transportPriority(_ transport: LocalDeviceDescriptor.TransportKind) -> Int {
        switch transport {
        case .usbMidi:
            return 0
        case .usbSerial:
            return 1
        case .ble:
            return 2
        case .wifi:
            return 3
        }
    }

    func run(_ request: ScriptsRootView.ScriptRunRequest) -> ScriptsRootView.ScriptRunResult? {
        guard let device else {
            return runFailure("Cannot run script: No device manager is attached", request: request)
        }

        let targetID = selectedDeviceID
        let targetUID = targetID.flatMap { devicesByID[$0] }.flatMap { Self.hardwareUID(from: $0.identifierText) }
        if let existing = activeSession(forDeviceID: targetID, hardwareUID: targetUID) {
            let message = "Device is already running \(existing.scriptName) on \(existing.deviceLabel)"
            device.reportLocalError(message)
            return runFailure(message, request: request)
        }

        guard device.beginScriptTransportSession(deviceID: targetID) else {
            if targetID == nil {
                return runFailure("Cannot run script: No selected device", request: request)
            }
            return runFailure(device.lastErrorText ?? "Cannot run script: transport claim failed", request: request)
        }

        let manager = ScriptPreviewManager()
        let deviceBridge = LocalTargetedScriptDevice(base: device, deviceID: targetID)
        manager.attach(device: deviceBridge)

        let session = MacScriptSession(
            manager: manager,
            deviceBridge: deviceBridge,
            scriptId: request.scriptId,
            scriptName: request.name,
            deviceID: targetID,
            deviceLabel: label(for: targetID),
            hardwareUID: targetUID,
            transportSessionClaimed: true
        )
        session.cancellable = manager.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refreshSummaries()
            }

        manager.render(script: request.source, name: request.name, moduleSources: request.moduleSources)
        guard let scriptInstanceId = manager.activeScriptInstanceId else {
            device.endScriptTransportSession(deviceID: targetID)
            return runFailure(manager.scriptError ?? "Cannot run script: render did not start", request: request)
        }

        sessionsByID[scriptInstanceId] = session
        selectedSessionID = scriptInstanceId
        refreshSummaries()

        return ScriptsRootView.ScriptRunResult(
            scriptInstanceId: scriptInstanceId,
            name: request.name,
            running: true
        )
    }

    private func runFailure(_ message: String, request: ScriptsRootView.ScriptRunRequest) -> ScriptsRootView.ScriptRunResult {
        ScriptsRootView.ScriptRunResult(
            scriptInstanceId: "",
            name: request.name,
            running: false,
            errorMessage: message
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
        if session.transportSessionClaimed {
            device?.endScriptTransportSession(deviceID: session.deviceID)
        }
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

    private func activeSession(forDeviceID deviceID: String?, hardwareUID: String?) -> MacScriptSession? {
        sessionsByID.values.first { session in
            if let deviceID, session.deviceID == deviceID {
                return true
            }
            guard let hardwareUID, let sessionUID = session.hardwareUID else {
                return false
            }
            return sessionUID.caseInsensitiveCompare(hardwareUID) == .orderedSame
        }
    }

    private func label(for deviceID: String?) -> String {
        guard let deviceID, let descriptor = devicesByID[deviceID] else {
            return "Active device"
        }

        return LocalDeviceLabelFormatter.label(for: descriptor)
    }
}
