/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Combine
import CoreBluetooth
import CoreMIDI
import Foundation

import EMWaverScriptRuntime
import EMWaverTransport

struct LocalDeviceDescriptor: Identifiable, Equatable {
    enum TransportKind: String {
        case ble = "BLE"
        case usbMidi = "USB"
        case wifi = "Wi-Fi"
    }

    enum ConnectionState: String {
        case discovered
        case connecting
        case connected
    }

    let id: String
    var displayName: String
    var transport: TransportKind
    var boardType: String?
    var moduleLabel: String?
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

            let keepEmptyStream = bufferQueue.sync { isSamplerStreamingActive }
            if !streamEmpty || keepEmptyStream {
                storeRxLane(streamLane)
            }
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
    // Mini-frame: 18B cmd lane + 18B stream lane.
    private static let laneSizeBytes: Int = 18
    private static let superframeSizeBytes: Int = 36

    private enum EmwOpcode {
        static let version: UInt8 = 0x01
        static let enterDfu: UInt8 = 0x06
        static let hardwareUID: UInt8 = 0x08
        static let wifiConfig: UInt8 = 0x0A
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
        static let wifiFieldSecret: UInt8 = 0x02
        static let wifiFieldHostname: UInt8 = 0x03
    }

    @Published var isConnected: Bool = false
    @Published var connectedPortName: String? = nil
    @Published var availablePorts: [String] = []
    @Published var discoveredDevices: [LocalDeviceDescriptor] = []
    @Published var lastErrorText: String? = nil
    @Published var deviceEmwaverVersion: String? = nil
    @Published var connectedHardwareUID: String? = nil
    @Published var autoConnectEnabled: Bool = true {
        didSet {
            if autoConnectEnabled {
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
    @Published var isWiFiProvisioning: Bool = false

    private enum ActiveTransport {
        case none
        case usbMidi
        case ble
        case wifi
    }

    private static let bleServiceUUID = CBUUID(string: "45C7158E-0C3B-4E90-A847-452A15B14191")
    private static let bleCommandUUID = CBUUID(string: "46C7158E-0C3B-4E90-A847-452A15B14191")
    private static let bleNotifyUUID = CBUUID(string: "47C7158E-0C3B-4E90-A847-452A15B14191")

    private let midiQueue = DispatchQueue(label: "com.emwaver.macos.midi", qos: .userInitiated)

    private let midiQueueKey = DispatchSpecificKey<Void>()

    private var client: MIDIClientRef = 0
    private var inPort: MIDIPortRef = 0
    private var outPort: MIDIPortRef = 0

    private var connectedSource: MIDIEndpointRef = 0
    private var connectedDestination: MIDIEndpointRef = 0
    private var activeTransport: ActiveTransport = .none

    private var portCandidatesByDisplayName: [String: PortCandidate] = [:]
    private var hardwareUIDByDeviceID: [String: String] = [:]
    private var bleDiscoveredPeripheralsByID: [UUID: CBPeripheral] = [:]
    private var deviceSessionsByID: [String: MacTransportDeviceSession] = [:]
    private var activeDeviceID: String?
    private var wifiDevices: [MacWiFiDeviceRecord] = []
    private var wifiManager: MacWiFiManager?

    private var bleCentral: CBCentralManager?
    private var blePeripheral: CBPeripheral?
    private var bleCommandCharacteristic: CBCharacteristic?
    private var bleNotifyCharacteristic: CBCharacteristic?
    private var bleConnectedPeripheralsByID: [UUID: CBPeripheral] = [:]
    private var bleCommandCharacteristicsByID: [UUID: CBCharacteristic] = [:]
    private var bleNotifyCharacteristicsByID: [UUID: CBCharacteristic] = [:]
    private var bleDiscoveredNamesByID: [UUID: String] = [:]

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
                    self?.wifiDevices = records
                    self?.publishDiscoveredDevices()
                }
            },
            onData: { [weak self] data, deviceID in
                self?.midiQueue.async {
                    self?.handleMidiBytes(data, deviceID: deviceID)
                }
            },
            onError: { [weak self] message in
                self?.setError(message)
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
            }
        )
        self.wifiManager?.startDiscovery()
        midiQueue.async {
            self.refreshPortsInternal()
            self.autoConnectIfNeededInternal()
        }
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

