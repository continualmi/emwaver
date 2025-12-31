import Foundation
import CoreBluetooth
import SwiftUI
import Combine
import CryptoKit

class BLEManager: NSObject, ObservableObject {
    private static let packetSizeBytes: Int = 64

    static func isPaddedOkFrame(_ data: Data) -> Bool {
        guard data.count == packetSizeBytes else { return false }
        return data.allSatisfy { $0 == 0x00 }
    }

    static func isPaddedErrFrame(_ data: Data) -> Bool {
        guard data.count == packetSizeBytes else { return false }
        guard data.first == 0xFF else { return false }
        return data.dropFirst().allSatisfy { $0 == 0x00 }
    }

    struct ReadPackets {
        let data: [UInt8]
        let ts_ms: [UInt64]
        let next_packet_index: UInt64
        let available_packets: UInt64
    }

    // MARK: - Published Properties
    @Published var isConnected = false
    @Published var isScanning = false
    @Published var bufferVersion: Int = 0

    @Published var otaIsFlashing: Bool = false
    @Published var otaProgress: Double = 0
    @Published var otaStatusText: String = ""
    @Published var otaErrorText: String? = nil

    @Published var otaTransport: OtaTransport = .ble
    
    // MARK: - Utility Methods
    static func dataToHexString(_ data: Data) -> String {
        return data.map { String(format: "%02X ", $0) }.joined().trimmingCharacters(in: .whitespaces)
    }
    
    static func dataToAsciiString(_ data: Data) -> String {
        return data.map { (byte) -> String in
            if (32...126).contains(Int(byte)) {
                return String(UnicodeScalar(byte))
            } else {
                return "."
            }
        }.joined()
    }
    
    static func hexStringToData(_ hexString: String) -> Data? {
        // Remove all non-hexadecimal characters
        let hex = hexString.replacingOccurrences(of: "[^0-9A-Fa-f]", with: "", options: .regularExpression)
        
        // Check if we have a valid hex string
        guard hex.count % 2 == 0 else { return nil }
        
        var data = Data()
        var index = hex.startIndex
        
        // Convert each pair of hex digits to a byte
        while index < hex.endIndex {
            let byteString = hex[index..<hex.index(index, offsetBy: 2)]
            if let byte = UInt8(byteString, radix: 16) {
                data.append(byte)
            } else {
                return nil
            }
            index = hex.index(index, offsetBy: 2)
        }
        
        return data
    }
    
    static func parseCommand(_ input: String) -> Data? {
        var byteArray = [UInt8]()
        
        // Check if the input contains any bracketed values
        if input.contains("[") && input.contains("]") {
            // Split the input around brackets
            var currentIndex = input.startIndex
            
            while currentIndex < input.endIndex {
                // Find the next opening bracket
                if let openingBracket = input[currentIndex...].firstIndex(of: "[") {
                    // Process any ASCII characters before the bracket
                    if openingBracket > currentIndex {
                        let asciiPart = String(input[currentIndex..<openingBracket])
                        byteArray.append(contentsOf: asciiPart.utf8)
                    }
                    
                    // Find the closing bracket
                    if let closingBracket = input[openingBracket...].firstIndex(of: "]") {
                        // Extract the content inside brackets
                        let startIndex = input.index(after: openingBracket)
                        let bracketContent = String(input[startIndex..<closingBracket]).trimmingCharacters(in: .whitespaces)
                        
                        // Check for hex or decimal format
                        if bracketContent.lowercased().hasPrefix("0x") {
                            // Hexadecimal value
                            let hexValue = String(bracketContent.dropFirst(2))
                            if let byteValue = UInt8(hexValue, radix: 16) {
                                byteArray.append(byteValue)
                            } else {
                                print("Invalid hex value: \(bracketContent)")
                                return nil
                            }
                        } else if let decimalValue = UInt8(bracketContent) {
                            // Decimal value
                            byteArray.append(decimalValue)
                        } else {
                            print("Invalid bracket content: \(bracketContent)")
                            return nil
                        }
                        
                        // Move past this bracket
                        currentIndex = input.index(after: closingBracket)
                    } else {
                        // No matching closing bracket
                        print("Missing closing bracket")
                        return nil
                    }
                } else {
                    // No more brackets, treat the rest as ASCII
                    let restOfString = String(input[currentIndex...])
                    byteArray.append(contentsOf: restOfString.utf8)
                    break
                }
            }
        } else {
            // If no brackets, treat the entire input as ASCII
            byteArray.append(contentsOf: input.utf8)
        }
        
        return Data(byteArray)
    }

    static func frameAsciiCommand(_ command: String) -> Data {
        var framed = command
        if !framed.hasSuffix("\n") {
            framed += "\n"
        }
        var data = Data(framed.utf8)
        if data.count < packetSizeBytes {
            data.append(Data(repeating: 0, count: packetSizeBytes - data.count))
        }
        return data
    }
    
