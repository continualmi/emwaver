/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Combine
import CoreBluetooth
import CoreMIDI
import Darwin
import Foundation

import EMWaverScriptRuntime
import EMWaverTransport

struct LocalDeviceDescriptor: Identifiable, Equatable {
    enum TransportKind: String {
        case ble = "BLE"
        case usbMidi = "USB"
        case usbSerial = "USB Serial"
        case wifi = "Wi-Fi"
    }

    enum ConnectionState: String {
        case discovered
        case connecting
        case connected
        case disconnected
    }

    let id: String
    var displayName: String
    var transport: TransportKind
    var boardType: String?
    var moduleLabel: String?
    var identifierText: String?
    var connectionState: ConnectionState
    var lastErrorText: String?
    var isActive: Bool
}

private final class MacTransportDeviceSession {
    private let bufferQueue = DispatchQueue(label: "com.emwaver.macos.device-session.buffer")
    private let commandLock = NSLock()

    private var sysexAccumulator = UsbMidiSysexAccumulator()
    private var captureBuffer = Data()
    private var rxPackets: [Data] = []
    private var isSamplerStreamingActive = false
    private var waitingForResponse = false
    private var responseSemaphore: DispatchSemaphore?
    private var responseData: Data?
    private var responsePredicate: ((Data) -> Bool)?
    private var bufferStatusSemaphore: DispatchSemaphore?
    private var latestBufferStatus: UInt16?

    func getBuffer() -> Data {
        bufferQueue.sync { captureBuffer }
    }

    func clearBuffer() {
        bufferQueue.sync {
            captureBuffer.removeAll(keepingCapacity: true)
            rxPackets.removeAll(keepingCapacity: true)
        }
    }

    func loadBuffer(data: Data) {
        bufferQueue.sync {
            captureBuffer = data
        }
    }

    func resetParserAndBuffers() {
        bufferQueue.sync {
            captureBuffer.removeAll(keepingCapacity: true)
            rxPackets.removeAll(keepingCapacity: true)
            sysexAccumulator = UsbMidiSysexAccumulator()
            isSamplerStreamingActive = false
            waitingForResponse = false
            responseSemaphore = nil
            responseData = nil
            responsePredicate = nil
            bufferStatusSemaphore = nil
            latestBufferStatus = nil
        }
    }

    func performCommand(
        timeout: Int,
        responsePredicate: ((Data) -> Bool)?,
        send: () -> Void
    ) -> Data? {
        commandLock.lock()
        defer { commandLock.unlock() }

        bufferQueue.sync {
            rxPackets.removeAll(keepingCapacity: true)
        }

        let sem = DispatchSemaphore(value: 0)
        bufferQueue.sync {
            waitingForResponse = true
            responseSemaphore = sem
            responseData = nil
            self.responsePredicate = responsePredicate
        }

        send()

        let ms = max(1, timeout)
        let waitResult = sem.wait(timeout: .now() + .milliseconds(ms))

        bufferQueue.sync {
            waitingForResponse = false
            responseSemaphore = nil
            self.responsePredicate = nil
        }

        if waitResult == .timedOut {
            return nil
        }

        return bufferQueue.sync { responseData }
    }

    func trackCommand(_ data: Data, sampleOpcode: UInt8, sampleStart: UInt8, sampleStop: UInt8) {
        guard data.count >= 2 else { return }
        let opcode = data[data.startIndex]
        guard opcode == sampleOpcode else { return }
        let sub = data[data.startIndex.advanced(by: 1)]
        bufferQueue.sync {
            if sub == sampleStart {
                isSamplerStreamingActive = true
            } else if sub == sampleStop {
                isSamplerStreamingActive = false
            }
        }
    }

    func handleMidiBytes(_ data: Data, laneSizeBytes: Int, superframeSizeBytes: Int) {
        for sysex in sysexAccumulator.feed(data) {
            guard let superframe = UsbMidiSysex.decodeSysexToSuperframe(sysex) else { continue }
            guard superframe.count >= superframeSizeBytes else { continue }

            let cmdLane = superframe.subdata(in: 0..<laneSizeBytes)
            let streamLane = superframe.subdata(in: laneSizeBytes..<superframeSizeBytes)

            let cmdEmpty = cmdLane.allSatisfy { $0 == 0 }
            let streamEmpty = streamLane.allSatisfy { $0 == 0 }

            if !cmdEmpty { storeRxLane(cmdLane) }

            if MacUSBManager.isBufferStatusLane(streamLane) {
                storeBufferStatus(streamLane)
                continue
            }

            let keepEmptyStream = bufferQueue.sync { isSamplerStreamingActive }
            if !streamEmpty || keepEmptyStream {
                storeRxLane(streamLane)
            }
        }
    }

    func waitForBufferStatus(timeoutMilliseconds: Int) -> UInt16? {
        let sem = DispatchSemaphore(value: 0)
        bufferQueue.sync {
            latestBufferStatus = nil
            bufferStatusSemaphore = sem
        }

        let waitResult = sem.wait(timeout: .now() + .milliseconds(max(1, timeoutMilliseconds)))
        let status = bufferQueue.sync { latestBufferStatus }
        bufferQueue.sync {
            bufferStatusSemaphore = nil
        }

        return waitResult == .timedOut ? nil : status
    }

    private func storeBufferStatus(_ lane: Data) {
        guard lane.count >= 4 else { return }
        let high = UInt16(lane[lane.startIndex.advanced(by: 2)])
        let low = UInt16(lane[lane.startIndex.advanced(by: 3)])
        bufferQueue.sync {
            latestBufferStatus = (high << 8) | low
            bufferStatusSemaphore?.signal()
        }
    }

    private func storeRxLane(_ lane: Data) {
        bufferQueue.sync {
            captureBuffer.append(lane)
            rxPackets.append(lane)

            if waitingForResponse, responseData == nil {
                if let predicate = responsePredicate, !predicate(lane) {
                    return
                }
                responseData = lane
                responseSemaphore?.signal()
            }
        }
    }
}

/// macOS USB MIDI (CoreMIDI) transport.
///
/// This is intentionally minimal: enough to power Scripts execution.
/// It implements `ScriptDevice` for the shared Script runtime.
final class MacUSBManager: NSObject, ObservableObject, ScriptDevice {
    static let transportDebugLoggingEnabledDefaultsKey = "emwaver.transportDebugLoggingEnabled"
    static let connectionPollIntervalSeconds: TimeInterval = 5.0
    private static let transportSessionHeartbeatIntervalSeconds: TimeInterval = 2.0
    private static let bleDiscoveryStaleIntervalSeconds: TimeInterval = 8.0

    // Mini-frame: 18B cmd lane + 18B stream lane.
    private static let laneSizeBytes: Int = 18
    private static let superframeSizeBytes: Int = 36
    private static let responseOK: UInt8 = 0x80
    private static let responseErr: UInt8 = 0x81
    private static let responseBusy: UInt8 = 0x82

    static func isBufferStatusLane(_ lane: Data) -> Bool {
        guard lane.count == laneSizeBytes,
              lane[lane.startIndex] == 0x42,
              lane[lane.startIndex.advanced(by: 1)] == 0x53 else {
            return false
        }
        return lane.dropFirst(4).allSatisfy { $0 == 0 }
    }

    private enum EmwOpcode {
        static let version: UInt8 = 0x01
        static let enterDfu: UInt8 = 0x06
        static let hardwareUID: UInt8 = 0x08
        static let board: UInt8 = 0x09
        static let wifiConfig: UInt8 = 0x0A
        static let transportSession: UInt8 = 0x0B
        static let sample: UInt8 = 0x60

        static let sampleStart: UInt8 = 0x00
        static let sampleStop: UInt8 = 0x01

        static let wifiBegin: UInt8 = 0x00
        static let wifiField: UInt8 = 0x01
        static let wifiApply: UInt8 = 0x02
        static let wifiClear: UInt8 = 0x03
        static let wifiStatus: UInt8 = 0x04
        static let wifiFieldSSID: UInt8 = 0x00
        static let wifiFieldPassword: UInt8 = 0x01

        static let transportSessionStatus: UInt8 = 0x00
        static let transportSessionConnect: UInt8 = 0x01
        static let transportSessionDisconnect: UInt8 = 0x02
        static let transportSessionHeartbeat: UInt8 = 0x03
        static let transportSourceUSB: UInt8 = 0x01
        static let transportSourceBLE: UInt8 = 0x02
        static let transportSourceWiFi: UInt8 = 0x03
    }

    private var transportDebugLoggingEnabled: Bool {
        if UserDefaults.standard.object(forKey: Self.transportDebugLoggingEnabledDefaultsKey) == nil {
            return true
        }
        return UserDefaults.standard.bool(forKey: Self.transportDebugLoggingEnabledDefaultsKey)
    }

    private let commandSemaphore = DispatchSemaphore(value: 1)

    @Published var isConnected: Bool = false
    @Published var connectedPortName: String? = nil
    @Published var availablePorts: [String] = []
    @Published var discoveredDevices: [LocalDeviceDescriptor] = []
    @Published var lastErrorText: String? = nil
    @Published var deviceEmwaverVersion: String? = nil
    @Published var connectedHardwareUID: String? = nil
    @Published var uidConnectionProbeLastChecked: Date? = nil
    @Published var autoConnectEnabled: Bool = true {
        didSet {
            if autoConnectEnabled {
                midiQueue.async {
                    self.suppressedAutoConnectWiFiIDs.removeAll()
                }
                refreshPorts()
            } else {
                stopBleScan()
            }
        }
    }

    @Published var connectedBoardType: String? = nil
    @Published var lastDetectedBoardType: String? = nil
    @Published var connectedTransportKind: String? = nil
    @Published var isBleScanning: Bool = false
    @Published var bluetoothStateText: String = "Starting"
    @Published var wifiProvisioningStatus: String? = nil
    @Published var isWiFiProvisioningError: Bool = false
    @Published var isWiFiProvisioning: Bool = false

    private enum ActiveTransport {
        case none
        case usbMidi
        case usbSerial
        case ble
        case wifi
    }

    private struct TransportSessionClaim {
        let source: UInt8
        let hardwareUID: String?
        let heartbeatTimer: DispatchSourceTimer
    }

    private struct TransportSessionBeginRequest {
        let targetID: String
        let source: UInt8?
        let requiresSession: Bool
    }

    private struct WiFiSetupSessionRequest {
        let targetID: String
        let source: UInt8?
        let requiresSession: Bool
        let alreadyClaimed: Bool
    }

    private static let bleServiceUUID = CBUUID(string: "45C7158E-0C3B-4E90-A847-452A15B14191")
    private static let bleCommandUUID = CBUUID(string: "46C7158E-0C3B-4E90-A847-452A15B14191")
    private static let bleNotifyUUID = CBUUID(string: "47C7158E-0C3B-4E90-A847-452A15B14191")

    private let midiQueue = DispatchQueue(label: "com.emwaver.macos.midi", qos: .userInitiated)

    private let midiQueueKey = DispatchSpecificKey<Void>()
    private var connectionPollTimer: DispatchSourceTimer?

    private var client: MIDIClientRef = 0
    private var inPort: MIDIPortRef = 0
    private var outPort: MIDIPortRef = 0

    private var connectedSource: MIDIEndpointRef = 0
    private var connectedDestination: MIDIEndpointRef = 0
    private var serialFileDescriptor: Int32 = -1
    private var serialReadSource: DispatchSourceRead?
    private var serialDevicePaths: [String] = []
    private var connectedSerialPath: String?
    private var activeTransport: ActiveTransport = .none

    private var portCandidatesByDisplayName: [String: PortCandidate] = [:]
    private var hardwareUIDByDeviceID: [String: String] = [:]
    private var boardTypeByDeviceID: [String: String] = [:]
    private var transportSessionClaimsByDeviceID: [String: TransportSessionClaim] = [:]
    private var bleDiscoveredPeripheralsByID: [UUID: CBPeripheral] = [:]
    private var deviceSessionsByID: [String: MacTransportDeviceSession] = [:]
    private var activeDeviceID: String?
    private var wifiDevices: [MacWiFiDeviceRecord] = []
    private var wifiManager: MacWiFiManager?
    private var pendingAutoConnectWiFiID: String?
    private var suppressedAutoConnectWiFiIDs: Set<String> = []
    private var wifiConnectionErrorsByID: [String: String] = [:]
    private var uidConnectionProbeInFlightDeviceIDs: Set<String> = []
    private var firmwareUpdateReconnectSuspendCount: Int = 0

    private var bleCentral: CBCentralManager?
    private var blePeripheral: CBPeripheral?
    private var bleCommandCharacteristic: CBCharacteristic?
    private var bleNotifyCharacteristic: CBCharacteristic?
    private var bleConnectedPeripheralsByID: [UUID: CBPeripheral] = [:]
    private var bleCommandCharacteristicsByID: [UUID: CBCharacteristic] = [:]
    private var bleNotifyCharacteristicsByID: [UUID: CBCharacteristic] = [:]
    private var bleDiscoveredNamesByID: [UUID: String] = [:]
    private var bleLastSeenByID: [UUID: Date] = [:]
    private var bleIdentityProbePeripheralIDs: Set<UUID> = []