    private func inferBoardType(portName: String?) -> String {
        let name = (portName ?? "").lowercased()
        if name.contains("esp32") || name.contains("s3") || name.contains("ble") {
            return "esp32s3"
        }
        if name.contains("emwaver esp") {
            return "esp32s3"
        }
        return "stm32f042"
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
            self.ensureClient()
            self.refreshPortsInternal()
            self.autoConnectIfNeededInternal()
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
            if id.hasPrefix("uid:"), let transportID = self.hardwareUIDByDeviceID.first(where: { $0.value == String(id.dropFirst("uid:".count)) })?.key {
                self.connectDeviceInternal(transportID: transportID)
                return
            }
            self.connectDeviceInternal(transportID: id)
        }
    }

    func connectWiFi(host: String, port: Int = MacWiFiManager.defaultPort, pairingSecret: String) {
        wifiManager?.connect(host: host, port: port, pairingSecret: pairingSecret)
    }

    func provisionWiFi(ssid: String, password: String, pairingSecret: String, hostname: String) {
        let trimmedSSID = ssid.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSecret = pairingSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedHostname = hostname.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedSSID.isEmpty else {
            setError("Wi-Fi SSID is required")
            return
        }
        guard !trimmedSecret.isEmpty else {
            setError("Wi-Fi pairing secret is required")
            return
        }
        guard Self.isValidWiFiHostname(trimmedHostname) else {
            setError("Wi-Fi hostname must use letters, numbers, or hyphens and cannot start or end with a hyphen.")
            return
        }

        DispatchQueue.main.async {
            self.isWiFiProvisioning = true
            self.wifiProvisioningStatus = "Sending Wi-Fi setup"
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let canProvision = self.midiQueue.sync {
                self.activeTransport == .usbMidi || self.activeTransport == .ble
            }
            guard canProvision else {
                self.finishWiFiProvisioning(message: "Connect the ESP32-S3 over USB or BLE before provisioning Wi-Fi.", isError: true)
                return
            }
            let boardType = self.midiQueue.sync {
                self.connectedBoardType ?? self.lastDetectedBoardType ?? ""
            }
            guard boardType.lowercased() == "esp32s3" else {
                self.finishWiFiProvisioning(message: "Wi-Fi setup is available for ESP32-S3 devices.", isError: true)
                return
            }

            let passwordBytes = Array(password.utf8)
            let hostnameBytes = Array(trimmedHostname.utf8)
            let fields: [(UInt8, [UInt8], Int)] = [
                (EmwOpcode.wifiFieldSSID, Array(trimmedSSID.utf8), 32),
                (EmwOpcode.wifiFieldPassword, passwordBytes, 64),
                (EmwOpcode.wifiFieldSecret, Array(trimmedSecret.utf8), 64),
                (EmwOpcode.wifiFieldHostname, hostnameBytes, 32),
            ]

            for (_, bytes, maxLen) in fields where bytes.count > maxLen {
                self.finishWiFiProvisioning(message: "Wi-Fi setup value is too long.", isError: true)
                return
            }

            guard self.sendWiFiConfigCommand([EmwOpcode.wifiConfig, EmwOpcode.wifiBegin]) else {
                self.finishWiFiProvisioning(message: "Wi-Fi setup failed to start.", isError: true)
                return
            }

            for (field, bytes, _) in fields where !bytes.isEmpty {
                var offset = 0
                while offset < bytes.count {
                    let count = min(13, bytes.count - offset)
                    var command = Data([EmwOpcode.wifiConfig, EmwOpcode.wifiField, field, UInt8(offset), UInt8(count)])
                    command.append(contentsOf: bytes[offset..<(offset + count)])
                    guard self.sendWiFiConfigCommand(command) else {
                        self.finishWiFiProvisioning(message: "Wi-Fi setup failed while sending credentials.", isError: true)
                        return
                    }
                    offset += count
                }
            }

            guard self.sendWiFiConfigCommand([EmwOpcode.wifiConfig, EmwOpcode.wifiApply]) else {
                self.finishWiFiProvisioning(message: "Wi-Fi setup was rejected by the device.", isError: true)
                return
            }

            if !trimmedHostname.isEmpty {
                let host = trimmedHostname.contains(".") ? trimmedHostname : "\(trimmedHostname).local"
                self.wifiManager?.storePairing(
                    host: host,
                    displayName: trimmedHostname,
                    pairingSecret: trimmedSecret
                )
            }
            self.finishWiFiProvisioning(message: "Wi-Fi setup sent. The ESP32-S3 will join the network and advertise itself on the LAN.", isError: false)
        }
    }

    func clearWiFiProvisioning(hostname: String) {
        let trimmedHostname = hostname.trimmingCharacters(in: .whitespacesAndNewlines)

        DispatchQueue.main.async {
            self.isWiFiProvisioning = true
            self.wifiProvisioningStatus = "Clearing Wi-Fi setup"
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let canProvision = self.midiQueue.sync {
                self.activeTransport == .usbMidi || self.activeTransport == .ble
            }
            guard canProvision else {
                self.finishWiFiProvisioning(message: "Connect the ESP32-S3 over USB or BLE before clearing Wi-Fi setup.", isError: true)
                return
            }
            let boardType = self.midiQueue.sync {
                self.connectedBoardType ?? self.lastDetectedBoardType ?? ""
            }
            guard boardType.lowercased() == "esp32s3" else {
                self.finishWiFiProvisioning(message: "Wi-Fi setup recovery is available for ESP32-S3 devices.", isError: true)
                return
            }
            guard self.sendWiFiConfigCommand([EmwOpcode.wifiConfig, EmwOpcode.wifiClear]) else {
                self.finishWiFiProvisioning(message: "Wi-Fi setup clear was rejected by the device.", isError: true)
                return
            }
            if !trimmedHostname.isEmpty {
                let host = trimmedHostname.contains(".") ? trimmedHostname : "\(trimmedHostname).local"
                self.wifiManager?.removePairing(host: host)
            }
            self.finishWiFiProvisioning(message: "Wi-Fi setup cleared. Provision the ESP32-S3 again before using Wi-Fi control.", isError: false)
        }
    }

    func refreshWiFiProvisioningStatus() {
        DispatchQueue.main.async {
            self.isWiFiProvisioning = true
            self.wifiProvisioningStatus = "Checking Wi-Fi status"
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let canQuery = self.midiQueue.sync {
                self.activeTransport == .usbMidi || self.activeTransport == .ble
            }
            guard canQuery else {
                self.finishWiFiProvisioning(message: "Connect the ESP32-S3 over USB or BLE before checking Wi-Fi status.", isError: true)
                return
            }
            let boardType = self.midiQueue.sync {
                self.connectedBoardType ?? self.lastDetectedBoardType ?? ""
            }
            guard boardType.lowercased() == "esp32s3" else {
                self.finishWiFiProvisioning(message: "Wi-Fi status is available for ESP32-S3 devices.", isError: true)
                return
            }
            guard let response = self.sendWiFiConfigRequest([EmwOpcode.wifiConfig, EmwOpcode.wifiStatus]),
                  response.count >= 3,
                  response.first == 0x80 else {
                self.finishWiFiProvisioning(message: "Wi-Fi status request was rejected by the device.", isError: true)
                return
            }
            let provisionedText = response[1] == 0 ? "unprovisioned" : "provisioned"
            let authText = response[2] == 0 ? "idle" : "authenticated"
            if response.count >= 4 {
                let stationText = response[3] == 0 ? "offline" : "online"
                if response.count >= 5 {
                    let retryText = response[4] == 0 ? "idle" : "retrying"
                    if response.count >= 7 {
                        let reason = UInt16(response[5]) | (UInt16(response[6]) << 8)
                        let reasonText = Self.wiFiDisconnectReasonText(reason)
                        self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText), station is \(stationText) (\(retryText), \(reasonText)); socket is \(authText).", isError: false)
                    } else {
                        self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText), station is \(stationText) (\(retryText)); socket is \(authText).", isError: false)
                    }
                } else {
                    self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText), station is \(stationText); socket is \(authText).", isError: false)
                }
            } else {
                self.finishWiFiProvisioning(message: "Wi-Fi is \(provisionedText); socket is \(authText).", isError: false)
            }
        }
    }

    private func connectDeviceInternal(transportID id: String) {
            if id.hasPrefix("midi:"), let displayName = self.displayNameFromDeviceID(id) {
                self.connectInternal(portName: displayName)
                return
            }
            if id.hasPrefix("ble:"),
               let uuid = UUID(uuidString: String(id.dropFirst("ble:".count))),
               let peripheral = self.bleDiscoveredPeripheralsByID[uuid] {
                self.connectBleInternal(peripheral, name: self.bleDiscoveredNamesByID[uuid])
                return
            }
            if id.hasPrefix("wifi:"), let record = self.wifiDevices.first(where: { $0.id == id }) {
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
            guard !self.isTransportConnectedInternal() else { return }
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
        guard !isTransportConnectedInternal() else { return }
        connectToFirstPortInternal()
        if !isTransportConnectedInternal() {
            startBleScanInternal()
        }
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
        guard isTransportConnectedInternal() else {
            setError("Cannot send command: Not connected")
            return nil
        }

        guard let session = deviceSession(for: deviceID) else {
            setError("Cannot send command: No matching device session")
            return nil
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

    private func sendWiFiConfigCommand(_ data: Data) -> Bool {
        sendWiFiConfigRequest(data)?.first == 0x80
    }

    private func sendWiFiConfigRequest(_ bytes: [UInt8]) -> Data? {
        sendWiFiConfigRequest(Data(bytes))
    }

    private func sendWiFiConfigRequest(_ data: Data) -> Data? {
        sendCommandInternal(
            data,
            timeout: 2000,
            responsePredicate: { lane in
                lane.first == 0x80 || lane.first == 0x81
            }
        )
    }

    private func finishWiFiProvisioning(message: String, isError: Bool) {
        if isError {
            setError(message)
        }
        DispatchQueue.main.async {
            self.isWiFiProvisioning = false
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

    private static func isValidWiFiHostname(_ hostname: String) -> Bool {
        if hostname.isEmpty {
            return true
        }
        guard hostname.count <= 32,
              hostname.first != "-",
              hostname.last != "-" else {
            return false
        }
        return hostname.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) || scalar == "-"
        }
    }

    func transmitBuffer() {
        transmitBuffer(deviceID: nil)
    }

    func transmitBuffer(deviceID: String?) {
        guard isTransportConnectedInternal() else {
            setError("Cannot transmit buffer: Not connected")
            return
        }

        let data = getBuffer(deviceID: deviceID)
        guard !data.isEmpty else { return }

        // Very simple sender: chunk into fixed 64B stream-lane packets.
        // (No BS pacing yet on macOS; keep this predictable.)
        var idx = 0
        while idx < data.count {
            let end = min(idx + Self.laneSizeBytes, data.count)
            let chunk = data.subdata(in: idx..<end)
            guard let packet = Self.makePacket(chunk) else { break }
            let sf = Self.makeSuperframe(cmdLane: nil, streamLane: packet)
            withMidiQueueSync { self.sendSuperframe(sf, deviceID: deviceID) }
            idx = end
            Thread.sleep(forTimeInterval: 0.001)
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
        publishDiscoveredDevices(ports: ports)
        DispatchQueue.main.async {
            self.availablePorts = ports
        }
    }

    private func publishDiscoveredDevices(ports: [String]? = nil) {
        let portNames = ports ?? Array(portCandidatesByDisplayName.keys).sorted()
        var devices: [LocalDeviceDescriptor] = []
        var indexByHardwareUID: [String: Int] = [:]

        func appendOrMerge(_ descriptor: LocalDeviceDescriptor, hardwareUID: String?) {
            guard let hardwareUID, !hardwareUID.isEmpty else {
                devices.append(descriptor)
                return
            }
            if let idx = indexByHardwareUID[hardwareUID] {
                var existing = devices[idx]
                existing.displayName = mergeDisplayNames(existing.displayName, descriptor.displayName)
                existing.connectionState = strongestConnectionState(existing.connectionState, descriptor.connectionState)
                existing.isActive = existing.isActive || descriptor.isActive
                if existing.transport != descriptor.transport {
                    existing.transport = .usbMidi
                }
                devices[idx] = existing
            } else {
                indexByHardwareUID[hardwareUID] = devices.count
                devices.append(descriptor)
            }
        }

        for port in portNames.sorted() {
            let id = "midi:\(port)"
            let isActive = activeTransport == .usbMidi && connectedPortName == port && isTransportConnectedInternal()
            appendOrMerge(LocalDeviceDescriptor(
                id: hardwareUIDByDeviceID[id].map { "uid:\($0)" } ?? id,
                displayName: port,
                transport: .usbMidi,
                boardType: inferBoardType(portName: port),
                moduleLabel: nil,
                connectionState: isActive ? .connected : .discovered,
                lastErrorText: nil,
                isActive: isActive
            ), hardwareUID: hardwareUIDByDeviceID[id])
        }

        for (uuid, peripheral) in bleDiscoveredPeripheralsByID.sorted(by: { $0.key.uuidString < $1.key.uuidString }) {
            let id = "ble:\(uuid.uuidString)"
            let name = bleDiscoveredNamesByID[uuid] ?? peripheral.name ?? "EMWaver BLE"
            let isActive = activeTransport == .ble && blePeripheral?.identifier == uuid && isTransportConnectedInternal()
            let isConnected = peripheral.state == .connected && bleCommandCharacteristicsByID[uuid] != nil
            let isConnecting = peripheral.state == .connecting
            appendOrMerge(LocalDeviceDescriptor(
                id: hardwareUIDByDeviceID[id].map { "uid:\($0)" } ?? id,
                displayName: name,
                transport: .ble,
                boardType: "esp32s3",
                moduleLabel: nil,
                connectionState: isConnected ? .connected : (isConnecting ? .connecting : .discovered),
                lastErrorText: nil,
                isActive: isActive
            ), hardwareUID: hardwareUIDByDeviceID[id])
        }

        let connectingWiFiID = wifiManager?.connectingDeviceID
        for record in wifiDevices.sorted(by: { $0.displayName < $1.displayName }) {
            let isActive = activeTransport == .wifi && wifiManager?.activeDeviceID == record.id && isTransportConnectedInternal()
            let isConnecting = record.id == connectingWiFiID
            let endpoint = "\(record.host):\(record.port)"
            let detail = record.firmwareVersion.map { "\(endpoint) · FW \($0)" } ?? endpoint
            appendOrMerge(LocalDeviceDescriptor(
                id: record.id,
                displayName: record.displayName,
                transport: .wifi,
                boardType: record.boardType ?? "esp32s3",
                moduleLabel: detail,
                connectionState: isActive ? .connected : (isConnecting ? .connecting : .discovered),
                lastErrorText: record.isPaired ? nil : "Pairing required",
                isActive: isActive
            ), hardwareUID: nil)
        }

        DispatchQueue.main.async {
            self.discoveredDevices = devices
        }
    }

    private func mergeDisplayNames(_ a: String, _ b: String) -> String {
        if a == b { return a }
        if a.contains(b) { return a }
        if b.contains(a) { return b }
        return "\(a) / \(b)"
    }

    private func strongestConnectionState(_ a: LocalDeviceDescriptor.ConnectionState, _ b: LocalDeviceDescriptor.ConnectionState) -> LocalDeviceDescriptor.ConnectionState {
        if a == .connected || b == .connected { return .connected }
        if a == .connecting || b == .connecting { return .connecting }
        return .discovered
    }

    private func displayNameFromDeviceID(_ id: String) -> String? {
        let raw = String(id.dropFirst("midi:".count))
        return portCandidatesByDisplayName.keys.first(where: { $0 == raw })
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
        disconnectInternal()

        connectedSource = candidate.source
        connectedDestination = candidate.destination
        activeTransport = .usbMidi
        let deviceID = "midi:\(displayName ?? candidate.name)"
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
            var v = self.queryDeviceVersion(timeoutMs: 1500)
            if v == nil {
                Thread.sleep(forTimeInterval: 0.25)
                v = self.queryDeviceVersion(timeoutMs: 1500)
            }
            let uid = self.queryHardwareUID(timeoutMs: 1500)
            let boardType = self.inferBoardType(portName: displayName ?? candidate.name)

            DispatchQueue.main.async {
                self.deviceEmwaverVersion = v
                self.connectedHardwareUID = uid
                self.connectedBoardType = boardType
                self.lastDetectedBoardType = boardType
            }
            self.midiQueue.async {
                if let uid { self.hardwareUIDByDeviceID[deviceID] = uid }
                self.publishDiscoveredDevices()
            }
        }
    }

    private func disconnectInternal() {
        if connectedSource != 0 {
            _ = MIDIPortDisconnectSource(inPort, connectedSource)
        }
        connectedSource = 0
        connectedDestination = 0
        activeTransport = .none
        activeDeviceID = nil

        for peripheral in bleConnectedPeripheralsByID.values {
            bleCentral?.cancelPeripheralConnection(peripheral)
        }
        bleConnectedPeripheralsByID.removeAll()
        bleCommandCharacteristicsByID.removeAll()
        bleNotifyCharacteristicsByID.removeAll()
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

    private func queryHardwareUID(timeoutMs: Int) -> String? {
        let resp = sendCommandInternal(
            Data([EmwOpcode.hardwareUID]),
            timeout: timeoutMs,
            responsePredicate: { lane64 in
                guard lane64.count >= 7 else { return false }
                guard lane64[0] == 0x80 else { return false }
                return lane64.dropFirst(1).contains(where: { $0 != 0 })
            }
        )
        guard let resp, resp.count >= 7, resp[0] == 0x80 else { return nil }
        let payload = resp.dropFirst(1)
        let significantLength = payload.lastIndex(where: { $0 != 0 }).map { payload.distance(from: payload.startIndex, to: $0) + 1 } ?? 0
        guard significantLength > 0 else { return nil }
        return payload.prefix(significantLength).map { String(format: "%02x", $0) }.joined()
    }

    private func queryDeviceVersion(timeoutMs: Int) -> String? {
        // Opcode 0x01 is "VERSION". Expected response lane: [0x80, major, minor, patch, 0...]
        // Product UI uses major.minor (patch is internal / not shown).
        let resp = sendCommandInternal(
            Data([EmwOpcode.version]),
            timeout: timeoutMs,
            responsePredicate: { lane64 in
                if lane64.count < 4 { return false }
                if lane64[0] != 0x80 { return false }
                return !lane64.dropFirst(4).contains(where: { $0 != 0 })
            }
        )
        guard let resp else { return nil }
        if resp.count < 4 { return nil }
        if resp[0] != 0x80 { return nil }
        if resp.dropFirst(4).contains(where: { $0 != 0 }) { return nil }
        return "\(resp[1]).\(resp[2])"
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
        guard allowWhenAutoConnectDisabled || autoConnectEnabled else { return }
        guard bleCentral?.state == .poweredOn else {
            stopBleScanInternal()
            return
        }
        bleCentral?.scanForPeripherals(
            withServices: nil,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
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
        disconnectMidiOnlyInternal()
        activeTransport = .wifi
        activeDeviceID = record.id
        ensureDeviceSessionInternal(deviceID: record.id).resetParserAndBuffers()

        DispatchQueue.main.async {
            self.connectedPortName = "\(record.host):\(record.port)"
            self.connectedBoardType = record.boardType ?? "esp32s3"
            self.lastDetectedBoardType = record.boardType ?? "esp32s3"
            self.connectedTransportKind = "Wi-Fi"
            self.lastErrorText = nil
            self.deviceEmwaverVersion = nil
            self.connectedHardwareUID = nil
            self.isConnected = true
        }
        publishDiscoveredDevices()
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
        DispatchQueue.main.async {
            self.isConnected = false
            self.connectedPortName = nil
            self.connectedTransportKind = nil
            self.connectedBoardType = nil
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

    private func connectBleInternal(_ peripheral: CBPeripheral, name: String?) {
        disconnectMidiOnlyInternal()
        blePeripheral = peripheral
        bleCommandCharacteristic = bleCommandCharacteristicsByID[peripheral.identifier]
        bleNotifyCharacteristic = bleNotifyCharacteristicsByID[peripheral.identifier]
        let deviceID = "ble:\(peripheral.identifier.uuidString)"
        activeDeviceID = deviceID
        ensureDeviceSessionInternal(deviceID: deviceID)
        peripheral.delegate = self
        if peripheral.state == .connected {
            activeTransport = .ble
            DispatchQueue.main.async {
                self.isConnected = self.bleCommandCharacteristicsByID[peripheral.identifier] != nil
            }
        } else if peripheral.state != .connecting {
            bleCentral?.connect(peripheral, options: nil)
        }
        DispatchQueue.main.async {
            self.connectedPortName = name ?? peripheral.name ?? "EMWaver BLE"
            self.connectedBoardType = "esp32s3"
            self.lastDetectedBoardType = "esp32s3"
            self.connectedTransportKind = "BLE"
            self.lastErrorText = nil
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
        publishDiscoveredDevices()
        guard autoConnectEnabled, !isTransportConnectedInternal() else { return }
        NSLog("EMWaver BLE discovered: %@ rssi=%@", name, RSSI)
        connectBleInternal(peripheral, name: name)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        bleConnectedPeripheralsByID[peripheral.identifier] = peripheral
        let deviceID = "ble:\(peripheral.identifier.uuidString)"
        ensureDeviceSessionInternal(deviceID: deviceID)
        if blePeripheral == nil || blePeripheral == peripheral {
            blePeripheral = peripheral
            activeTransport = .ble
            activeDeviceID = deviceID
        }
        peripheral.discoverServices([Self.bleServiceUUID])
        DispatchQueue.main.async {
            self.connectedPortName = self.bleDiscoveredNamesByID[peripheral.identifier] ?? peripheral.name ?? "EMWaver BLE"
            self.connectedBoardType = "esp32s3"
            self.lastDetectedBoardType = "esp32s3"
            self.connectedTransportKind = "BLE"
            self.lastErrorText = nil
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
        setError(error?.localizedDescription ?? "BLE connection failed")
        publishDiscoveredDevices()
        autoConnectIfNeededInternal()
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        bleConnectedPeripheralsByID.removeValue(forKey: peripheral.identifier)
        bleCommandCharacteristicsByID.removeValue(forKey: peripheral.identifier)
        bleNotifyCharacteristicsByID.removeValue(forKey: peripheral.identifier)
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
            DispatchQueue.global(qos: .userInitiated).async {
                let version = self.queryDeviceVersion(timeoutMs: 2000)
                let uid = self.queryHardwareUID(timeoutMs: 2000)
                let deviceID = "ble:\(peripheral.identifier.uuidString)"
                DispatchQueue.main.async {
                    self.isConnected = true
                    self.deviceEmwaverVersion = version
                    self.connectedHardwareUID = uid
                    self.connectedBoardType = "esp32s3"
                    self.lastDetectedBoardType = "esp32s3"
                    self.connectedTransportKind = "BLE"
                }
                self.midiQueue.async {
                    if let uid { self.hardwareUIDByDeviceID[deviceID] = uid }
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