    // MARK: - Constants
    // EMWaver BLE Service and Characteristic UUIDs - matching Android implementation
    private let serviceUUID = CBUUID(string: "45c7158e-0c3b-4e90-a847-452a15b14191")
    private let cmdCharUUID = CBUUID(string: "46c7158e-0c3b-4e90-a847-452a15b14191") 
    private let notifCharUUID = CBUUID(string: "47c7158e-0c3b-4e90-a847-452a15b14191")

    // OTA BLE Service and Characteristic UUIDs - matching ESP32 firmware
    private let otaServiceUUID = CBUUID(string: "45c7158e-0c3b-4e90-a847-452a15b14192")
    private let otaCtrlCharUUID = CBUUID(string: "45c7158e-0c3b-4e90-a847-452a15b14193")
    private let otaDataCharUUID = CBUUID(string: "45c7158e-0c3b-4e90-a847-452a15b14194")
    private let otaStatusCharUUID = CBUUID(string: "45c7158e-0c3b-4e90-a847-452a15b14195")
    
    // MARK: - Private Properties
    private var centralManager: CBCentralManager!
    private var peripheralDevice: CBPeripheral?
    private var cmdCharacteristic: CBCharacteristic?
    private var notifCharacteristic: CBCharacteristic?

    private var otaCtrlCharacteristic: CBCharacteristic?
    private var otaDataCharacteristic: CBCharacteristic?
    private var otaStatusCharacteristic: CBCharacteristic?

    private var pendingWriteContinuations: [CBUUID: CheckedContinuation<Void, Error>] = [:]
    private var canSendWithoutResponseContinuation: CheckedContinuation<Void, Never>?
    private var otaCompletionContinuation: CheckedContinuation<Void, Error>?
    
    private var isNewCommandAvailable = false
    // Add a serial queue for thread-safe buffer access
    private let bufferQueue = DispatchQueue(label: "com.emwaver.bufferQueue")
    private let bufferQueueKey = DispatchSpecificKey<Void>()
    
    // Connection retry properties
    private var connectionRetryCount = 0
    private static let maxRetryCount = 3
    private var isReconnecting = false
    
    // Variables for speed calculation
    private var totalBytesReceived: Int = 0
    private var firstPacketTimeMillis: TimeInterval = 0
    private var lastPacketReceivedTime: TimeInterval = 0
    
    // MARK: - Initialization
    override init() {
        super.init()
        // Use a dedicated background queue for BLE
        let bleQueue = DispatchQueue(label: "com.emwaver.ble", qos: .userInitiated)
        centralManager = CBCentralManager(delegate: self, queue: bleQueue)
        bufferQueue.setSpecific(key: bufferQueueKey, value: ())
    }

    private func withBufferQueueSync<T>(_ block: () -> T) -> T {
        if DispatchQueue.getSpecific(key: bufferQueueKey) != nil {
            return block()
        }
        return bufferQueue.sync(execute: block)
    }
    