    override init() {
        super.init()
        midiQueue.setSpecific(key: midiQueueKey, value: ())

        // Important: create the CoreMIDI client/ports on the main thread.
        // Creating the MIDI client on a GCD worker thread can result in missed
        // hot-plug notifications on some macOS setups (no runloop attached).
        // The rest of the I/O work is still serialized on `midiQueue`.
        self.ensureClient()
        self.bleCentral = CBCentralManager(delegate: self, queue: midiQueue)
        self.wifiManager = MacWiFiManager(
            onDevicesChanged: { [weak self] records in
                self?.midiQueue.async {
                    guard let self else { return }
                    self.hardwareUIDByDeviceID = self.hardwareUIDByDeviceID.filter { !$0.key.hasPrefix("wifi:") }
                    self.wifiDevices = records
                    self.publishDiscoveredDevices()
                    self.autoConnectIfNeededInternal()
                }
            },
            onData: { [weak self] data, deviceID in
                self?.midiQueue.async {
                    self?.handleMidiBytes(data, deviceID: deviceID)
                }
            },
            onError: { [weak self] message in
                self?.midiQueue.async {
                    self?.recordWiFiConnectionErrorIfNeeded(message)
                    self?.suppressPendingAutoConnectWiFiIfNeeded(errorMessage: message)
                    self?.setError(message)
                }
            },
            onConnected: { [weak self] record in
                self?.midiQueue.async {
                    self?.handleWiFiConnected(record)
                }
            },
            onDisconnected: { [weak self] deviceID in
                self?.midiQueue.async {
                    self?.handleWiFiDisconnected(deviceID: deviceID)
                }
            },
            onUIDProbeChecked: { [weak self] checkedAt in
                self?.recordUIDConnectionProbeCheck(at: checkedAt)
            }
        )
        self.wifiManager?.startDiscovery()
        midiQueue.async {
            self.refreshPortsInternal()
            self.autoConnectIfNeededInternal()
            self.startConnectionPollingInternal()
        }
    }

    deinit {
        connectionPollTimer?.cancel()
        connectionPollTimer = nil
    }

    private func withMidiQueueSync(_ block: () -> Void) {
        if DispatchQueue.getSpecific(key: midiQueueKey) != nil {
            block()
        } else {
            midiQueue.sync(execute: block)
        }
    }

    private func isTransportConnectedInternal() -> Bool {
        if DispatchQueue.getSpecific(key: midiQueueKey) != nil {
            switch activeTransport {
            case .usbMidi:
                return connectedSource != 0 && connectedDestination != 0
            case .usbSerial:
                return serialFileDescriptor >= 0 && connectedSerialPath != nil
            case .ble:
                guard let peripheral = blePeripheral else { return false }
                return peripheral.state == .connected && bleCommandCharacteristicsByID[peripheral.identifier] != nil
            case .wifi:
                return wifiManager?.isConnected == true
            case .none:
                return false
            }
        }
        return midiQueue.sync { isTransportConnectedInternal() }
    }

    private func isTransportConnectedInternal(deviceID: String?) -> Bool {
        guard let targetID = resolvedTransportID(for: deviceID) else {
            return isTransportConnectedInternal()
        }
        if targetID.hasPrefix("midi:") {
            return connectedSource != 0 && connectedDestination != 0 && activeDeviceID == targetID
        }
        if targetID.hasPrefix("serial:") {
            return serialFileDescriptor >= 0 && activeDeviceID == targetID
        }
        if targetID.hasPrefix("ble:"),
           let uuid = UUID(uuidString: String(targetID.dropFirst("ble:".count))),
           let peripheral = bleConnectedPeripheralsByID[uuid] {
            return peripheral.state == .connected && bleCommandCharacteristicsByID[uuid] != nil
        }
        if targetID.hasPrefix("wifi:") {
            return wifiManager?.isConnected == true && wifiManager?.activeDeviceID == targetID
        }
        return false
    }

    private var isRuntimeReconnectSuspendedInternal: Bool {
        firmwareUpdateReconnectSuspendCount > 0
    }

    private func isRuntimeReconnectSuspended() -> Bool {
        if DispatchQueue.getSpecific(key: midiQueueKey) != nil {
            return isRuntimeReconnectSuspendedInternal
        }
        return midiQueue.sync { isRuntimeReconnectSuspendedInternal }
    }

    static func inferBoardType(portName: String?) -> String {
        let name = (portName ?? "").lowercased()
        if name.contains("esp8266") || name.contains("8266") {
            return "esp8266"
        }
        if name.contains("esp32-s2") || name.contains("esp32s2") {
            return "esp32s2"
        }
        if name.contains("esp32-s3") || name.contains("esp32s3") || name.contains("s3") {
            return "esp32s3"
        }
        if name.contains("esp32") || name.contains("emwaver esp") {
            return "esp32"
        }
        if name.contains("arduino") ||
            name.contains("genuino") ||
            name.contains("uno") ||
            name.contains("nano") ||
            name.contains("mega") ||
            name.contains("leonardo") ||
            name.contains("micro") ||
            name.contains("mkr") ||
            name.contains("portenta") {
            return "arduino"
        }
        return "stm32f042"
    }

    static func inferSerialBoardType(path: String?) -> String {
        let name = (path ?? "").lowercased()
        if name.contains("esp8266") || name.contains("8266") {
            return "esp8266"
        }
        if name.contains("esp32-s2") || name.contains("esp32s2") {
            return "esp32s2"
        }
        if name.contains("esp32-s3") || name.contains("esp32s3") {
            return "esp32s3"
        }
        if name.contains("esp32") || name.contains("espressif") {
            return "esp32"
        }
        if name.contains("arduino") ||
            name.contains("genuino") ||
            name.contains("uno") ||
            name.contains("nano") ||
            name.contains("mega") ||
            name.contains("leonardo") ||
            name.contains("micro") ||
            name.contains("mkr") ||
            name.contains("portenta") {
            return "arduino"
        }
        return "serial"
    }

    static func boardTypeRequiresTransportSession(_ boardType: String?) -> Bool {
        let normalized = (boardType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "esp" || normalized == "esp8266" || normalized == "esp8266ex" {
            return true
        }
        if normalized.hasPrefix("esp32") {
            return true
        }
        if normalized == "arduino" ||
            normalized.hasPrefix("arduino-") ||
            normalized.hasPrefix("arduino_") {
            return true
        }
        return false
    }

    private func inferBleBoardType(name: String?) -> String {
        let inferred = Self.inferBoardType(portName: name)
        return inferred == "stm32f042" ? "esp32" : inferred
    }

    private func isWiFiProvisionableBoardType(_ boardType: String) -> Bool {
        switch boardType.lowercased() {
        case "esp8266", "esp32", "esp32s2", "esp32s3":
            return true
        default:
            return false
        }
    }

    private func activeTransportAllowsWiFiSetup() -> Bool {
        switch activeTransport {
        case .usbMidi, .usbSerial, .ble, .wifi:
            return true
        case .none:
            return false
        }
    }

    // MARK: - ScriptDevice (buffer)

    func getBuffer() -> Data {
        getBuffer(deviceID: nil)
    }

    func getBuffer(deviceID: String?) -> Data {
        deviceSession(for: deviceID)?.getBuffer() ?? Data()
    }

    func clearBuffer() {
        clearBuffer(deviceID: nil)
    }

    func clearBuffer(deviceID: String?) {
        deviceSession(for: deviceID)?.clearBuffer()
    }

    func loadBuffer(data: Data) {
        loadBuffer(data: data, deviceID: nil)
    }

    func loadBuffer(data: Data, deviceID: String?) {
        guard let session = deviceSession(for: deviceID) else {
            setError("Cannot load buffer: Not connected")
            return
        }
        session.loadBuffer(data: data)
    }

    // MARK: - Connection

    func refreshPorts() {
        midiQueue.async {
            self.suppressedAutoConnectWiFiIDs.removeAll()
            self.ensureClient()
            self.pollConnectionsInternal(resetWiFiSuppression: true)
        }
    }

    func setFirmwareUpdateReconnectSuspended(_ suspended: Bool) {
        withMidiQueueSync {
            if suspended {
                firmwareUpdateReconnectSuspendCount += 1
                pendingAutoConnectWiFiID = nil
                stopBleScanInternal()
                publishDiscoveredDevices()
                return
            }

            firmwareUpdateReconnectSuspendCount = max(0, firmwareUpdateReconnectSuspendCount - 1)
            guard !isRuntimeReconnectSuspendedInternal else { return }
            publishDiscoveredDevices()
            autoConnectIfNeededInternal()
        }
    }

    func connect(portName: String) {
        midiQueue.async {
            self.ensureClient()
            self.connectInternal(portName: portName)
        }
    }

    func connectDevice(id: String) {
        midiQueue.async {
            self.ensureClient()
            self.pendingAutoConnectWiFiID = nil
            if id.hasPrefix("uid:"), let transportID = self.hardwareUIDByDeviceID.first(where: { $0.value == String(id.dropFirst("uid:".count)) })?.key {
                self.connectDeviceInternal(transportID: transportID)
                return
            }
            self.connectDeviceInternal(transportID: id)
        }
    }

    func connectWiFi(host: String, port: Int = MacWiFiManager.defaultPort) {
        midiQueue.async {
            let targetID = MacWiFiManager.deviceID(
                host: host.trimmingCharacters(in: .whitespacesAndNewlines),
                port: port
            )
            guard self.canActivateTransportInternal(targetID) else { return }
            self.pendingAutoConnectWiFiID = nil
            self.wifiManager?.connect(host: host, port: port)
        }
    }

    func reportLocalError(_ message: String) {
        setError(message)
    }

    func beginScriptTransportSession(deviceID: String?) -> Bool {
        let request = midiQueue.sync {
            self.prepareBeginScriptTransportSessionInternal(deviceID: deviceID)
        }
        guard let request else { return false }
        guard request.requiresSession else { return true }
        guard let source = request.source else {
            setError("Cannot run script: Unsupported transport")
            return false
        }

        guard sendTransportSessionCommandInternal(
            subcommand: EmwOpcode.transportSessionConnect,
            source: source,
            deviceID: request.targetID,
            timeoutMs: 1500,
            reportErrors: true
        ) else {
            return false
        }
        setTransportDebugLogging(transportDebugLoggingEnabled, deviceID: request.targetID)
        midiQueue.sync {
            guard self.transportSessionClaimsByDeviceID[request.targetID] == nil else { return }
            self.startTransportSessionHeartbeatInternal(deviceID: request.targetID, source: source)
        }
        return true
    }

    func beginHardwarePrimitiveSession() -> Bool {
        beginScriptTransportSession(deviceID: nil)
    }

    func endHardwarePrimitiveSession() {
        guard let (targetID, claim) = takeTransportSessionClaim(deviceID: nil) else {
            return
        }
        guard isTransportConnectedInternal(deviceID: targetID) else {
            return
        }
        _ = sendTransportSessionCommandInternal(
            subcommand: EmwOpcode.transportSessionDisconnect,
            source: claim.source,
            deviceID: targetID,
            timeoutMs: 1000,
            reportErrors: false
        )
    }

    func deviceErrorDescription() -> String? {
        lastErrorText
    }

    func endScriptTransportSession(deviceID: String?) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let (targetID, claim) = self.takeTransportSessionClaim(deviceID: deviceID) else {
                return
            }
            guard self.isTransportConnectedInternal(deviceID: targetID) else {
                return
            }
            _ = self.sendTransportSessionCommandInternal(
                subcommand: EmwOpcode.transportSessionDisconnect,
                source: claim.source,
                deviceID: targetID,
                timeoutMs: 1000,
                reportErrors: false
            )
        }
    }

    func provisionWiFi(ssid: String, password: String) {
        let trimmedSSID = ssid.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedSSID.isEmpty else {
            setError("Wi-Fi SSID is required")
            return
        }

        DispatchQueue.main.async {
            self.isWiFiProvisioning = true
            self.isWiFiProvisioningError = false
            self.wifiProvisioningStatus = "Sending Wi-Fi setup"
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let canProvision = self.midiQueue.sync { self.activeTransportAllowsWiFiSetup() }
            guard canProvision else {
                self.finishWiFiProvisioning(message: "Connect a Wi-Fi-capable ESP board before provisioning Wi-Fi.", isError: true)
                return
            }
            let boardType = self.midiQueue.sync {
                self.connectedBoardType ?? self.lastDetectedBoardType ?? ""
            }
            guard self.isWiFiProvisionableBoardType(boardType) else {
                self.finishWiFiProvisioning(message: "Wi-Fi setup is available for Wi-Fi-capable ESP devices.", isError: true)
                return
            }

            let passwordBytes = Array(password.utf8)
            let fields: [(UInt8, [UInt8], Int)] = [
                (EmwOpcode.wifiFieldSSID, Array(trimmedSSID.utf8), 32),
                (EmwOpcode.wifiFieldPassword, passwordBytes, 64),
            ]

            for (_, bytes, maxLen) in fields where bytes.count > maxLen {
                self.finishWiFiProvisioning(message: "Wi-Fi setup value is too long.", isError: true)
                return
            }

            guard self.withWiFiSetupTransportSession({ targetID in
                guard self.sendWiFiConfigCommand([EmwOpcode.wifiConfig, EmwOpcode.wifiBegin], deviceID: targetID) else {
                    self.finishWiFiProvisioning(message: "Wi-Fi setup failed to start.", isError: true)
                    return false
                }

                for (field, bytes, _) in fields where !bytes.isEmpty {
                    var offset = 0
                    while offset < bytes.count {
                        let count = min(13, bytes.count - offset)
                        var command = Data([EmwOpcode.wifiConfig, EmwOpcode.wifiField, field, UInt8(offset), UInt8(count)])
                        command.append(contentsOf: bytes[offset..<(offset + count)])
                        guard self.sendWiFiConfigCommand(command, deviceID: targetID) else {
                            self.finishWiFiProvisioning(message: "Wi-Fi setup failed while sending credentials.", isError: true)
                            return false
                        }
                        offset += count
                    }
                }

                guard self.sendWiFiConfigCommand([EmwOpcode.wifiConfig, EmwOpcode.wifiApply], deviceID: targetID) else {
                    self.finishWiFiProvisioning(message: "Wi-Fi setup was rejected by the device.", isError: true)
                    return false
                }

                return true
            }) else {
                return
            }

            self.finishWiFiProvisioning(message: "Wi-Fi setup sent. The ESP board will join the network and advertise itself with mDNS.", isError: false)
        }
    }

    func clearWiFiProvisioning() {
        DispatchQueue.main.async {
            self.isWiFiProvisioning = true
            self.isWiFiProvisioningError = false
            self.wifiProvisioningStatus = "Clearing Wi-Fi setup"
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let canProvision = self.midiQueue.sync { self.activeTransportAllowsWiFiSetup() }
            guard canProvision else {
                self.finishWiFiProvisioning(message: "Connect a Wi-Fi-capable ESP board before clearing Wi-Fi setup.", isError: true)
                return
            }
            let boardType = self.midiQueue.sync {
                self.connectedBoardType ?? self.lastDetectedBoardType ?? ""
            }
            guard self.isWiFiProvisionableBoardType(boardType) else {
                self.finishWiFiProvisioning(message: "Wi-Fi setup recovery is available for Wi-Fi-capable ESP devices.", isError: true)
                return
            }
            guard self.withWiFiSetupTransportSession({ targetID in
                guard self.sendWiFiConfigCommand([EmwOpcode.wifiConfig, EmwOpcode.wifiClear], deviceID: targetID) else {
                    self.finishWiFiProvisioning(message: "Wi-Fi setup clear was rejected by the device.", isError: true)
                    return false
                }
                return true
            }) else {
                return
            }
            self.finishWiFiProvisioning(message: "Wi-Fi setup cleared. Provision the ESP board again before using Wi-Fi control.", isError: false)
        }
    }

    func refreshWiFiProvisioningStatus() {
        DispatchQueue.main.async {
            self.isWiFiProvisioning = true
            self.isWiFiProvisioningError = false
            self.wifiProvisioningStatus = "Checking Wi-Fi status"
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let canQuery = self.midiQueue.sync { self.activeTransportAllowsWiFiSetup() }
            guard canQuery else {
                self.finishWiFiProvisioning(message: "Connect a Wi-Fi-capable ESP board before checking Wi-Fi status.", isError: true)
                return
            }
            let boardType = self.midiQueue.sync {
                self.connectedBoardType ?? self.lastDetectedBoardType ?? ""
            }
            guard self.isWiFiProvisionableBoardType(boardType) else {
                self.finishWiFiProvisioning(message: "Wi-Fi status is available for Wi-Fi-capable ESP devices.", isError: true)
                return
            }
            guard let targetID = self.midiQueue.sync(execute: { self.activeDeviceID }),
                  let response = self.sendWiFiConfigRequest([EmwOpcode.wifiConfig, EmwOpcode.wifiStatus], deviceID: targetID),
                  response.count >= 3,
                  response.first == 0x80 else {
                self.finishWiFiProvisioning(message: "Wi-Fi status request was rejected by the device.", isError: true)
                return
            }
            let provisionedText = response[1] == 0 ? "unprovisioned" : "provisioned"
            let socketText = response[2] == 0 ? "idle" : "connected"
            if response.count >= 4 {
                let stationText = response[3] == 0 ? "offline" : "online"
                if response.count >= 5 {
                    let retryText = response[4] == 0 ? "idle" : "retrying"
                    if response.count >= 7 {
                        let reason = UInt16(response[5]) | (UInt16(response[6]) << 8)
                        let reasonText = Self.wiFiDisconnectReasonText(reason)
                        let ipText = Self.wiFiStatusStationIP(response)
                        let runtimeText = Self.wiFiStatusRuntimeText(response)
                        if let ipText {
                            self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText), station is \(stationText) at \(ipText) (\(retryText), \(reasonText)); socket is \(socketText); runtime is \(runtimeText).", isError: false)
                        } else {
                            self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText), station is \(stationText) (\(retryText), \(reasonText)); socket is \(socketText); runtime is \(runtimeText).", isError: false)
                        }
                    } else {
                        self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText), station is \(stationText) (\(retryText)); socket is \(socketText).", isError: false)
                    }
                } else {
                    self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText), station is \(stationText); socket is \(socketText).", isError: false)
                }
            } else {
                self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText); socket is \(socketText).", isError: false)
            }
        }
    }

    private func connectDeviceInternal(transportID id: String) {
        let targetID: String
        if id.hasPrefix("uid:"),
           let transportID = self.hardwareUIDByDeviceID.first(where: { $0.value == String(id.dropFirst("uid:".count)) })?.key {
            targetID = transportID
        } else {
            targetID = id
        }

        guard self.canActivateTransportInternal(targetID) else {
            return
        }
        if targetID.hasPrefix("midi:"), let displayName = self.displayNameFromDeviceID(targetID) {
            self.connectInternal(portName: displayName)
            return
        }
        if targetID.hasPrefix("serial:"), let path = self.serialPathFromDeviceID(targetID) {
            self.connectSerialInternal(path: path, makeActive: true)
            return
        }
        if targetID.hasPrefix("ble:"),
           let uuid = UUID(uuidString: String(targetID.dropFirst("ble:".count))),
           let peripheral = self.bleDiscoveredPeripheralsByID[uuid] {
            self.connectBleInternal(peripheral, name: self.bleDiscoveredNamesByID[uuid], makeActive: true)
            return
        }
        if targetID.hasPrefix("wifi:"), let record = self.wifiDevices.first(where: { $0.id == targetID }) {
            self.wifiConnectionErrorsByID.removeValue(forKey: record.id)
            self.publishDiscoveredDevices()
            self.wifiManager?.connect(record: record)
            return
        }
        self.setError("No matching device: \(id)")
    }

    func disconnect() {
        midiQueue.async {
            self.disconnectInternal()
        }
    }

    func startBleScan() {
        midiQueue.async {
            DispatchQueue.main.async {
                self.autoConnectEnabled = true
            }
            self.startBleScanInternal(allowWhenAutoConnectDisabled: true)
        }
    }

    func stopBleScan() {
        midiQueue.async {
            self.stopBleScanInternal()
        }
    }

    func requestEnterUpdateMode() {
        // Fire-and-forget. The device will erase the initial flash pages and reset,
        // then enumerate as DFU (0483:DF11).
        midiQueue.async {
            guard self.connectedDestination != 0 else {
                self.setError("Cannot enter Update Mode: Not connected")
                return
            }

            guard let pkt = Self.makePacket(Data([EmwOpcode.enterDfu])) else {
                self.setError("Cannot enter Update Mode: packet build failed")
                return
            }

            let sf = Self.makeSuperframe(cmdLane: pkt, streamLane: nil)
            self.sendSuperframe(sf)
        }
    }

    private func autoConnectIfNeededInternal() {
        guard autoConnectEnabled else { return }
        guard !isRuntimeReconnectSuspendedInternal else { return }
        if bleCentral?.state == .poweredOn {
            startBleScanInternal()
        }
        if !isTransportConnectedInternal() {
            connectToFirstPortInternal()
        }
        if !isTransportConnectedInternal() {
            connectToFirstSerialPortInternal()
        }
        _ = connectToFirstAdvertisedWiFiInternal()
    }

    private func startConnectionPollingInternal() {
        guard connectionPollTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: midiQueue)
        timer.schedule(
            deadline: .now() + Self.connectionPollIntervalSeconds,
            repeating: Self.connectionPollIntervalSeconds
        )
        timer.setEventHandler { [weak self] in
            self?.pollConnectionsInternal()
        }
        connectionPollTimer = timer
        timer.resume()
    }

    private func pollConnectionsInternal(resetWiFiSuppression: Bool = false) {
        if resetWiFiSuppression {
            suppressedAutoConnectWiFiIDs.removeAll()
        }
        ensureClient()
        pruneStaleBleDiscoveriesInternal()
        reconcileActiveTransportInternal()
        refreshPortsInternal()
        publishDiscoveredDevices()
        guard !isRuntimeReconnectSuspendedInternal else { return }
        autoConnectIfNeededInternal()
        scheduleUIDConnectionPollsInternal()
    }

    // MARK: - ScriptDevice (TX/RX)

    func sendPacket(_ data: Data) {
        midiQueue.async {
            self.sendPacketNow(data)
        }
    }

    func sendPacket(_ data: Data, deviceID: String?) {
        midiQueue.async {
            self.sendPacketNow(data, deviceID: deviceID)
        }
    }

    func sendCommand(_ command: Data, timeout: Int) -> Data? {
        sendCommandInternal(command, timeout: timeout, responsePredicate: nil)
    }

    func sendCommand(_ command: Data, timeout: Int, deviceID: String?) -> Data? {
        sendCommandInternal(command, timeout: timeout, responsePredicate: nil, deviceID: deviceID)
    }

    private func sendCommandInternal(_ command: Data, timeout: Int, responsePredicate: ((Data) -> Bool)?) -> Data? {
        sendCommandInternal(command, timeout: timeout, responsePredicate: responsePredicate, deviceID: nil)
    }

    private func sendCommandInternal(_ command: Data, timeout: Int, responsePredicate: ((Data) -> Bool)?, deviceID: String?) -> Data? {
        commandSemaphore.wait()
        defer { commandSemaphore.signal() }

        guard !isRuntimeReconnectSuspended() else {
            return nil
        }

        guard isTransportConnectedInternal(deviceID: deviceID) else {
            setError("Cannot send command: Not connected")
            return nil
        }

        guard let session = deviceSession(for: deviceID) else {
            setError("Cannot send command: No matching device session")
            return nil
        }

        let targetID = resolvedTransportID(for: deviceID)
        if targetID?.hasPrefix("wifi:") == true || (targetID == nil && activeTransport == .wifi) {
            guard wifiManager?.isConnected == true else {
                setError("Wi-Fi write failed: Not connected")
                return nil
            }
            guard let packet = Self.makePacket(command) else {
                setError("Cannot send command: too large (\(command.count) bytes, max \(Self.laneSizeBytes))")
                return nil
            }

            session.trackCommand(
                command,
                sampleOpcode: EmwOpcode.sample,
                sampleStart: EmwOpcode.sampleStart,
                sampleStop: EmwOpcode.sampleStop
            )

            let superframe = Self.makeSuperframe(cmdLane: packet, streamLane: nil)
            guard let sysex = UsbMidiSysex.encodeSuperframe(superframe) else {
                setError("SysEx encode failed")
                return nil
            }
            guard let responseSysex = wifiManager?.sendCommand(sysex, timeout: timeout) else {
                return nil
            }
            session.handleMidiBytes(responseSysex, laneSizeBytes: Self.laneSizeBytes, superframeSizeBytes: Self.superframeSizeBytes)
            guard let responseSuperframe = UsbMidiSysex.decodeSysexToSuperframe(responseSysex),
                  responseSuperframe.count >= Self.laneSizeBytes else {
                return nil
            }
            let responseLane = responseSuperframe.subdata(in: 0..<Self.laneSizeBytes)
            if let responsePredicate, !responsePredicate(responseLane) {
                return nil
            }
            return responseLane
        }

        return session.performCommand(timeout: timeout, responsePredicate: responsePredicate) {
            self.withMidiQueueSync {
                self.sendPacketNow(command, deviceID: deviceID)
            }
        }
    }

    private func sendPacketNow(_ data: Data) {
        sendPacketNow(data, deviceID: nil)
    }

    private func sendPacketNow(_ data: Data, deviceID: String?) {
        guard !isRuntimeReconnectSuspendedInternal else {
            return
        }

        guard let session = deviceSession(for: deviceID) else {
            setError("Cannot send packet: Not connected")
            return
        }

        guard let packet = Self.makePacket(data) else {
            setError("Cannot send packet: too large (\(data.count) bytes, max \(Self.laneSizeBytes))")
            return
        }

        session.trackCommand(
            data,
            sampleOpcode: EmwOpcode.sample,
            sampleStart: EmwOpcode.sampleStart,
            sampleStop: EmwOpcode.sampleStop
        )

        let sf = Self.makeSuperframe(cmdLane: packet, streamLane: nil)
        sendSuperframe(sf, deviceID: deviceID)
    }

    private func sendWiFiConfigCommand(_ bytes: [UInt8]) -> Bool {
        sendWiFiConfigCommand(Data(bytes))
    }

    private func sendWiFiConfigCommand(_ bytes: [UInt8], deviceID: String?) -> Bool {
        sendWiFiConfigCommand(Data(bytes), deviceID: deviceID)
    }

    private func sendWiFiConfigCommand(_ data: Data) -> Bool {
        sendWiFiConfigCommand(data, deviceID: nil)
    }

    private func sendWiFiConfigCommand(_ data: Data, deviceID: String?) -> Bool {
        sendWiFiConfigRequest(data, deviceID: deviceID)?.first == 0x80
    }

    private func sendWiFiConfigRequest(_ bytes: [UInt8]) -> Data? {
        sendWiFiConfigRequest(Data(bytes))
    }

    private func sendWiFiConfigRequest(_ bytes: [UInt8], deviceID: String?) -> Data? {
        sendWiFiConfigRequest(Data(bytes), deviceID: deviceID)
    }

    private func sendWiFiConfigRequest(_ data: Data) -> Data? {
        sendWiFiConfigRequest(data, deviceID: nil)
    }

    private func sendWiFiConfigRequest(_ data: Data, deviceID: String?) -> Data? {
        sendCommandInternal(
            data,
            timeout: 2000,
            responsePredicate: { lane in
                lane.first == Self.responseOK || lane.first == Self.responseErr
            },
            deviceID: deviceID
        )
    }

    private func withWiFiSetupTransportSession(_ operation: (String) -> Bool) -> Bool {
        let request = midiQueue.sync {
            self.prepareWiFiSetupTransportSessionInternal()
        }
        guard let request else { return false }
        guard request.requiresSession else {
            return operation(request.targetID)
        }
        guard let source = request.source else {
            finishWiFiProvisioning(message: "Wi-Fi setup is not available on the selected transport.", isError: true)
            return false
        }

        if !request.alreadyClaimed {
            guard sendTransportSessionCommandInternal(
                subcommand: EmwOpcode.transportSessionConnect,
                source: source,
                deviceID: request.targetID,
                timeoutMs: 1500,
                reportErrors: false
            ) else {
                finishWiFiProvisioning(message: "The ESP board did not accept the local transport session.", isError: true)
                return false
            }
        }

        defer {
            if !request.alreadyClaimed,
               isTransportConnectedInternal(deviceID: request.targetID) {
                _ = sendTransportSessionCommandInternal(
                    subcommand: EmwOpcode.transportSessionDisconnect,
                    source: source,
                    deviceID: request.targetID,
                    timeoutMs: 1000,
                    reportErrors: false
                )
            }
        }

        return operation(request.targetID)
    }

    private func prepareWiFiSetupTransportSessionInternal() -> WiFiSetupSessionRequest? {
        guard let targetID = activeDeviceID else {
            setError("Cannot configure Wi-Fi: No selected device")
            finishWiFiProvisioning(message: "Connect a Wi-Fi-capable ESP board before configuring Wi-Fi.", isError: true)
            return nil
        }
        guard isTransportConnectedInternal(deviceID: targetID) else {
            setError("Cannot configure Wi-Fi: Selected device is not connected")
            finishWiFiProvisioning(message: "Connect a Wi-Fi-capable ESP board before configuring Wi-Fi.", isError: true)
            return nil
        }
        guard requiresTransportSessionInternal(deviceID: targetID) else {
            return WiFiSetupSessionRequest(targetID: targetID, source: nil, requiresSession: false, alreadyClaimed: false)
        }
        guard let source = transportSessionSource(for: targetID) else {
            setError("Cannot configure Wi-Fi: Unsupported transport")
            finishWiFiProvisioning(message: "Wi-Fi setup is not available on the selected transport.", isError: true)
            return nil
        }
        if let claim = transportSessionClaimsByDeviceID[targetID] {
            guard claim.source == source else {
                setError("Device is busy with another transport session")
                finishWiFiProvisioning(message: "The ESP board is busy with another transport session.", isError: true)
                return nil
            }
            return WiFiSetupSessionRequest(targetID: targetID, source: source, requiresSession: true, alreadyClaimed: true)
        }
        return WiFiSetupSessionRequest(targetID: targetID, source: source, requiresSession: true, alreadyClaimed: false)
    }

    private func prepareBeginScriptTransportSessionInternal(deviceID: String?) -> TransportSessionBeginRequest? {
        guard let targetID = resolvedTransportID(for: deviceID) ?? activeDeviceID else {
            setError("Cannot run script: No selected device")
            return nil
        }
        guard isTransportConnectedInternal(deviceID: targetID) else {
            setError("Cannot run script: Selected device is not connected")
            return nil
        }
        guard requiresTransportSessionInternal(deviceID: targetID) else {
            return TransportSessionBeginRequest(targetID: targetID, source: nil, requiresSession: false)
        }
        guard transportSessionClaimsByDeviceID[targetID] == nil else {
            setError("Device is already running a script on the selected transport")
            return nil
        }
        guard let source = transportSessionSource(for: targetID) else {
            setError("Cannot run script: Unsupported transport")
            return nil
        }
        return TransportSessionBeginRequest(targetID: targetID, source: source, requiresSession: true)
    }

    private func takeTransportSessionClaim(deviceID: String?) -> (String, TransportSessionClaim)? {
        midiQueue.sync {
            guard let targetID = resolvedTransportID(for: deviceID) ?? activeDeviceID,
                  let claim = transportSessionClaimsByDeviceID.removeValue(forKey: targetID) else {
                return nil
            }
            claim.heartbeatTimer.setEventHandler {}
            claim.heartbeatTimer.cancel()
            return (targetID, claim)
        }
    }

    private func clearTransportSessionClaimsInternal(sendDisconnect: Bool) {
        let claims = transportSessionClaimsByDeviceID
        transportSessionClaimsByDeviceID.removeAll()
        for (deviceID, claim) in claims {
            claim.heartbeatTimer.setEventHandler {}
            claim.heartbeatTimer.cancel()
            guard sendDisconnect, isTransportConnectedInternal(deviceID: deviceID) else {
                continue
            }
            _ = sendTransportSessionCommandInternal(
                subcommand: EmwOpcode.transportSessionDisconnect,
                source: claim.source,
                deviceID: deviceID,
                timeoutMs: 1000,
                reportErrors: false
            )
        }
    }

    private func canActivateTransportInternal(_ deviceID: String) -> Bool {
        guard !isRuntimeReconnectSuspendedInternal else {
            setError("Firmware update is using the device connection")
            publishDiscoveredDevices()
            return false
        }

        let targetID = resolvedTransportID(for: deviceID) ?? deviceID
        guard !transportSessionClaimsByDeviceID.isEmpty,
              transportSessionClaimsByDeviceID[targetID] == nil else {
            return true
        }
        if let targetUID = hardwareUIDForDeviceIDInternal(targetID) {
            let sameDeviceClaimed = transportSessionClaimsByDeviceID.values.contains { claim in
                claim.hardwareUID?.caseInsensitiveCompare(targetUID) == .orderedSame
            }
            if !sameDeviceClaimed {
                return true
            }
        }
        setError("Stop the running script before switching transport")
        publishDiscoveredDevices()
        return false
    }

    private func startTransportSessionHeartbeatInternal(deviceID: String, source: UInt8) {
        let timer = DispatchSource.makeTimerSource(queue: midiQueue)
        timer.schedule(
            deadline: .now() + Self.transportSessionHeartbeatIntervalSeconds,
            repeating: Self.transportSessionHeartbeatIntervalSeconds
        )
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            guard self.transportSessionClaimsByDeviceID[deviceID]?.source == source else {
                return
            }
            DispatchQueue.global(qos: .utility).async { [weak self] in
                guard let self else { return }
                let ok = self.sendTransportSessionCommandInternal(
                    subcommand: EmwOpcode.transportSessionHeartbeat,
                    source: source,
                    deviceID: deviceID,
                    timeoutMs: 1000,
                    reportErrors: false
                )
                if !ok {
                    self.midiQueue.async {
                        if let claim = self.transportSessionClaimsByDeviceID.removeValue(forKey: deviceID),
                           claim.source == source {
                            claim.heartbeatTimer.setEventHandler {}
                            claim.heartbeatTimer.cancel()
                        }
                        self.setError("Transport session ended for selected device")
                    }
                }
            }
        }
        transportSessionClaimsByDeviceID[deviceID] = TransportSessionClaim(
            source: source,
            hardwareUID: hardwareUIDForDeviceIDInternal(deviceID),
            heartbeatTimer: timer
        )
        timer.resume()
    }

    private func sendTransportSessionCommandInternal(
        subcommand: UInt8,
        source: UInt8,
        deviceID: String,
        timeoutMs: Int,
        reportErrors: Bool
    ) -> Bool {
        guard isTransportConnectedInternal(deviceID: deviceID) else {
            if reportErrors {
                setError("Transport session failed: selected device is not connected")
            }
            return false
        }

        let response = sendCommandInternal(
            Data([EmwOpcode.transportSession, subcommand, source]),
            timeout: timeoutMs,
            responsePredicate: { lane in
                guard let first = lane.first else { return false }
                return first == Self.responseOK || first == Self.responseErr || first == Self.responseBusy
            },
            deviceID: deviceID
        )
        guard let status = response?.first else {
            if reportErrors {
                setError("Transport session command timed out")
            }
            return false
        }
        switch status {
        case Self.responseOK:
            return true
        case Self.responseBusy:
            if reportErrors {
                setError("Device is busy with another transport session")
            }
            return false
        default:
            if reportErrors {
                setError("Device rejected transport session command")
            }
            return false
        }
    }

    private func requiresTransportSessionInternal(deviceID: String) -> Bool {
        if deviceID.hasPrefix("ble:") || deviceID.hasPrefix("wifi:") {
            return true
        }
        return Self.boardTypeRequiresTransportSession(boardTypeForDeviceIDInternal(deviceID))
    }

    private func boardTypeForDeviceIDInternal(_ deviceID: String) -> String? {
        let targetID = resolvedTransportID(for: deviceID) ?? deviceID
        if let known = boardTypeByDeviceID[targetID] {
            return known
        }
        if targetID.hasPrefix("wifi:") {
            return wifiDevices.first(where: { $0.id == targetID })?.boardType ?? "esp32"
        }
        if targetID.hasPrefix("ble:") {
            let uuidText = String(targetID.dropFirst("ble:".count))
            if let uuid = UUID(uuidString: uuidText) {
                return inferBleBoardType(name: bleDiscoveredNamesByID[uuid])
            }
            return "esp32"
        }
        if targetID.hasPrefix("midi:") {
            return displayNameFromDeviceID(targetID).map { Self.inferBoardType(portName: $0) }
        }
        if targetID.hasPrefix("serial:") {
            return boardTypeByDeviceID[targetID] ?? Self.inferSerialBoardType(path: serialPathFromDeviceID(targetID))
        }
        return nil
    }

    private func hardwareUIDForDeviceIDInternal(_ deviceID: String) -> String? {
        let targetID = resolvedTransportID(for: deviceID) ?? deviceID
        if let uid = hardwareUIDByDeviceID[targetID] {
            return uid
        }
        if targetID.hasPrefix("wifi:"),
           let uid = wifiDevices.first(where: { $0.id == targetID })?.localIdentifier,
           Self.isFullHardwareUID(uid) {
            return uid
        }
        return nil
    }

    private func transportSessionSource(for deviceID: String) -> UInt8? {
        let targetID = resolvedTransportID(for: deviceID) ?? deviceID
        if targetID.hasPrefix("midi:") {
            return EmwOpcode.transportSourceUSB
        }
        if targetID.hasPrefix("serial:") {
            return EmwOpcode.transportSourceUSB
        }
        if targetID.hasPrefix("ble:") {
            return EmwOpcode.transportSourceBLE
        }
        if targetID.hasPrefix("wifi:") {
            return EmwOpcode.transportSourceWiFi
        }
        return nil
    }

    func applyTransportDebugPreference() {
        let deviceID = midiQueue.sync { self.activeDeviceID }
        guard let deviceID else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            self.applyTransportDebugPreference(deviceID: deviceID)
        }
    }

    private func applyTransportDebugPreference(deviceID: String) {
        setTransportDebugLogging(transportDebugLoggingEnabled, deviceID: deviceID)
    }

    private func setTransportDebugLogging(_ enabled: Bool, deviceID: String) {
        let mode = enabled ? "1" : "0"
        guard let command = "debug transport \(mode)".data(using: .utf8) else { return }
        _ = sendCommandInternal(
            command,
            timeout: 1000,
            responsePredicate: { lane in
                guard let first = lane.first else { return false }
                return first == Self.responseOK || first == Self.responseErr || first == Self.responseBusy
            },
            deviceID: deviceID
        )
    }

    private func finishWiFiProvisioning(message: String, isError: Bool) {
        if isError {
            setError(message)
        }
        DispatchQueue.main.async {
            self.isWiFiProvisioning = false
            self.isWiFiProvisioningError = isError
            self.wifiProvisioningStatus = message
        }
    }

    private static func wiFiDisconnectReasonText(_ reason: UInt16) -> String {
        switch reason {
        case 0:
            return "no disconnect reason"
        case 2:
            return "auth expired"
        case 15:
            return "4-way handshake timeout"
        case 201:
            return "no access point"
        case 202:
            return "auth failed"
        case 203:
            return "association failed"
        case 204:
            return "handshake timeout"
        case 205:
            return "connection failed"
        default:
            return "reason \(reason)"
        }
    }

    static func wiFiStatusStationIP(_ response: Data) -> String? {
        guard response.count >= 12, response[7] != 0 else {
            return nil
        }
        return "\(response[8]).\(response[9]).\(response[10]).\(response[11])"
    }

    static func wiFiStatusRuntimeText(_ response: Data) -> String {
        guard response.count >= 13 else { return "idle" }
        return response[12] == 0 ? "idle" : "running"
    }

    func transmitBuffer() {
        transmitBuffer(deviceID: nil)
    }

    func transmitBuffer(deviceID: String?) {
        guard !isRuntimeReconnectSuspended() else {
            return
        }

        guard isTransportConnectedInternal() else {
            setError("Cannot transmit buffer: Not connected")
            return
        }

        guard let session = deviceSession(for: deviceID) else {
            setError("Cannot transmit buffer: No matching device session")
            return
        }

        let data = getBuffer(deviceID: deviceID)
        guard !data.isEmpty else { return }

        let targetID = resolvedTransportID(for: deviceID)
        let useWiFiPacing = targetID?.hasPrefix("wifi:") == true || (targetID == nil && activeTransport == .wifi)

        var idx = 0
        while idx < data.count {
            let end = min(idx + Self.laneSizeBytes, data.count)
            let chunk = data.subdata(in: idx..<end)
            guard let packet = Self.makePacket(chunk) else { break }
            let sf = Self.makeSuperframe(cmdLane: nil, streamLane: packet)
            withMidiQueueSync { self.sendSuperframe(sf, deviceID: deviceID) }
            idx = end
            if useWiFiPacing {
                _ = session.waitForBufferStatus(timeoutMilliseconds: 250)
            } else {
                Thread.sleep(forTimeInterval: 0.001)
            }
        }
    }

    // MARK: - MIDI internals

    private func ensureClient() {
        if client != 0 { return }

        let stClient = MIDIClientCreate(
            "emwaver-macos-midi" as CFString,
            Self.notifyProc,
            UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            &client
        )
        guard stClient == noErr else {
            setError("MIDIClientCreate failed: \(stClient)")
            return
        }

        let stIn = MIDIInputPortCreate(
            client,
            "emwaver-macos-midi-in" as CFString,
            Self.readProc,
            UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            &inPort
        )
        guard stIn == noErr else {
            setError("MIDIInputPortCreate failed: \(stIn)")
            return
        }

        let stOut = MIDIOutputPortCreate(client, "emwaver-macos-midi-out" as CFString, &outPort)
        guard stOut == noErr else {
            setError("MIDIOutputPortCreate failed: \(stOut)")
            return
        }
    }

    private struct PortCandidate {
        let name: String
        let source: MIDIEndpointRef
        let destination: MIDIEndpointRef
    }

    private func refreshPortsInternal() {
        let candidates = listPortCandidatesInternal()

        var nameCounts: [String: Int] = [:]
        nameCounts.reserveCapacity(candidates.count)

        var ports: [String] = []
        ports.reserveCapacity(candidates.count)

        var map: [String: PortCandidate] = [:]
        map.reserveCapacity(candidates.count)

        for c in candidates {
            let base = c.name
            let n = (nameCounts[base] ?? 0) + 1
            nameCounts[base] = n
            let display = (n == 1) ? base : "\(base) (\(n))"
            ports.append(display)
            map[display] = c
        }

        self.portCandidatesByDisplayName = map
        self.serialDevicePaths = listSerialRuntimeCandidatesInternal()
        publishDiscoveredDevices(ports: ports)
        DispatchQueue.main.async {
            self.availablePorts = ports
        }
    }

    private func publishDiscoveredDevices(ports: [String]? = nil) {
        let portNames = ports ?? Array(portCandidatesByDisplayName.keys).sorted()
        var devices: [LocalDeviceDescriptor] = []

        for port in portNames.sorted() {
            let id = "midi:\(port)"
            let isActive = activeTransport == .usbMidi && connectedPortName == port && isTransportConnectedInternal()
            devices.append(LocalDeviceDescriptor(
                id: id,
                displayName: port,
                transport: .usbMidi,
                boardType: boardTypeByDeviceID[id] ?? Self.inferBoardType(portName: port),
                moduleLabel: nil,
                identifierText: hardwareUIDByDeviceID[id].map { "UID \($0)" },
                connectionState: isActive ? .connected : .discovered,
                lastErrorText: nil,
                isActive: isActive
            ))
        }

        for path in serialDevicePaths.sorted() {
            let id = "serial:\(path)"
            let isActive = activeTransport == .usbSerial && connectedSerialPath == path && isTransportConnectedInternal()
            let hardwareUID = hardwareUIDByDeviceID[id]
            devices.append(LocalDeviceDescriptor(
                id: id,
                displayName: URL(fileURLWithPath: path).lastPathComponent,
                transport: .usbSerial,
                boardType: boardTypeByDeviceID[id] ?? Self.inferSerialBoardType(path: path),
                moduleLabel: path,
                identifierText: hardwareUID.map { "UID \($0)" },
                connectionState: isActive ? .connected : .discovered,
                lastErrorText: isActive || hardwareUID != nil ? nil : "Waiting for EMWaver serial probe",
                isActive: isActive
            ))
        }

        for (uuid, peripheral) in bleDiscoveredPeripheralsByID.sorted(by: { $0.key.uuidString < $1.key.uuidString }) {
            let id = "ble:\(uuid.uuidString)"
            let name = bleDiscoveredNamesByID[uuid] ?? peripheral.name ?? "EMWaver BLE"
            let isActive = activeTransport == .ble && blePeripheral?.identifier == uuid && isTransportConnectedInternal()
            let isConnected = peripheral.state == .connected && bleCommandCharacteristicsByID[uuid] != nil
            let isConnecting = peripheral.state == .connecting
            let hardwareUID = hardwareUIDByDeviceID[id]
            devices.append(LocalDeviceDescriptor(
                id: id,
                displayName: name,
                transport: .ble,
                boardType: boardTypeByDeviceID[id] ?? inferBleBoardType(name: name),
                moduleLabel: nil,
                identifierText: hardwareUID.map { "UID \($0)" },
                connectionState: isConnected ? .connected : (isConnecting ? .connecting : .discovered),
                lastErrorText: hardwareUID == nil ? "UID unavailable" : nil,
                isActive: isActive
            ))
        }

        let connectingWiFiID = wifiManager?.connectingDeviceID
        for record in wifiDevices.sorted(by: { $0.displayName < $1.displayName }) {
            let isActive = activeTransport == .wifi && wifiManager?.activeDeviceID == record.id && isTransportConnectedInternal()
            let isConnected = wifiManager?.activeDeviceID == record.id && wifiManager?.isConnected == true
            let isConnecting = record.id == connectingWiFiID
            let connectionState = Self.wiFiConnectionState(
                isActive: isActive,
                isConnected: isConnected,
                isConnecting: isConnecting
            )
            let endpoint = "\(record.host):\(record.port)"
            let detail = record.firmwareVersion.map { "\(endpoint) · FW \($0)" } ?? endpoint
            let hardwareUID = Self.isFullHardwareUID(record.localIdentifier) ? record.localIdentifier : nil
            let identifierText = hardwareUID.map { "UID \($0)" }
            let errorText: String? = {
                if let error = wifiConnectionErrorsByID[record.id] { return error }
                if identifierText == nil { return "UID unavailable" }
                return nil
            }()
            devices.append(LocalDeviceDescriptor(
                id: record.id,
                displayName: record.displayName,
                transport: .wifi,
                boardType: record.boardType ?? "esp32",
                moduleLabel: detail,
                identifierText: identifierText,
                connectionState: connectionState,
                lastErrorText: errorText,
                isActive: isActive
            ))
        }

        DispatchQueue.main.async {
            self.discoveredDevices = devices
        }
    }

    static func wiFiConnectionState(
        isActive: Bool,
        isConnected: Bool,
        isConnecting: Bool
    ) -> LocalDeviceDescriptor.ConnectionState {
        if isActive { return .connected }
        if isConnected { return .connected }
        if isConnecting { return .connecting }
        return .discovered
    }

    private static func isFullHardwareUID(_ value: String?) -> Bool {
        guard let value else { return false }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count == 12 else { return false }
        return trimmed.allSatisfy { $0.isHexDigit }
    }

    private func displayNameFromDeviceID(_ id: String) -> String? {
        let raw = String(id.dropFirst("midi:".count))
        return portCandidatesByDisplayName.keys.first(where: { $0 == raw })
    }

    private func serialPathFromDeviceID(_ id: String) -> String? {
        guard id.hasPrefix("serial:") else { return nil }
        let path = String(id.dropFirst("serial:".count))
        return serialDevicePaths.contains(path) || FileManager.default.fileExists(atPath: path) ? path : nil
    }

    private func resolvedTransportID(for deviceID: String?) -> String? {
        guard let deviceID, !deviceID.isEmpty else { return nil }
        if deviceID.hasPrefix("uid:") {
            let uid = String(deviceID.dropFirst("uid:".count))
            return hardwareUIDByDeviceID.first(where: { $0.value == uid })?.key
        }
        return deviceID
    }

    private func deviceSession(for deviceID: String?) -> MacTransportDeviceSession? {
        if DispatchQueue.getSpecific(key: midiQueueKey) != nil {
            return deviceSessionInternal(for: deviceID)
        }
        return midiQueue.sync { deviceSessionInternal(for: deviceID) }
    }

    private func deviceSessionInternal(for deviceID: String?) -> MacTransportDeviceSession? {
        let targetID = resolvedTransportID(for: deviceID) ?? activeDeviceID
        guard let targetID else { return nil }
        return deviceSessionsByID[targetID]
    }

    @discardableResult
    private func ensureDeviceSessionInternal(deviceID: String) -> MacTransportDeviceSession {
        if let session = deviceSessionsByID[deviceID] {
            return session
        }
        let session = MacTransportDeviceSession()
        deviceSessionsByID[deviceID] = session
        return session
    }

    private func connectToFirstPortInternal() {
        let candidates = listPortCandidatesInternal()
        let chosen = candidates.first(where: { $0.name.localizedCaseInsensitiveContains("emwaver") })
            ?? candidates.first(where: { !$0.name.localizedCaseInsensitiveContains("network") })
            ?? candidates.first
        guard let chosen else {
            return
        }

        let display = portCandidatesByDisplayName.first(where: { $0.value.source == chosen.source && $0.value.destination == chosen.destination })?.key
        connectInternal(candidate: chosen, displayName: display)
    }

    private func connectToFirstSerialPortInternal() {
        let paths = serialDevicePaths.isEmpty ? listSerialRuntimeCandidatesInternal() : serialDevicePaths
        guard let path = paths.first else { return }
        connectSerialInternal(path: path, makeActive: true)
    }

    private func connectToFirstAdvertisedWiFiInternal() -> Bool {
        if wifiManager?.connectingDeviceID != nil {
            return true
        }
        if let activeWiFiID = wifiManager?.activeDeviceID,
           wifiManager?.isConnected == true,
           wifiDevices.contains(where: { $0.id == activeWiFiID }) {
            return true
        }
        guard let record = wifiDevices
            .filter({ $0.isAdvertised && !suppressedAutoConnectWiFiIDs.contains($0.id) })
            .sorted(by: { $0.lastSeen > $1.lastSeen })
            .first else {
            return false
        }
        pendingAutoConnectWiFiID = record.id
        wifiConnectionErrorsByID.removeValue(forKey: record.id)
        publishDiscoveredDevices()
        guard canActivateTransportInternal(record.id) else {
            pendingAutoConnectWiFiID = nil
            return false
        }
        wifiManager?.connect(record: record)
        return true
    }

    private func pruneStaleBleDiscoveriesInternal(now: Date = Date()) {
        let staleIDs = bleDiscoveredPeripheralsByID.compactMap { uuid, peripheral -> UUID? in
            if peripheral.state == .connected || peripheral.state == .connecting {
                return nil
            }
            guard let lastSeen = bleLastSeenByID[uuid] else {
                return uuid
            }
            return now.timeIntervalSince(lastSeen) > Self.bleDiscoveryStaleIntervalSeconds ? uuid : nil
        }
        for uuid in staleIDs {
            bleDiscoveredPeripheralsByID.removeValue(forKey: uuid)
            bleDiscoveredNamesByID.removeValue(forKey: uuid)
            bleLastSeenByID.removeValue(forKey: uuid)
            hardwareUIDByDeviceID.removeValue(forKey: "ble:\(uuid.uuidString)")
        }
    }

    private func reconcileActiveTransportInternal() {
        switch activeTransport {
        case .usbMidi:
            var disconnected = false
            if connectedSource == 0 || connectedDestination == 0 {
                disconnected = true
            }
            if connectedSource != 0, isOffline(MIDIObjectRef(connectedSource)) {
                disconnected = true
            }
            if connectedDestination != 0, isOffline(MIDIObjectRef(connectedDestination)) {
                disconnected = true
            }
            if disconnected {
                disconnectMidiOnlyInternal()
                activeTransport = .none
                activeDeviceID = nil
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectedPortName = nil
                    self.deviceEmwaverVersion = nil
                    self.connectedHardwareUID = nil
                    self.connectedBoardType = nil
                    self.connectedTransportKind = nil
                }
            }
        case .usbSerial:
            let disconnected = serialFileDescriptor < 0 || connectedSerialPath == nil
            if disconnected {
                disconnectSerialOnlyInternal()
                activeTransport = .none
                activeDeviceID = nil
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectedPortName = nil
                    self.deviceEmwaverVersion = nil
                    self.connectedHardwareUID = nil
                    self.connectedBoardType = nil
                    self.connectedTransportKind = nil
                }
            }
        case .ble:
            guard let peripheral = blePeripheral else {
                activeTransport = .none
                activeDeviceID = nil
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectedPortName = nil
                    self.deviceEmwaverVersion = nil
                    self.connectedHardwareUID = nil
                    self.connectedBoardType = nil
                    self.connectedTransportKind = nil
                }
                return
            }
            let uuid = peripheral.identifier
            let ready = peripheral.state == .connected && bleCommandCharacteristicsByID[uuid] != nil
            if !ready && peripheral.state != .connecting {
                blePeripheral = nil
                bleCommandCharacteristic = nil
                bleNotifyCharacteristic = nil
                activeTransport = .none
                activeDeviceID = nil
                bleConnectedPeripheralsByID.removeValue(forKey: uuid)
                bleCommandCharacteristicsByID.removeValue(forKey: uuid)
                bleNotifyCharacteristicsByID.removeValue(forKey: uuid)
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectedPortName = nil
                    self.deviceEmwaverVersion = nil
                    self.connectedHardwareUID = nil
                    self.connectedBoardType = nil
                    self.connectedTransportKind = nil
                }
            } else {
                DispatchQueue.main.async {
                    self.isConnected = ready
                }
            }
        case .wifi:
            guard wifiManager?.isConnected == true else {
                activeTransport = .none
                activeDeviceID = nil
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectedPortName = nil
                    self.deviceEmwaverVersion = nil
                    self.connectedHardwareUID = nil
                    self.connectedBoardType = nil
                    self.connectedTransportKind = nil
                }
                return
            }
        case .none:
            break
        }
    }

    private func recordWiFiConnectionErrorIfNeeded(_ message: String) {
        let targetID = wifiManager?.connectingDeviceID ?? pendingAutoConnectWiFiID ?? (activeTransport == .wifi ? activeDeviceID : nil)
        guard let targetID, targetID.hasPrefix("wifi:") else { return }
        wifiConnectionErrorsByID[targetID] = message
        publishDiscoveredDevices()
    }

    private func recordUIDConnectionProbeCheck(at date: Date = Date()) {
        DispatchQueue.main.async {
            self.uidConnectionProbeLastChecked = date
        }
    }

    private func scheduleUIDConnectionPollsInternal() {
        guard !isRuntimeReconnectSuspendedInternal else { return }

        var deviceIDs: [String] = []
        if activeTransport == .usbMidi,
           connectedSource != 0,
           connectedDestination != 0,
           let activeDeviceID,
           activeDeviceID.hasPrefix("midi:") {
            deviceIDs.append(activeDeviceID)
        }
        if activeTransport == .usbSerial,
           serialFileDescriptor >= 0,
           let activeDeviceID,
           activeDeviceID.hasPrefix("serial:") {
            deviceIDs.append(activeDeviceID)
        }

        for (uuid, peripheral) in bleConnectedPeripheralsByID where peripheral.state == .connected {
            guard bleCommandCharacteristicsByID[uuid] != nil else { continue }
            deviceIDs.append("ble:\(uuid.uuidString)")
        }

        for deviceID in deviceIDs where !uidConnectionProbeInFlightDeviceIDs.contains(deviceID) {
            uidConnectionProbeInFlightDeviceIDs.insert(deviceID)
            DispatchQueue.global(qos: .utility).async {
                let uid = self.queryHardwareUID(timeoutMs: 1500, deviceID: deviceID)
                self.midiQueue.async {
                    self.uidConnectionProbeInFlightDeviceIDs.remove(deviceID)
                    if let uid {
                        self.hardwareUIDByDeviceID[deviceID] = uid
                        if self.activeDeviceID == deviceID {
                            DispatchQueue.main.async {
                                self.connectedHardwareUID = uid
                            }
                        }
                    }
                    self.publishDiscoveredDevices()
                }
            }
        }
    }

    private func suppressPendingAutoConnectWiFiIfNeeded(errorMessage: String) {
        guard let id = pendingAutoConnectWiFiID,
              errorMessage.localizedCaseInsensitiveContains("Wi-Fi") else {
            return
        }
        suppressedAutoConnectWiFiIDs.insert(id)
        pendingAutoConnectWiFiID = nil
    }

    private func connectInternal(portName: String) {
        if let chosen = portCandidatesByDisplayName[portName] {
            connectInternal(candidate: chosen, displayName: portName)
            return
        }

        // Fallback (shouldn't happen; display names are built from candidates).
        let candidates = listPortCandidatesInternal()
        if let chosen = candidates.first(where: { $0.name == portName }) {
            connectInternal(candidate: chosen, displayName: portName)
            return
        }

        setError("No matching port: \(portName)")
    }

    private func connectInternal(candidate: PortCandidate, displayName: String?) {
        let deviceID = "midi:\(displayName ?? candidate.name)"
        guard canActivateTransportInternal(deviceID) else {
            return
        }
        disconnectMidiOnlyInternal()
        disconnectSerialOnlyInternal()

        connectedSource = candidate.source
        connectedDestination = candidate.destination
        activeTransport = .usbMidi
        activeDeviceID = deviceID
        ensureDeviceSessionInternal(deviceID: deviceID).resetParserAndBuffers()

        let st = MIDIPortConnectSource(inPort, candidate.source, nil)
        guard st == noErr else {
            setError("MIDIPortConnectSource failed: \(st)")
            connectedSource = 0
            connectedDestination = 0
            activeTransport = .none
            activeDeviceID = nil
            return
        }

        DispatchQueue.main.async {
            self.connectedPortName = displayName ?? candidate.name
            self.isConnected = true
            self.connectedTransportKind = "USB"
            self.lastErrorText = nil
            self.deviceEmwaverVersion = nil
        }

        // Query only local runtime metadata needed for display and update guidance.
        DispatchQueue.global(qos: .userInitiated).async {
            var v = self.queryDeviceVersion(timeoutMs: 1500, deviceID: deviceID)
            if v == nil {
                Thread.sleep(forTimeInterval: 0.25)
                v = self.queryDeviceVersion(timeoutMs: 1500, deviceID: deviceID)
            }
            let uid = self.queryHardwareUID(timeoutMs: 1500, deviceID: deviceID)
            let reportedBoardType = self.queryBoardType(timeoutMs: 1500, deviceID: deviceID)
            let boardType = reportedBoardType ?? Self.inferBoardType(portName: displayName ?? candidate.name)

            DispatchQueue.main.async {
                self.deviceEmwaverVersion = v
                self.connectedHardwareUID = uid
                self.connectedBoardType = boardType
                self.lastDetectedBoardType = boardType
            }
            self.midiQueue.async {
                if let uid { self.hardwareUIDByDeviceID[deviceID] = uid }
                self.boardTypeByDeviceID[deviceID] = boardType
                self.publishDiscoveredDevices()
            }
        }
    }

    private func connectSerialInternal(path: String, makeActive: Bool) {
        let deviceID = "serial:\(path)"
        boardTypeByDeviceID[deviceID] = boardTypeByDeviceID[deviceID] ?? Self.inferSerialBoardType(path: path)
        guard canActivateTransportInternal(deviceID) else {
            return
        }
        disconnectMidiOnlyInternal()
        disconnectSerialOnlyInternal()

        let fd = open(path, O_RDWR | O_NOCTTY | O_NONBLOCK)
        guard fd >= 0 else {
            setError("USB serial open failed: \(path)")
            publishDiscoveredDevices()
            return
        }
        guard configureSerialFileDescriptor(fd) else {
            close(fd)
            setError("USB serial configuration failed: \(path)")
            publishDiscoveredDevices()
            return
        }

        serialFileDescriptor = fd
        connectedSerialPath = path
        if makeActive {
            activeTransport = .usbSerial
            activeDeviceID = deviceID
        }
        ensureDeviceSessionInternal(deviceID: deviceID).resetParserAndBuffers()

        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: midiQueue)
        source.setEventHandler { [weak self] in
            self?.readSerialAvailableBytes(deviceID: deviceID)
        }
        source.setCancelHandler {
            close(fd)
        }
        serialReadSource = source
        source.resume()

        DispatchQueue.main.async {
            if makeActive {
                self.connectedPortName = path
                self.isConnected = true
                self.connectedTransportKind = "USB Serial"
                self.connectedBoardType = self.boardTypeByDeviceID[deviceID] ?? Self.inferSerialBoardType(path: path)
                self.lastDetectedBoardType = self.connectedBoardType
                self.deviceEmwaverVersion = nil
                self.connectedHardwareUID = nil
            }
            self.lastErrorText = nil
        }
        publishDiscoveredDevices()

        DispatchQueue.global(qos: .userInitiated).async {
            var version = self.queryDeviceVersion(timeoutMs: 1500, deviceID: deviceID)
            if version == nil {
                Thread.sleep(forTimeInterval: 0.25)
                version = self.queryDeviceVersion(timeoutMs: 1500, deviceID: deviceID)
            }
            let uid = self.queryHardwareUID(timeoutMs: 1500, deviceID: deviceID)
            let reportedBoardType = self.queryBoardType(timeoutMs: 1500, deviceID: deviceID)
            let boardType = reportedBoardType ?? self.boardTypeByDeviceID[deviceID] ?? Self.inferSerialBoardType(path: path)

            self.midiQueue.async {
                guard self.connectedSerialPath == path else { return }
                if version == nil && uid == nil && reportedBoardType == nil {
                    self.disconnectSerialOnlyInternal()
                    if self.activeDeviceID == deviceID {
                        self.activeTransport = .none
                        self.activeDeviceID = nil
                    }
                    DispatchQueue.main.async {
                        if self.connectedPortName == path {
                            self.isConnected = false
                            self.connectedPortName = nil
                            self.deviceEmwaverVersion = nil
                            self.connectedHardwareUID = nil
                            self.connectedBoardType = nil
                            self.connectedTransportKind = nil
                        }
                    }
                    self.publishDiscoveredDevices()
                    return
                }
                if let uid { self.hardwareUIDByDeviceID[deviceID] = uid }
                self.boardTypeByDeviceID[deviceID] = boardType
                DispatchQueue.main.async {
                    if self.activeDeviceID == deviceID {
                        self.deviceEmwaverVersion = version
                        self.connectedHardwareUID = uid
                        self.connectedBoardType = boardType
                        self.lastDetectedBoardType = boardType
                        self.isConnected = true
                        self.connectedTransportKind = "USB Serial"
                    }
                }
                self.publishDiscoveredDevices()
            }
        }
    }

    private func disconnectInternal() {
        clearTransportSessionClaimsInternal(sendDisconnect: true)
        if connectedSource != 0 {
            _ = MIDIPortDisconnectSource(inPort, connectedSource)
        }
        connectedSource = 0
        connectedDestination = 0
        disconnectSerialOnlyInternal()
        activeTransport = .none
        activeDeviceID = nil

        for peripheral in bleConnectedPeripheralsByID.values {
            bleCentral?.cancelPeripheralConnection(peripheral)
        }
        bleConnectedPeripheralsByID.removeAll()
        bleCommandCharacteristicsByID.removeAll()
        bleNotifyCharacteristicsByID.removeAll()
        bleIdentityProbePeripheralIDs.removeAll()
        bleDiscoveredPeripheralsByID.removeAll()
        bleDiscoveredNamesByID.removeAll()
        bleLastSeenByID.removeAll()
        blePeripheral = nil
        bleCommandCharacteristic = nil
        bleNotifyCharacteristic = nil
        wifiManager?.disconnect()

        DispatchQueue.main.async {
            self.isConnected = false
            self.connectedPortName = nil
            self.deviceEmwaverVersion = nil
            self.connectedHardwareUID = nil
            self.connectedBoardType = nil
            self.connectedTransportKind = nil
        }
        publishDiscoveredDevices()
    }

    private func queryHardwareUID(timeoutMs: Int, deviceID: String? = nil) -> String? {
        recordUIDConnectionProbeCheck()
        let resp = sendCommandInternal(
            Data([EmwOpcode.hardwareUID]),
            timeout: timeoutMs,
            responsePredicate: { lane64 in
                guard lane64.count >= 7 else { return false }
                guard lane64[0] == 0x80 else { return false }
                return lane64.dropFirst(1).contains(where: { $0 != 0 })
            },
            deviceID: deviceID
        )
        guard let resp, resp.count >= 7, resp[0] == 0x80 else { return nil }
        let payload = resp.dropFirst(1)
        let significantLength = payload.lastIndex(where: { $0 != 0 }).map { payload.distance(from: payload.startIndex, to: $0) + 1 } ?? 0
        guard significantLength == 6 else { return nil }
        return payload.prefix(significantLength).map { String(format: "%02x", $0) }.joined()
    }

    private func queryDeviceVersion(timeoutMs: Int, deviceID: String? = nil) -> String? {
        // Opcode 0x01 is "VERSION". Expected response lane: [0x80, major, minor, patch, 0...]
        let resp = sendCommandInternal(
            Data([EmwOpcode.version]),
            timeout: timeoutMs,
            responsePredicate: { lane64 in
                if lane64.count < 4 { return false }
                if lane64[0] != 0x80 { return false }
                return !lane64.dropFirst(4).contains(where: { $0 != 0 })
            },
            deviceID: deviceID
        )
        guard let resp else { return nil }
        if resp.count < 4 { return nil }
        if resp[0] != 0x80 { return nil }
        if resp.dropFirst(4).contains(where: { $0 != 0 }) { return nil }
        return "\(resp[1]).\(resp[2]).\(resp[3])"
    }

    private func queryBoardType(timeoutMs: Int, deviceID: String? = nil) -> String? {
        let resp = sendCommandInternal(
            Data([EmwOpcode.board]),
            timeout: timeoutMs,
            responsePredicate: { lane in
                lane.first == Self.responseOK || lane.first == Self.responseErr
            },
            deviceID: deviceID
        )
        guard let resp, resp.first == Self.responseOK else { return nil }
        let bytes = resp.dropFirst().prefix { $0 != 0 }
        guard !bytes.isEmpty else { return nil }
        return String(data: Data(bytes), encoding: .utf8)
    }

    private func listPortCandidatesInternal() -> [PortCandidate] {
        let sources = allSources()
        let dests = allDestinations()

        var out: [PortCandidate] = []
        out.reserveCapacity(min(sources.count, dests.count))

        for d in dests {
            let dEntity = entityName(for: d.endpoint)
            if let s = sources.first(where: { entityName(for: $0.endpoint) == dEntity }) {
                out.append(PortCandidate(name: dEntity ?? d.name, source: s.endpoint, destination: d.endpoint))
            }
        }

        if out.isEmpty {
            let common = Set(sources.map { $0.name }).intersection(Set(dests.map { $0.name }))
            for name in common.sorted() {
                if let s = sources.first(where: { $0.name == name }), let d = dests.first(where: { $0.name == name }) {
                    out.append(PortCandidate(name: name, source: s.endpoint, destination: d.endpoint))
                }
            }
        }

        return out
    }

    private func allSources() -> [(name: String, endpoint: MIDIEndpointRef)] {
        var out: [(String, MIDIEndpointRef)] = []
        let n = MIDIGetNumberOfSources()
        out.reserveCapacity(Int(n))
        for i in 0..<n {
            let ep = MIDIGetSource(i)
            if ep != 0, !isOffline(MIDIObjectRef(ep)) { out.append((endpointDisplayName(ep), ep)) }
        }
        return out
    }

    private func allDestinations() -> [(name: String, endpoint: MIDIEndpointRef)] {
        var out: [(String, MIDIEndpointRef)] = []
        let n = MIDIGetNumberOfDestinations()
        out.reserveCapacity(Int(n))
        for i in 0..<n {
            let ep = MIDIGetDestination(i)
            if ep != 0, !isOffline(MIDIObjectRef(ep)) { out.append((endpointDisplayName(ep), ep)) }
        }
        return out
    }

    private func endpointDisplayName(_ ep: MIDIEndpointRef) -> String {
        if let s = getStringProperty(MIDIObjectRef(ep), kMIDIPropertyDisplayName) {
            return s.replacingOccurrences(of: "USB MIDI", with: "USB")
        }
        if let s = getStringProperty(MIDIObjectRef(ep), kMIDIPropertyName) {
            return s.replacingOccurrences(of: "USB MIDI", with: "USB")
        }
        return "USB \(ep)"
    }

    private func entityName(for ep: MIDIEndpointRef) -> String? {
        var entity: MIDIEntityRef = 0
        guard MIDIEndpointGetEntity(ep, &entity) == noErr, entity != 0 else { return nil }
        return getStringProperty(MIDIObjectRef(entity), kMIDIPropertyName)
    }

    private func getStringProperty(_ obj: MIDIObjectRef, _ key: CFString) -> String? {
        var unmanaged: Unmanaged<CFString>?
        let st = MIDIObjectGetStringProperty(obj, key, &unmanaged)
        guard st == noErr, let unmanaged else { return nil }
        return unmanaged.takeRetainedValue() as String
    }

    private func isOffline(_ obj: MIDIObjectRef) -> Bool {
        var value: Int32 = 0
        let st = MIDIObjectGetIntegerProperty(obj, kMIDIPropertyOffline, &value)
        return st == noErr && value != 0
    }

    private static func makeSuperframe(cmdLane: Data?, streamLane: Data?) -> Data {
        var sf = Data(repeating: 0, count: superframeSizeBytes)
        if let c = cmdLane {
            let len = min(c.count, laneSizeBytes)
            if len > 0 { sf.replaceSubrange(0..<len, with: c.prefix(len)) }
        }
        if let s = streamLane {
            let len = min(s.count, laneSizeBytes)
            if len > 0 { sf.replaceSubrange(laneSizeBytes..<(laneSizeBytes + len), with: s.prefix(len)) }
        }
        return sf
    }

    private func sendSuperframe(_ superframe: Data) {
        sendSuperframe(superframe, deviceID: nil)
    }

    private func sendSuperframe(_ superframe: Data, deviceID: String?) {
        guard let sysex = UsbMidiSysex.encodeSuperframe(superframe) else {
            setError("SysEx encode failed")
            return
        }

        let targetID = resolvedTransportID(for: deviceID)
        if targetID?.hasPrefix("ble:") == true || (targetID == nil && activeTransport == .ble) {
            let targetPeripheral: CBPeripheral?
            if let targetID, let uuid = UUID(uuidString: String(targetID.dropFirst("ble:".count))) {
                targetPeripheral = bleConnectedPeripheralsByID[uuid] ?? bleDiscoveredPeripheralsByID[uuid]
            } else {
                targetPeripheral = blePeripheral
            }
            guard let peripheral = targetPeripheral,
                  peripheral.state == .connected,
                  let characteristic = bleCommandCharacteristicsByID[peripheral.identifier] ?? bleCommandCharacteristic else {
                setError("BLE write failed: Not connected")
                return
            }
            let writeType: CBCharacteristicWriteType = characteristic.properties.contains(.writeWithoutResponse)
                ? .withoutResponse
                : .withResponse
            peripheral.writeValue(sysex, for: characteristic, type: writeType)
            return
        }

        if targetID?.hasPrefix("wifi:") == true || (targetID == nil && activeTransport == .wifi) {
            guard wifiManager?.isConnected == true else {
                setError("Wi-Fi write failed: Not connected")
                return
            }
            wifiManager?.send(sysex)
            return
        }

        if targetID?.hasPrefix("serial:") == true || (targetID == nil && activeTransport == .usbSerial) {
            guard writeSerialBytes(sysex) else {
                setError("USB serial write failed")
                return
            }
            return
        }

        let st = sendSysex(sysex, to: connectedDestination)
        if st != noErr {
            setError("MIDISend failed: \(st)")
        }
    }

    private func sendSysex(_ sysex: Data, to destination: MIDIEndpointRef) -> OSStatus {
        let capacity = 1024
        let raw = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { raw.deallocate() }

        let pktList = raw.assumingMemoryBound(to: MIDIPacketList.self)
        let packet = MIDIPacketListInit(pktList)

        let ok: Bool = sysex.withUnsafeBytes { bytes in
            guard let base = bytes.bindMemory(to: UInt8.self).baseAddress else { return false }
            MIDIPacketListAdd(pktList, capacity, packet, 0, sysex.count, base)
            return true
        }
        guard ok else { return -1 }
        return MIDISend(outPort, destination, pktList)
    }

    private static func makePacket(_ data: Data) -> Data? {
        if data.count > laneSizeBytes { return nil }
        if data.count == laneSizeBytes { return data }
        var out = Data(repeating: 0, count: laneSizeBytes)
        out.replaceSubrange(0..<data.count, with: data)
        return out
    }

    private func handleMidiBytes(_ data: Data, deviceID: String?) {
        guard let session = deviceSession(for: deviceID) else { return }
        let normalized = normalizeIncomingMidiBytes(data)
        session.handleMidiBytes(
            normalized,
            laneSizeBytes: Self.laneSizeBytes,
            superframeSizeBytes: Self.superframeSizeBytes
        )
    }

    private func startBleScanInternal(allowWhenAutoConnectDisabled: Bool = false) {
        guard !isRuntimeReconnectSuspendedInternal else { return }
        guard allowWhenAutoConnectDisabled || autoConnectEnabled else { return }
        guard bleCentral?.state == .poweredOn else {
            stopBleScanInternal()
            return
        }
        bleCentral?.scanForPeripherals(
            withServices: nil,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
        )
        DispatchQueue.main.async {
            self.isBleScanning = true
        }
    }

    private func stopBleScanInternal() {
        bleCentral?.stopScan()
        DispatchQueue.main.async {
            self.isBleScanning = false
        }
    }

    private func handleWiFiConnected(_ record: MacWiFiDeviceRecord) {
        print("[Wi-Fi] connected id=\(record.id) host=\(record.host) port=\(record.port)")
        let shouldBecomeActive = activeTransport == .none || pendingAutoConnectWiFiID != record.id
        let currentUID = Self.isFullHardwareUID(record.localIdentifier) ? record.localIdentifier : nil
        if shouldBecomeActive {
            activeTransport = .wifi
            activeDeviceID = record.id
        }
        pendingAutoConnectWiFiID = nil
        suppressedAutoConnectWiFiIDs.remove(record.id)
        wifiConnectionErrorsByID.removeValue(forKey: record.id)
        boardTypeByDeviceID[record.id] = record.boardType ?? "esp32"
        ensureDeviceSessionInternal(deviceID: record.id).resetParserAndBuffers()

        DispatchQueue.main.async {
            if shouldBecomeActive {
                self.connectedPortName = "\(record.host):\(record.port)"
                self.connectedBoardType = record.boardType ?? "esp32"
                self.connectedTransportKind = "Wi-Fi"
            }
            self.lastDetectedBoardType = record.boardType ?? "esp32"
            self.lastErrorText = nil
            if shouldBecomeActive {
                self.deviceEmwaverVersion = nil
                self.connectedHardwareUID = currentUID
            }
            self.isConnected = true
        }
        publishDiscoveredDevices()

        DispatchQueue.global(qos: .userInitiated).async {
            print("[Wi-Fi] probing version id=\(record.id)")
            let version = self.queryDeviceVersion(timeoutMs: 2000, deviceID: record.id)
            print("[Wi-Fi] probe result id=\(record.id) version=\(version ?? "nil") uid=\(currentUID ?? "nil")")

            DispatchQueue.main.async {
                if shouldBecomeActive {
                    self.deviceEmwaverVersion = version
                    self.connectedHardwareUID = currentUID
                }
            }
            self.midiQueue.async {
                self.publishDiscoveredDevices()
            }
        }
    }

    private func handleWiFiDisconnected(deviceID: String?) {
        guard activeTransport == .wifi else {
            publishDiscoveredDevices()
            return
        }
        if let deviceID, activeDeviceID != deviceID {
            publishDiscoveredDevices()
            return
        }
        activeTransport = .none
        activeDeviceID = nil
        if let deviceID {
            hardwareUIDByDeviceID.removeValue(forKey: deviceID)
            wifiConnectionErrorsByID.removeValue(forKey: deviceID)
        }
        DispatchQueue.main.async {
            self.isConnected = false
            self.connectedPortName = nil
            self.connectedTransportKind = nil
            self.connectedBoardType = nil
            self.deviceEmwaverVersion = nil
            self.connectedHardwareUID = nil
        }
        publishDiscoveredDevices()
    }

    private func disconnectMidiOnlyInternal() {
        if connectedSource != 0 {
            _ = MIDIPortDisconnectSource(inPort, connectedSource)
        }
        connectedSource = 0
        connectedDestination = 0
    }

    private func disconnectSerialOnlyInternal() {
        let source = serialReadSource
        serialReadSource = nil
        serialFileDescriptor = -1
        connectedSerialPath = nil
        source?.setEventHandler {}
        source?.cancel()
    }

    private func listSerialRuntimeCandidatesInternal() -> [String] {
        let devURL = URL(fileURLWithPath: "/dev", isDirectory: true)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: devURL.path) else {
            return []
        }
        return names
            .filter { $0.hasPrefix("cu.") }
            .map { devURL.appendingPathComponent($0).path }
            .filter { Self.isSupportedSerialRuntimePath($0) }
            .sorted()
    }

    static func isSupportedSerialRuntimePath(_ path: String) -> Bool {
        let lowercased = path.lowercased()
        return lowercased.contains("usbserial") ||
            lowercased.contains("usbmodem") ||
            lowercased.contains("slab_usbtouart") ||
            lowercased.contains("wchusbserial") ||
            lowercased.contains("ch340") ||
            lowercased.contains("ch341") ||
            lowercased.contains("ch343") ||
            lowercased.contains("ch910") ||
            lowercased.contains("cp210")
    }

    private func configureSerialFileDescriptor(_ fd: Int32) -> Bool {
        var options = termios()
        guard tcgetattr(fd, &options) == 0 else { return false }
        cfmakeraw(&options)
        guard cfsetspeed(&options, speed_t(B115200)) == 0 else { return false }
        options.c_cflag |= tcflag_t(CLOCAL | CREAD)
        options.c_cflag &= ~tcflag_t(PARENB | CSTOPB | CSIZE)
        options.c_cflag |= tcflag_t(CS8)
        #if os(macOS)
        options.c_cflag &= ~tcflag_t(CRTSCTS)
        #endif
        withUnsafeMutableBytes(of: &options.c_cc) { cc in
            cc[Int(VMIN)] = 0
            cc[Int(VTIME)] = 1
        }
        guard tcsetattr(fd, TCSANOW, &options) == 0 else { return false }
        tcflush(fd, TCIOFLUSH)
        return true
    }

    private func readSerialAvailableBytes(deviceID: String) {
        let fd = serialFileDescriptor
        guard fd >= 0 else { return }
        var buffer = [UInt8](repeating: 0, count: 512)
        let bufferCount = buffer.count
        while serialFileDescriptor == fd {
            let count = buffer.withUnsafeMutableBytes { rawBuffer in
                Darwin.read(fd, rawBuffer.baseAddress, bufferCount)
            }
            if count > 0 {
                handleMidiBytes(Data(buffer.prefix(count)), deviceID: deviceID)
                continue
            }
            if count == 0 {
                return
            }
            if errno == EAGAIN || errno == EWOULDBLOCK {
                return
            }
            setError("USB serial read failed")
            disconnectSerialOnlyInternal()
            if activeDeviceID == deviceID {
                activeTransport = .none
                activeDeviceID = nil
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectedPortName = nil
                    self.deviceEmwaverVersion = nil
                    self.connectedHardwareUID = nil
                    self.connectedBoardType = nil
                    self.connectedTransportKind = nil
                }
            }
            publishDiscoveredDevices()
            return
        }
    }

    private func writeSerialBytes(_ data: Data) -> Bool {
        let fd = serialFileDescriptor
        guard fd >= 0 else { return false }
        var offset = 0
        return data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return false }
            while offset < data.count {
                let written = Darwin.write(
                    fd,
                    base.advanced(by: offset),
                    data.count - offset
                )
                if written > 0 {
                    offset += written
                    continue
                }
                if written == 0 {
                    return false
                }
                if errno == EAGAIN || errno == EWOULDBLOCK {
                    usleep(1000)
                    continue
                }
                return false
            }
            return true
        }
    }

    private func connectBleInternal(_ peripheral: CBPeripheral, name: String?, makeActive: Bool = true) {
        let deviceID = "ble:\(peripheral.identifier.uuidString)"
        let initialBoardType = inferBleBoardType(name: name ?? peripheral.name)
        boardTypeByDeviceID[deviceID] = initialBoardType
        if makeActive {
            guard canActivateTransportInternal(deviceID) else {
                return
            }
            disconnectMidiOnlyInternal()
            bleIdentityProbePeripheralIDs.remove(peripheral.identifier)
            blePeripheral = peripheral
            bleCommandCharacteristic = bleCommandCharacteristicsByID[peripheral.identifier]
            bleNotifyCharacteristic = bleNotifyCharacteristicsByID[peripheral.identifier]
            activeDeviceID = deviceID
        } else {
            bleIdentityProbePeripheralIDs.insert(peripheral.identifier)
        }
        ensureDeviceSessionInternal(deviceID: deviceID)
        peripheral.delegate = self
        if peripheral.state == .connected {
            if makeActive {
                activeTransport = .ble
            }
            DispatchQueue.main.async {
                if makeActive {
                    self.isConnected = self.bleCommandCharacteristicsByID[peripheral.identifier] != nil
                }
            }
        } else if peripheral.state != .connecting {
            bleCentral?.connect(peripheral, options: nil)
        }
        DispatchQueue.main.async {
            if makeActive {
                self.connectedPortName = name ?? peripheral.name ?? "EMWaver BLE"
                self.connectedBoardType = initialBoardType
                self.connectedTransportKind = "BLE"
                self.lastErrorText = nil
            }
            self.lastDetectedBoardType = initialBoardType
        }
        publishDiscoveredDevices()
    }

    private func isEmwaverBleAdvertisement(
        peripheral: CBPeripheral,
        advertisementData: [String: Any]
    ) -> Bool {
        if let serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID],
           serviceUUIDs.contains(Self.bleServiceUUID) {
            return true
        }

        if let overflowServiceUUIDs = advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID],
           overflowServiceUUIDs.contains(Self.bleServiceUUID) {
            return true
        }

        let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let candidateName = advertisedName ?? peripheral.name
        return candidateName?.localizedCaseInsensitiveContains("EMWaver") == true
    }

    /// Some stacks surface USB-MIDI 4-byte event packets (header + 3 bytes).
    /// Best-effort unpack them back into raw MIDI bytes.
    private func normalizeIncomingMidiBytes(_ data: Data) -> Data {
        guard data.count >= 4, data.count % 4 == 0 else { return data }

        let groups = min(data.count / 4, 16)
        var sysExCinCount = 0
        var hasSysexByte = false

        for g in 0..<groups {
            let h = data[g * 4]
            let cin = h & 0x0F
            if cin >= 0x4 && cin <= 0x7 { sysExCinCount += 1 }
            let b0 = data[g * 4 + 1]
            let b1 = data[g * 4 + 2]
            let b2 = data[g * 4 + 3]
            if b0 == 0xF0 || b0 == 0xF7 || b1 == 0xF0 || b1 == 0xF7 || b2 == 0xF0 || b2 == 0xF7 {
                hasSysexByte = true
            }
        }

        guard hasSysexByte, sysExCinCount >= max(2, groups / 2) else { return data }

        var out = Data()
        out.reserveCapacity(data.count)

        for i in stride(from: 0, to: data.count, by: 4) {
            let cin = data[i] & 0x0F
            let b0 = data[i + 1]
            let b1 = data[i + 2]
            let b2 = data[i + 3]

            switch cin {
            case 0x4, 0x7:
                out.append(b0)
                out.append(b1)
                out.append(b2)
            case 0x6:
                out.append(b0)
                out.append(b1)
            case 0x5:
                out.append(b0)
            default:
                out.append(b0)
                out.append(b1)
                out.append(b2)
            }
        }

        return out
    }

    private func setError(_ msg: String) {
        NSLog("EMWaver transport error: %@", msg)
        DispatchQueue.main.async {
            self.lastErrorText = msg
        }
    }

    // MARK: - CoreMIDI callbacks

    private static let notifyProc: MIDINotifyProc = { _, refCon in
        guard let refCon else { return }
        let mgr = Unmanaged<MacUSBManager>.fromOpaque(refCon).takeUnretainedValue()
        mgr.midiQueue.async {
            if mgr.connectedSource != 0, mgr.isOffline(MIDIObjectRef(mgr.connectedSource)) {
                mgr.disconnectInternal()
            }
            if mgr.connectedDestination != 0, mgr.isOffline(MIDIObjectRef(mgr.connectedDestination)) {
                mgr.disconnectInternal()
            }
            mgr.refreshPortsInternal()
            mgr.autoConnectIfNeededInternal()
        }
    }

    private static let readProc: MIDIReadProc = { pktList, refCon, _ in
        guard let refCon else { return }
        let mgr = Unmanaged<MacUSBManager>.fromOpaque(refCon).takeUnretainedValue()

        let packetCount = Int(pktList.pointee.numPackets)
        var packets: [Data] = []
        packets.reserveCapacity(packetCount)

        let pktListMut = UnsafeMutablePointer(mutating: pktList)
        var packetPtr: UnsafePointer<MIDIPacket> = withUnsafePointer(to: &pktListMut.pointee.packet) { ptr in
            UnsafePointer(ptr)
        }

        for _ in 0..<packetCount {
            let len = Int(packetPtr.pointee.length)
            let data = withUnsafeBytes(of: packetPtr.pointee.data) { raw in
                Data(raw.prefix(min(len, raw.count)))
            }
            packets.append(data)
            packetPtr = UnsafePointer(MIDIPacketNext(packetPtr))
        }

        mgr.midiQueue.async {
            for p in packets {
                mgr.handleMidiBytes(p, deviceID: mgr.activeDeviceID)
            }
        }
    }
}