    // MARK: - Public Methods
    func startScan() {
        guard centralManager.state == .poweredOn else {
            print("Bluetooth is not powered on")
            return
        }
        
        DispatchQueue.main.async {
            self.isScanning = true
        }
        print("Scanning for EMWaver device...")
        
        // Set up scan options
        let options: [String: Any] = [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ]
        
        // Start scanning for devices with our service UUID
        centralManager.scanForPeripherals(withServices: nil, options: options)
        
        // Stop scan after 10 seconds to conserve battery
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            if self?.isScanning ?? false {
                self?.stopScan()
            }
        }
    }
    
    func stopScan() {
        guard isScanning else { return }
        
        centralManager.stopScan()
        DispatchQueue.main.async {
            self.isScanning = false
        }
        print("Stopped scanning")
    }
    
    func disconnect() {
        // --- Add Logging Here ---
        print("!!! BLEManager.disconnect() explicitly called.")
        // --- End Logging ---

        guard let peripheral = peripheralDevice, isConnected else { return }
        
        centralManager.cancelPeripheralConnection(peripheral)
        print("Disconnecting from EMWaver device")
    }

    enum OtaError: LocalizedError {
        case notConnected
        case otaCharacteristicsNotReady
        case invalidFirmware
        case statusTimeout
        case flashFailed(code: UInt8, err: UInt8)
        case invalidStatusPacket
        case transportError(String)

        var errorDescription: String? {
            switch self {
            case .notConnected:
                return "Not connected to EMWaver"
            case .otaCharacteristicsNotReady:
                return "OTA characteristics not ready"
            case .invalidFirmware:
                return "Invalid firmware file"
            case .statusTimeout:
                return "Timed out waiting for device status"
            case .flashFailed(let code, let err):
                return String(format: "OTA failed (code=0x%02X err=0x%02X)", code, err)
            case .invalidStatusPacket:
                return "Invalid OTA status packet"
            case .transportError(let message):
                return message
            }
        }
    }

    struct OtaStatus {
        let code: UInt8
        let received: UInt32
        let total: UInt32
        let err: UInt8
    }

    enum OtaTransport: String, CaseIterable, Identifiable {
        case ble = "BLE"
        case wifi = "Wi‑Fi SoftAP"

        var id: String { rawValue }
    }

    private func parseOtaStatus(_ data: Data) -> OtaStatus? {
        if data.count != 14 { return nil }
        let bytes = [UInt8](data)
        if bytes[0] != 0x4F || bytes[1] != 0x54 || bytes[2] != 0x41 { return nil } // "OTA"
        if bytes[3] != 1 { return nil }

        let code = bytes[4]
        let received = UInt32(bytes[5])
            | (UInt32(bytes[6]) << 8)
            | (UInt32(bytes[7]) << 16)
            | (UInt32(bytes[8]) << 24)
        let total = UInt32(bytes[9])
            | (UInt32(bytes[10]) << 8)
            | (UInt32(bytes[11]) << 16)
            | (UInt32(bytes[12]) << 24)
        let err = bytes[13]

        return OtaStatus(code: code, received: received, total: total, err: err)
    }

    private func sha256(_ data: Data) -> Data {
        let digest = SHA256.hash(data: data)
        return Data(digest)
    }

    private func bytesToHexLower(_ data: Data) -> String {
        let hex = Array("0123456789abcdef")
        var out = String()
        out.reserveCapacity(data.count * 2)
        for b in data {
            out.append(hex[Int(b >> 4)])
            out.append(hex[Int(b & 0x0f)])
        }
        return out
    }

    private func setOtaUi(
        isFlashing: Bool? = nil,
        progress: Double? = nil,
        status: String? = nil,
        error: String? = nil
    ) {
        DispatchQueue.main.async {
            if let isFlashing { self.otaIsFlashing = isFlashing }
            if let progress { self.otaProgress = progress }
            if let status { self.otaStatusText = status }
            self.otaErrorText = error
        }
    }

    private func waitUntil(_ predicate: @escaping () -> Bool, timeoutSeconds: Double) async -> Bool {
        let start = Date()
        while Date().timeIntervalSince(start) < timeoutSeconds {
            if predicate() { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return predicate()
    }

    private func waitCanSendWriteWithoutResponse() async {
        guard let peripheral = peripheralDevice else { return }
        if peripheral.canSendWriteWithoutResponse { return }
        await withCheckedContinuation { cont in
            canSendWithoutResponseContinuation = cont
        }
    }

    private func writeWithResponse(_ data: Data, to characteristic: CBCharacteristic) async throws {
        guard let peripheral = peripheralDevice else { throw OtaError.notConnected }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pendingWriteContinuations[characteristic.uuid] = cont
            peripheral.writeValue(data, for: characteristic, type: .withResponse)
        }
    }

    func otaFlashFirmware(_ firmware: Data) async throws {
        guard !firmware.isEmpty else { throw OtaError.invalidFirmware }
        guard isConnected else { throw OtaError.notConnected }

        let ready = await waitUntil({
            self.otaCtrlCharacteristic != nil && self.otaDataCharacteristic != nil && self.otaStatusCharacteristic != nil
        }, timeoutSeconds: 10.0)
        if !ready { throw OtaError.otaCharacteristicsNotReady }

        guard let ctrl = otaCtrlCharacteristic, let dataChar = otaDataCharacteristic else {
            throw OtaError.otaCharacteristicsNotReady
        }

        setOtaUi(isFlashing: true, progress: 0, status: "Preparing OTA…", error: nil)
        defer {
            setOtaUi(isFlashing: false)
        }

        let total = UInt32(firmware.count)
        let sha = sha256(firmware)

        var startPkt = Data()
        startPkt.append(0x01)
        startPkt.append(contentsOf: [
            UInt8(total & 0xFF),
            UInt8((total >> 8) & 0xFF),
            UInt8((total >> 16) & 0xFF),
            UInt8((total >> 24) & 0xFF),
        ])
        startPkt.append(sha)

        setOtaUi(status: "Starting OTA…")
        try await writeWithResponse(startPkt, to: ctrl)

        setOtaUi(status: "Uploading…")

        let maxLen = peripheralDevice?.maximumWriteValueLength(for: .withoutResponse) ?? 244
        let chunkSize = min(512, max(1, maxLen))
        var sent = 0

        for chunk in firmware.chunked(into: chunkSize) {
            await waitCanSendWriteWithoutResponse()
            peripheralDevice?.writeValue(chunk, for: dataChar, type: .withoutResponse)
            sent += chunk.count
            setOtaUi(progress: min(1.0, Double(sent) / Double(firmware.count)))
            try? await Task.sleep(nanoseconds: 3_000_000)
        }

        setOtaUi(status: "Finalizing…")
        try await writeWithResponse(Data([0x03]), to: ctrl)

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            otaCompletionContinuation = cont
            Task {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if self.otaCompletionContinuation != nil {
                    self.otaCompletionContinuation = nil
                    cont.resume(throwing: OtaError.statusTimeout)
                }
            }
        }

        setOtaUi(progress: 1.0, status: "Done")
    }

    func otaWifiStartMode() async throws {
        guard isConnected else { throw OtaError.notConnected }

        let ready = await waitUntil({
            self.otaCtrlCharacteristic != nil
        }, timeoutSeconds: 10.0)
        if !ready { throw OtaError.otaCharacteristicsNotReady }
        guard let ctrl = otaCtrlCharacteristic else { throw OtaError.otaCharacteristicsNotReady }

        setOtaUi(status: "Starting Wi‑Fi OTA mode…", error: nil)
        try await writeWithResponse(Data([0x10]), to: ctrl)
        setOtaUi(status: "Wi‑Fi OTA mode ready. Connect to Wi‑Fi 'EMWaver-OTA'.")
    }

    func otaWifiStopMode() async throws {
        guard isConnected else { throw OtaError.notConnected }

        let ready = await waitUntil({
            self.otaCtrlCharacteristic != nil
        }, timeoutSeconds: 10.0)
        if !ready { throw OtaError.otaCharacteristicsNotReady }
        guard let ctrl = otaCtrlCharacteristic else { throw OtaError.otaCharacteristicsNotReady }

        setOtaUi(status: "Stopping Wi‑Fi OTA mode…", error: nil)
        try await writeWithResponse(Data([0x11]), to: ctrl)
        setOtaUi(status: "Wi‑Fi OTA mode stopped.")
    }

    func otaFlashFirmwareWifi(_ firmware: Data) async throws {
        guard !firmware.isEmpty else { throw OtaError.invalidFirmware }

        setOtaUi(isFlashing: true, progress: 0, status: "Preparing Wi‑Fi OTA…", error: nil)
        defer { setOtaUi(isFlashing: false) }

        let sha = sha256(firmware)
        let shaHex = bytesToHexLower(sha)

        setOtaUi(status: "Uploading over Wi‑Fi… (connect to EMWaver-OTA)")
        let url = URL(string: "http://192.168.4.1/ota")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(shaHex, forHTTPHeaderField: "X-Emwaver-Sha256")
        request.httpBody = firmware
        request.timeoutInterval = 30

        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw OtaError.transportError("HTTP \(http.statusCode)")
        }

        if isConnected {
            setOtaUi(progress: 1.0, status: "Waiting for device to finalize…")
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                otaCompletionContinuation = cont
                Task {
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    if self.otaCompletionContinuation != nil {
                        self.otaCompletionContinuation = nil
                        cont.resume(throwing: OtaError.statusTimeout)
                    }
                }
            }
        } else {
            setOtaUi(progress: 1.0, status: "Upload complete. Reconnect over BLE to confirm version.")
        }
        setOtaUi(progress: 1.0, status: "Done")
    }
    
    @objc func sendPacket(_ data: Data) {
        guard isConnected, let peripheral = peripheralDevice, let characteristic = cmdCharacteristic else {
            print("Cannot send packet: Not connected to device")
            return
        }

        guard let packet = withBufferQueueSync({ NativeBufferRust.makePacket64(data) }) else {
            print("Cannot send packet: too large (\(data.count) bytes, max \(Self.packetSizeBytes))")
            return
        }
        withBufferQueueSync {
            NativeBufferRust.appendTxBytes(packet, tsMs: Self.nowMs())
        }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }

        // Desktop parity: commands are fixed 64B packets and we avoid waiting for ATT write response.
        peripheral.writeValue(packet, for: characteristic, type: .withoutResponse)
    }

    // MARK: - Desktop-like Buffer Monitor APIs (non-destructive)

    func bufferClear() {
        clearBuffer()
    }

    func bufferReadPacketsSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        return withBufferQueueSync {
            let rp = NativeBufferRust.readRxSince(packetIndex: packetIndex, maxPackets: maxPackets)
            return ReadPackets(data: rp.data, ts_ms: rp.ts_ms, next_packet_index: rp.next_packet_index, available_packets: rp.available_packets)
        }
    }

    func bufferReadTxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        return withBufferQueueSync {
            let rp = NativeBufferRust.readTxSince(packetIndex: packetIndex, maxPackets: maxPackets)
            return ReadPackets(data: rp.data, ts_ms: rp.ts_ms, next_packet_index: rp.next_packet_index, available_packets: rp.available_packets)
        }
    }

    func bufferGetPacketCount() -> UInt64 {
        return withBufferQueueSync { NativeBufferRust.getRxPacketCount() }
    }

    func bufferGetTxPacketCount() -> UInt64 {
        return withBufferQueueSync { NativeBufferRust.getTxPacketCount() }
    }

    struct BufferPacket {
        let data: [UInt8]
        let ts_ms: UInt64
    }

    func bufferNextRxPacket() -> BufferPacket? {
        return withBufferQueueSync {
            guard let pkt = NativeBufferRust.nextRxPacket() else { return nil }
            return BufferPacket(data: Array(pkt.packet64), ts_ms: pkt.tsMs)
        }
    }

    func bufferGetRxCounter() -> UInt64 {
        return withBufferQueueSync { NativeBufferRust.getRxCounter() }
    }

    func bufferSetRxCounter(_ value: UInt64) {
        withBufferQueueSync { NativeBufferRust.setRxCounter(value) }
    }

    struct BufferMonitorEntry: Identifiable {
        let id: String
        let data: [UInt8]
        let ts_ms: UInt64
        let isTx: Bool
        let packetIndex: UInt64
    }

    func bufferMonitorEntries(limit: Int) -> [BufferMonitorEntry] {
        guard limit > 0 else { return [] }
        return withBufferQueueSync {
            let maxPackets = min(limit, 1500)

            let txCount = NativeBufferRust.getTxPacketCount()
            let rxCount = NativeBufferRust.getRxPacketCount()

            let txStart = txCount > UInt64(maxPackets) ? (txCount - UInt64(maxPackets)) : 0
            let rxStart = rxCount > UInt64(maxPackets) ? (rxCount - UInt64(maxPackets)) : 0

            let txRust = NativeBufferRust.readTxSince(packetIndex: txStart, maxPackets: maxPackets)
            let rxRust = NativeBufferRust.readRxSince(packetIndex: rxStart, maxPackets: maxPackets)
            let tx = ReadPackets(data: txRust.data, ts_ms: txRust.ts_ms, next_packet_index: txRust.next_packet_index, available_packets: txRust.available_packets)
            let rx = ReadPackets(data: rxRust.data, ts_ms: rxRust.ts_ms, next_packet_index: rxRust.next_packet_index, available_packets: rxRust.available_packets)

            var out: [BufferMonitorEntry] = []
            out.reserveCapacity(tx.ts_ms.count + rx.ts_ms.count)

            for i in 0..<tx.ts_ms.count {
                let start = i * BLEManager.packetSizeBytes
                let end = start + BLEManager.packetSizeBytes
                if end <= tx.data.count {
                    let pkt = Array(tx.data[start..<end])
                    let idx = txStart + UInt64(i)
                    out.append(BufferMonitorEntry(
                        id: "tx:\(idx)",
                        data: pkt,
                        ts_ms: tx.ts_ms[i],
                        isTx: true,
                        packetIndex: idx
                    ))
                }
            }

            for i in 0..<rx.ts_ms.count {
                let start = i * BLEManager.packetSizeBytes
                let end = start + BLEManager.packetSizeBytes
                if end <= rx.data.count {
                    let pkt = Array(rx.data[start..<end])
                    let idx = rxStart + UInt64(i)
                    out.append(BufferMonitorEntry(
                        id: "rx:\(idx)",
                        data: pkt,
                        ts_ms: rx.ts_ms[i],
                        isTx: false,
                        packetIndex: idx
                    ))
                }
            }

            out.sort {
                if $0.ts_ms != $1.ts_ms { return $0.ts_ms < $1.ts_ms }
                if $0.isTx != $1.isTx { return $0.isTx && !$1.isTx }
                return $0.packetIndex < $1.packetIndex
            }

            if out.count > limit {
                return Array(out.suffix(limit))
            }
            return out
        }
    }
    
    // MARK: - Buffer Operations
    @objc func clearBuffer() {
        withBufferQueueSync {
            NativeBufferRust.clearAll()
        }
        // Update UI-affecting state on main thread 
        DispatchQueue.main.async {
            self.isNewCommandAvailable = false
            self.bufferVersion += 1
        }
    }

    func setInvertRx(_ enabled: Bool) {
        withBufferQueueSync {
            NativeBufferRust.setInvertRx(enabled)
        }
    }
    
    func storeBulkPkt(_ data: Data) {
        withBufferQueueSync {
            NativeBufferRust.storeBulkPkt(data, tsMs: Self.nowMs())
            isNewCommandAvailable = true
        }
        // This flag affects UI state indirectly, so update on main thread
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
        
        // Update statistics
        let currentTime = Date().timeIntervalSince1970
        lastPacketReceivedTime = currentTime
        
        if totalBytesReceived == 0 {
            firstPacketTimeMillis = currentTime
        }
        
        totalBytesReceived += data.count
    }
    
    func getCommand() -> Data? {
        return withBufferQueueSync {
            guard isNewCommandAvailable else { return nil }
            let saved = NativeBufferRust.takeRxState()
            NativeBufferRust.setRxCounter(0)
            isNewCommandAvailable = false
            return saved.rxBytes
        }
    }
    
    func getReceptionSpeedBps() -> Double {
        if totalBytesReceived == 0 || firstPacketTimeMillis == 0 {
            return 0.0
        }
        
        let currentTime = Date().timeIntervalSince1970
        let elapsedTimeSeconds = currentTime - firstPacketTimeMillis
        
        if elapsedTimeSeconds <= 0 {
            return 0.0
        }
        
        return Double(totalBytesReceived * 8) / elapsedTimeSeconds
    }

    // MARK: - Native Equivalent Methods

    /// Replaces the current buffer content with the provided data.
    /// - Parameter data: The new data for the buffer.
    @objc func loadBuffer(data: Data) {
        withBufferQueueSync {
            NativeBufferRust.loadBuffer(data)
        }
        // Update UI-affecting state on main thread
        DispatchQueue.main.async {
            self.isNewCommandAvailable = !data.isEmpty
            self.bufferVersion += 1
        }
        
        // Reset stats when loading new data
        totalBytesReceived = data.count 
        firstPacketTimeMillis = Date().timeIntervalSince1970
        lastPacketReceivedTime = firstPacketTimeMillis
    }

    /// Returns the entire content of the buffer.
    /// - Returns: The buffer data.
    @objc func getBuffer() -> Data {
        return withBufferQueueSync { NativeBufferRust.getBuffer() }
    }

    /// Inverts all the bits in the buffer.
    func invertBuffer() {
        var isEmpty = false
        let bytes = withBufferQueueSync { NativeBufferRust.getBuffer() }
        let inverted = Data(bytes.map { ~$0 })
        withBufferQueueSync {
            NativeBufferRust.loadBuffer(inverted)
        }
        isEmpty = inverted.isEmpty
        // Update UI-affecting state on main thread
        DispatchQueue.main.async {
            self.isNewCommandAvailable = !isEmpty
            self.bufferVersion += 1
        }
    }

    /// Compresses the buffer data bits for chart display using min/max sampling.
    /// - Parameters:
    ///   - rangeStart: The starting bit index (inclusive).
    ///   - rangeEnd: The ending bit index (exclusive).
    ///   - numberBins: The number of bins for compression.
    /// - Returns: A tuple containing arrays of time values (Float) and corresponding data values (Float).
    func compressDataBits(rangeStart: Int, rangeEnd: Int, numberBins: Int) -> ([Float], [Float]) {
        return withBufferQueueSync {
            NativeBufferRust.compressDataBits(rangeStart: rangeStart, rangeEnd: rangeEnd, numberBins: numberBins)
        }
    }
    
    /// Transmits the current buffer content to the connected peripheral.
    /// Implements flow control based on status feedback from the device.
    @objc func transmitBuffer() {
        guard isConnected, let peripheral = peripheralDevice, let characteristic = cmdCharacteristic else {
            print("Cannot transmit buffer: Not connected or characteristic not ready.")
            return
        }

        let bufferToSend = getBuffer()
        guard !bufferToSend.isEmpty else {
            print("Buffer is empty, nothing to transmit.")
            return
        }

        // Desktop parity: swap out RX buffer while transmitting so BS/response packets don't
        // contaminate sampler data stored in the same shared buffer.
        let saved = withBufferQueueSync {
            let saved = NativeBufferRust.takeRxState()
            NativeBufferRust.setRxCounter(0)
            isNewCommandAvailable = false
            return saved
        }
        DispatchQueue.main.async { self.bufferVersion += 1 }

        let profile = withBufferQueueSync { NativeBufferRust.txBleProfile() }
        let fixedDelayMs = Double(profile.fixed_delay_ms)

        let totalBytesToSend = bufferToSend.count
        var currentPacketSize = Int(profile.max_packet_size)
        var lastStatus = Int(profile.target_buffer_level)

        print("Starting buffer transmission: \(totalBytesToSend) bytes, Fixed Delay: \(fixedDelayMs)ms")

        var bytesSent = 0
        while bytesSent < totalBytesToSend {
            while let next = withBufferQueueSync({ NativeBufferRust.nextRxPacket() }) {
                let status = withBufferQueueSync { NativeBufferRust.parseBsStatus(next.packet64) }
                if status >= 0 { lastStatus = status }
            }

            currentPacketSize = withBufferQueueSync {
                NativeBufferRust.txBleNextPacketSize(
                    bytesSent: bytesSent,
                    lastStatus: lastStatus,
                    currentPacketSize: currentPacketSize
                )
            }

            let remainingBytes = totalBytesToSend - bytesSent
            let packetSize = min(currentPacketSize, remainingBytes)
            let endRange = bytesSent + packetSize
            let packet = bufferToSend.subdata(in: bytesSent..<endRange)

            withBufferQueueSync {
                NativeBufferRust.appendTxBytes(packet, tsMs: Self.nowMs())
            }
            DispatchQueue.main.async { self.bufferVersion += 1 }
            peripheral.writeValue(packet, for: characteristic, type: .withoutResponse)

            bytesSent = endRange
            Thread.sleep(forTimeInterval: fixedDelayMs / 1000.0)
        }

        Thread.sleep(forTimeInterval: 0.1) // 100ms delay (match Android)

        // Discard RX scratch packets accumulated during transmit and restore sampler buffer.
        withBufferQueueSync {
            NativeBufferRust.restoreRxState(rxBytes: saved.rxBytes, rxTsMs: saved.rxTsMs, rxCounter: saved.rxCounter)
        }
        isNewCommandAvailable = !bufferToSend.isEmpty
        DispatchQueue.main.async { self.bufferVersion += 1 }
    }

    // MARK: - Public Accessors
    /// Expose the connected peripheral for read-only access (for debugging/logging only)
    var connectedPeripheral: CBPeripheral? {
        peripheralDevice
    }

    // Send a command and wait for response
    @objc func sendCommand(_ command: Data, timeout: Int) -> Data? {
        sendCommand(command, timeout: timeout, packets: 1)
    }

    func sendCommand(_ command: Data, timeout: Int, packets: Int) -> Data? {
        guard isConnected, peripheralDevice != nil, cmdCharacteristic != nil else {
            print("Cannot send command: Not connected to device")
            return nil
        }
        
        guard let packet = withBufferQueueSync({ NativeBufferRust.makePacket64(command) }) else {
            print("Cannot send command: too large (\(command.count) bytes, max \(Self.packetSizeBytes))")
            return nil
        }

        let startTime = Date().timeIntervalSince1970
        print("BLE: Sending command: \(packet.map { String(format: "%02X", $0) }.joined(separator: " "))")

        // Desktop parity: drop any stale RX packets so next_rx_packet returns this command's response.
        withBufferQueueSync {
            NativeBufferRust.setRxCounter(NativeBufferRust.getRxPacketCount())
        }

        // Desktop parity: send as a 64B command packet without waiting for ATT response.
        sendPacket(packet)
        print("BLE: Command written, waiting for response (timeout: \(timeout)ms, packets: \(packets))")

        let wantPackets = max(1, packets)
        let wantBytes = wantPackets * Self.packetSizeBytes
        var out = Data()
        out.reserveCapacity(wantBytes)

        while out.count < wantBytes {
            if !isConnected {
                return nil
            }

            let nextPacket = withBufferQueueSync { NativeBufferRust.nextRxPacket() }
            if let pkt = nextPacket {
                out.append(pkt.packet64)
                continue
            }

            let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
            if elapsedMs >= Double(max(1, timeout)) {
                print("BLE: Command timed out after \(Int(elapsedMs))ms waiting for response packets")
                return nil
            }

            Thread.sleep(forTimeInterval: 0.01)
        }

        let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
        print("BLE: Response received after \(Int(elapsedMs))ms: \(out.map { String(format: "%02X", $0) }.joined(separator: " "))")
        return out
    }
}