extension MacUSBManager: CBCentralManagerDelegate, CBPeripheralDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        midiQueue.async {
            DispatchQueue.main.async {
                self.bluetoothStateText = Self.bluetoothStateDescription(central.state)
            }
            if central.state == .poweredOn {
                self.autoConnectIfNeededInternal()
            } else {
                self.stopBleScanInternal()
                if case .ble = self.activeTransport {
                    self.disconnectInternal()
                    self.setError("Bluetooth unavailable")
                }
            }
        }
    }

    private static func bluetoothStateDescription(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOn:
            return "On"
        case .poweredOff:
            return "Off"
        case .unauthorized:
            return "Not authorized"
        case .unsupported:
            return "Unsupported"
        case .resetting:
            return "Resetting"
        case .unknown:
            return "Starting"
        @unknown default:
            return "Unknown"
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        guard isEmwaverBleAdvertisement(peripheral: peripheral, advertisementData: advertisementData) else {
            return
        }

        let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = localName ?? peripheral.name ?? "EMWaver BLE"
        bleDiscoveredNamesByID[peripheral.identifier] = name
        bleDiscoveredPeripheralsByID[peripheral.identifier] = peripheral
        bleLastSeenByID[peripheral.identifier] = Date()
        publishDiscoveredDevices()
        guard autoConnectEnabled,
              !isRuntimeReconnectSuspendedInternal,
              peripheral.state != .connected,
              peripheral.state != .connecting else { return }
        NSLog("EMWaver BLE discovered: %@ rssi=%@", name, RSSI)
        connectBleInternal(peripheral, name: name, makeActive: activeTransport == .none || activeTransport == .wifi)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        bleConnectedPeripheralsByID[peripheral.identifier] = peripheral
        let deviceID = "ble:\(peripheral.identifier.uuidString)"
        let initialBoardType = inferBleBoardType(name: bleDiscoveredNamesByID[peripheral.identifier] ?? peripheral.name)
        boardTypeByDeviceID[deviceID] = initialBoardType
        ensureDeviceSessionInternal(deviceID: deviceID)
        let shouldBecomeActive = !bleIdentityProbePeripheralIDs.contains(peripheral.identifier) &&
            (blePeripheral == nil || blePeripheral == peripheral)
        if shouldBecomeActive {
            blePeripheral = peripheral
            activeTransport = .ble
            activeDeviceID = deviceID
        }
        peripheral.discoverServices([Self.bleServiceUUID])
        DispatchQueue.main.async {
            if shouldBecomeActive {
                self.connectedPortName = self.bleDiscoveredNamesByID[peripheral.identifier] ?? peripheral.name ?? "EMWaver BLE"
                self.connectedBoardType = initialBoardType
                self.connectedTransportKind = "BLE"
                self.lastErrorText = nil
            }
            self.lastDetectedBoardType = initialBoardType
        }
        publishDiscoveredDevices()
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if blePeripheral == peripheral {
            blePeripheral = nil
            bleCommandCharacteristic = nil
            bleNotifyCharacteristic = nil
            activeTransport = .none
            activeDeviceID = nil
        }
        bleConnectedPeripheralsByID.removeValue(forKey: peripheral.identifier)
        bleCommandCharacteristicsByID.removeValue(forKey: peripheral.identifier)
        bleNotifyCharacteristicsByID.removeValue(forKey: peripheral.identifier)
        bleIdentityProbePeripheralIDs.remove(peripheral.identifier)
        bleDiscoveredPeripheralsByID.removeValue(forKey: peripheral.identifier)
        bleDiscoveredNamesByID.removeValue(forKey: peripheral.identifier)
        bleLastSeenByID.removeValue(forKey: peripheral.identifier)
        setError(error?.localizedDescription ?? "BLE connection failed")
        publishDiscoveredDevices()
        autoConnectIfNeededInternal()
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        bleConnectedPeripheralsByID.removeValue(forKey: peripheral.identifier)
        bleCommandCharacteristicsByID.removeValue(forKey: peripheral.identifier)
        bleNotifyCharacteristicsByID.removeValue(forKey: peripheral.identifier)
        bleIdentityProbePeripheralIDs.remove(peripheral.identifier)
        bleDiscoveredPeripheralsByID.removeValue(forKey: peripheral.identifier)
        bleDiscoveredNamesByID.removeValue(forKey: peripheral.identifier)
        bleLastSeenByID.removeValue(forKey: peripheral.identifier)
        if blePeripheral == peripheral {
            blePeripheral = nil
            bleCommandCharacteristic = nil
            bleNotifyCharacteristic = nil
            activeTransport = .none
            activeDeviceID = nil
            DispatchQueue.main.async {
                self.isConnected = false
                self.connectedPortName = nil
                self.deviceEmwaverVersion = nil
                self.connectedHardwareUID = nil
                self.connectedBoardType = nil
                self.connectedTransportKind = nil
            }
        }
        publishDiscoveredDevices()
        if autoConnectEnabled {
            startBleScanInternal()
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            setError("BLE service discovery failed: \(error.localizedDescription)")
            return
        }
        peripheral.services?
            .filter { $0.uuid == Self.bleServiceUUID }
            .forEach {
                peripheral.discoverCharacteristics(
                    [Self.bleCommandUUID, Self.bleNotifyUUID],
                    for: $0
                )
            }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error {
            setError("BLE characteristic discovery failed: \(error.localizedDescription)")
            return
        }

        for characteristic in service.characteristics ?? [] {
            if characteristic.uuid == Self.bleCommandUUID {
                bleCommandCharacteristicsByID[peripheral.identifier] = characteristic
                if blePeripheral == peripheral { bleCommandCharacteristic = characteristic }
            } else if characteristic.uuid == Self.bleNotifyUUID {
                bleNotifyCharacteristicsByID[peripheral.identifier] = characteristic
                if blePeripheral == peripheral { bleNotifyCharacteristic = characteristic }
                peripheral.setNotifyValue(true, for: characteristic)
            }
        }

        if bleCommandCharacteristicsByID[peripheral.identifier] != nil {
            let deviceID = "ble:\(peripheral.identifier.uuidString)"
            DispatchQueue.global(qos: .userInitiated).async {
                let version = self.queryDeviceVersion(timeoutMs: 2000, deviceID: deviceID)
                let uid = self.queryHardwareUID(timeoutMs: 2000, deviceID: deviceID)
                let reportedBoardType = self.queryBoardType(timeoutMs: 2000, deviceID: deviceID)
                let boardType = reportedBoardType ?? self.inferBleBoardType(
                    name: self.bleDiscoveredNamesByID[peripheral.identifier] ?? peripheral.name
                )
                DispatchQueue.main.async {
                    if self.activeDeviceID == deviceID {
                        self.isConnected = true
                        self.deviceEmwaverVersion = version
                        self.connectedHardwareUID = uid
                        self.connectedBoardType = boardType
                        self.connectedTransportKind = "BLE"
                    }
                    self.lastDetectedBoardType = boardType
                }
                self.midiQueue.async {
                    if let uid { self.hardwareUIDByDeviceID[deviceID] = uid }
                    self.boardTypeByDeviceID[deviceID] = boardType
                    self.publishDiscoveredDevices()
                }
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, characteristic.uuid == Self.bleNotifyUUID, let value = characteristic.value else {
            return
        }
        midiQueue.async {
            self.handleMidiBytes(value, deviceID: "ble:\(peripheral.identifier.uuidString)")
        }
    }
}