// MARK: - CBCentralManagerDelegate
extension BLEManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        // Process state change on background thread but dispatch UI updates to main thread
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            switch central.state {
            case .poweredOn:
                print("Bluetooth is powered on")
            case .poweredOff:
                print("Bluetooth is powered off")
                self.isConnected = false
            case .resetting:
                print("Bluetooth is resetting")
            case .unauthorized:
                print("Bluetooth is unauthorized")
            case .unsupported:
                print("Bluetooth is not supported")
            case .unknown:
                print("Bluetooth state is unknown")
            @unknown default:
                print("Bluetooth state is unknown (new state)")
            }
        }
    }
    
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        // Check if this is our EMWaver device
        if let deviceName = peripheral.name, deviceName == "EMWaver" {
            print("Found EMWaver device: \(peripheral.identifier.uuidString)")
            
            // Stop scanning and connect to the device
            stopScan()
            peripheralDevice = peripheral
            central.connect(peripheral, options: nil)
        }
    }
    
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        DispatchQueue.main.async {
            self.isConnected = true
        }
        connectionRetryCount = 0
        isReconnecting = false
        print("Connected to EMWaver device")
        
        // Set delegate and discover services
        peripheral.delegate = self
        peripheral.discoverServices([serviceUUID, otaServiceUUID])
    }
    
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        print("Failed to connect: \(error?.localizedDescription ?? "Unknown error")")
        
        // Try to reconnect
        if connectionRetryCount < Self.maxRetryCount && !isReconnecting {
            connectionRetryCount += 1
            isReconnecting = true
            print("Attempting to reconnect: \(connectionRetryCount)")
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                if let self = self {
                    central.connect(peripheral, options: nil)
                }
            }
        } else {
            connectionRetryCount = 0
            print("Connection failed after multiple attempts")
        }
    }
    
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        DispatchQueue.main.async {
            self.isConnected = false
        }
        // --- Add Logging Here ---
        print("!!! centralManager:didDisconnectPeripheral called for \(peripheral.identifier.uuidString)")
        if let error = error {
            print("!!! Disconnect reason: \(error.localizedDescription)")
        } else {
            print("!!! Disconnect reason: No specific error provided by CoreBluetooth (potentially explicit disconnect or clean peripheral disconnect).")
        }
        // --- End Logging ---

        print("Disconnected from EMWaver device: \(error?.localizedDescription ?? "No error")")

        pendingWriteContinuations.values.forEach { $0.resume(throwing: OtaError.notConnected) }
        pendingWriteContinuations.removeAll()
        otaCompletionContinuation?.resume(throwing: OtaError.notConnected)
        otaCompletionContinuation = nil
        setOtaUi(isFlashing: false, status: "Disconnected", error: error?.localizedDescription)
        
        // Try to reconnect if disconnected unexpectedly
        if connectionRetryCount < Self.maxRetryCount && !isReconnecting && error != nil {
            connectionRetryCount += 1
            isReconnecting = true
            print("Attempting to reconnect: \(connectionRetryCount)")
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                if let self = self {
                    central.connect(peripheral, options: nil)
                }
            }
        }
    }
}

// MARK: - CBPeripheralDelegate
extension BLEManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error = error {
            print("Error discovering services: \(error.localizedDescription)")
            return
        }
        
        guard let services = peripheral.services else {
            print("No services found")
            return
        }
        
        // Debug log all services
        print("Found \(services.count) services")
        for service in services {
            print("Service: \(service.uuid.uuidString)")
            
            // If this is our service, discover its characteristics
            if service.uuid == serviceUUID {
                peripheral.discoverCharacteristics([cmdCharUUID, notifCharUUID], for: service)
            }

            if service.uuid == otaServiceUUID {
                peripheral.discoverCharacteristics([otaCtrlCharUUID, otaDataCharUUID, otaStatusCharUUID], for: service)
            }
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error = error {
            print("Error discovering characteristics: \(error.localizedDescription)")
            return
        }
        
        guard let characteristics = service.characteristics else {
            print("No characteristics found")
            return
        }
        
        // Debug log all characteristics
        for characteristic in characteristics {
            print("Characteristic: \(characteristic.uuid.uuidString)")
            
            // Store our characteristics
            if characteristic.uuid == cmdCharUUID {
                cmdCharacteristic = characteristic
                print("Found command characteristic")
            } else if characteristic.uuid == notifCharUUID {
                notifCharacteristic = characteristic
                print("Found notification characteristic")
                
                // Enable notifications for notification characteristic
                peripheral.setNotifyValue(true, for: characteristic)
            } else if characteristic.uuid == otaCtrlCharUUID {
                otaCtrlCharacteristic = characteristic
                print("Found OTA control characteristic")
            } else if characteristic.uuid == otaDataCharUUID {
                otaDataCharacteristic = characteristic
                print("Found OTA data characteristic")
            } else if characteristic.uuid == otaStatusCharUUID {
                otaStatusCharacteristic = characteristic
                print("Found OTA status characteristic")
                peripheral.setNotifyValue(true, for: characteristic)
            }
        }
        
        if cmdCharacteristic != nil && notifCharacteristic != nil {
            print("Ready to communicate with EMWaver")
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error = error {
            print("Error receiving data: \(error.localizedDescription)")
            return
        }
        
        guard let data = characteristic.value, !data.isEmpty else {
            print("Received empty data in notification")
            return
        }
        
        // Process received data
        if characteristic.uuid == notifCharUUID {
            // Debug logs for notification data
            print("BLE: Received notification with \(data.count) bytes: \(data.map { String(format: "%02X", $0) }.joined(separator: " "))")
            
            // Store data in buffer
            storeBulkPkt(data)
        } else if characteristic.uuid == otaStatusCharUUID {
            guard let status = parseOtaStatus(data) else {
                setOtaUi(error: OtaError.invalidStatusPacket.localizedDescription)
                return
            }

            let progress = status.total > 0 ? min(1.0, Double(status.received) / Double(status.total)) : 0
            setOtaUi(
                progress: progress,
                status: String(format: "Status 0x%02X (%u/%u)", status.code, status.received, status.total)
            )

            if status.code == 0x13 {
                if let cont = otaCompletionContinuation {
                    otaCompletionContinuation = nil
                    cont.resume(returning: ())
                }
            } else if status.code == 0x14 || status.code == 0x15 {
                if let cont = otaCompletionContinuation {
                    otaCompletionContinuation = nil
                    cont.resume(throwing: OtaError.flashFailed(code: status.code, err: status.err))
                }
            }
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let cont = pendingWriteContinuations.removeValue(forKey: characteristic.uuid) {
            if let error {
                cont.resume(throwing: error)
            } else {
                cont.resume(returning: ())
            }
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if let error = error {
            print("Error changing notification state: \(error.localizedDescription)")
        } else {
            let state = characteristic.isNotifying ? "enabled" : "disabled"
            print("Notifications \(state)")
        }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        if let cont = canSendWithoutResponseContinuation {
            canSendWithoutResponseContinuation = nil
            cont.resume(returning: ())
        }
    }
}

private extension Data {
    func chunked(into size: Int) -> [Data] {
        guard size > 0 else { return [] }
        var chunks: [Data] = []
        chunks.reserveCapacity((count + size - 1) / size)

        var index = startIndex
        while index < endIndex {
            let end = self.index(index, offsetBy: size, limitedBy: endIndex) ?? endIndex
            chunks.append(self[index..<end])
            index = end
        }

        return chunks
    }
}

private extension BLEManager {
    static func nowMs() -> UInt64 {
        UInt64(Date().timeIntervalSince1970 * 1000)
    }
}
