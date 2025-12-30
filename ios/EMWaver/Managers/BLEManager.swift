import Foundation
import CoreBluetooth
import SwiftUI
import Combine
import CryptoKit

class BLEManager: NSObject, ObservableObject {
    private static let packetSizeBytes: Int = 64

    struct ReadPackets {
        let data: [UInt8]
        let ts_ms: [UInt64]
        let next_packet_index: UInt64
        let available_packets: UInt64
    }

    private struct LogBuffer {
        var rxBytes = Data()
        var rxCounter: UInt64 = 0
        var rxTsMs: [UInt64] = []
        var txBytes = Data()
        var txTsMs: [UInt64] = []

        mutating func clear() {
            rxBytes.removeAll(keepingCapacity: true)
            rxCounter = 0
            rxTsMs.removeAll(keepingCapacity: true)
            txBytes.removeAll(keepingCapacity: true)
            txTsMs.removeAll(keepingCapacity: true)
        }

        func rxLenBytes() -> Int { rxBytes.count }
        func rxPacketCount() -> UInt64 { UInt64(rxBytes.count / BLEManager.packetSizeBytes) }
        func txPacketCount() -> UInt64 { UInt64(txTsMs.count) }

        mutating func rxSetBytes(_ data: Data) {
            rxBytes = data
            rxCounter = 0
            rxTsMs = Array(repeating: 0, count: Int(rxPacketCount()))
        }

        mutating func appendRxBytes(_ data: Data, tsMs: UInt64) {
            guard !data.isEmpty else { return }
            let prevPackets = rxBytes.count / BLEManager.packetSizeBytes
            rxBytes.append(data)
            let newPackets = rxBytes.count / BLEManager.packetSizeBytes
            let delta = max(0, newPackets - prevPackets)
            if delta > 0 {
                rxTsMs.append(contentsOf: Array(repeating: tsMs, count: delta))
            }
        }

        mutating func appendTxBytesAsPackets(_ data: Data, tsMs: UInt64) {
            guard !data.isEmpty else { return }
            let chunks = data.chunked(into: BLEManager.packetSizeBytes)
            for chunk in chunks {
                var packet = chunk
                if packet.count < BLEManager.packetSizeBytes {
                    packet.append(Data(repeating: 0, count: BLEManager.packetSizeBytes - packet.count))
                }
                txBytes.append(packet)
                txTsMs.append(tsMs)
            }
        }

        func readRxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
            let available = rxPacketCount()
            guard available > 0, maxPackets > 0, packetIndex < available else {
                return ReadPackets(
                    data: [],
                    ts_ms: [],
                    next_packet_index: min(packetIndex, available),
                    available_packets: available
                )
            }

            let remaining = Int(available - packetIndex)
            let take = min(remaining, maxPackets)
            let start = Int(packetIndex) * BLEManager.packetSizeBytes
            let end = start + take * BLEManager.packetSizeBytes
            let slice = rxBytes.subdata(in: start..<min(end, rxBytes.count))

            let tsStart = Int(packetIndex)
            let tsEnd = min(tsStart + take, rxTsMs.count)
            let ts = Array(rxTsMs[tsStart..<tsEnd])

            return ReadPackets(
                data: Array(slice),
                ts_ms: ts,
                next_packet_index: packetIndex + UInt64(take),
                available_packets: available
            )
        }

        func readTxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
            let available = txPacketCount()
            guard available > 0, maxPackets > 0, packetIndex < available else {
                return ReadPackets(
                    data: [],
                    ts_ms: [],
                    next_packet_index: min(packetIndex, available),
                    available_packets: available
                )
            }

            let remaining = Int(available - packetIndex)
            let take = min(remaining, maxPackets)
            let start = Int(packetIndex) * BLEManager.packetSizeBytes
            let end = start + take * BLEManager.packetSizeBytes
            let slice = txBytes.subdata(in: start..<min(end, txBytes.count))

            let tsStart = Int(packetIndex)
            let tsEnd = min(tsStart + take, txTsMs.count)
            let ts = Array(txTsMs[tsStart..<tsEnd])

            return ReadPackets(
                data: Array(slice),
                ts_ms: ts,
                next_packet_index: packetIndex + UInt64(take),
                available_packets: available
            )
        }
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
    
    private var logBuffer = LogBuffer()
    private var isNewCommandAvailable = false
    // Add a serial queue for thread-safe buffer access
    private let bufferQueue = DispatchQueue(label: "com.emwaver.bufferQueue")
    
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

        bufferQueue.sync {
            logBuffer.appendTxBytesAsPackets(data, tsMs: Self.nowMs())
        }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
        
        // Write the data to the characteristic
        peripheral.writeValue(data, for: characteristic, type: .withResponse)
    }

    // MARK: - Desktop-like Buffer Monitor APIs (non-destructive)

    func bufferClear() {
        clearBuffer()
    }

    func bufferReadPacketsSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        bufferQueue.sync {
            logBuffer.readRxSince(packetIndex: packetIndex, maxPackets: maxPackets)
        }
    }

    func bufferReadTxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        bufferQueue.sync {
            logBuffer.readTxSince(packetIndex: packetIndex, maxPackets: maxPackets)
        }
    }

    func bufferGetPacketCount() -> UInt64 {
        bufferQueue.sync { logBuffer.rxPacketCount() }
    }

    func bufferGetTxPacketCount() -> UInt64 {
        bufferQueue.sync { logBuffer.txPacketCount() }
    }
    
    // MARK: - Buffer Operations
    @objc func clearBuffer() {
        bufferQueue.sync {
            logBuffer.clear()
        }
        // Update UI-affecting state on main thread 
        DispatchQueue.main.async {
            self.isNewCommandAvailable = false
            self.bufferVersion += 1
        }
    }
    
    func storeBulkPkt(_ data: Data) {
        bufferQueue.sync {
            logBuffer.appendRxBytes(data, tsMs: Self.nowMs())
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
        var result: Data?
        bufferQueue.sync {
            if isNewCommandAvailable {
                result = logBuffer.rxBytes
                logBuffer.rxBytes.removeAll(keepingCapacity: true)
                logBuffer.rxCounter = 0
                logBuffer.rxTsMs.removeAll(keepingCapacity: true)
                isNewCommandAvailable = false  // Reset flag synchronously
            }
        }
        return result
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
        bufferQueue.sync {
            logBuffer.rxSetBytes(data)
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
        var bufferCopy = Data()
        bufferQueue.sync {
            bufferCopy = logBuffer.rxBytes
        }
        return bufferCopy
    }

    /// Inverts all the bits in the buffer.
    func invertBuffer() {
        var isEmpty = false
        bufferQueue.sync {
            logBuffer.rxBytes = Data(logBuffer.rxBytes.map { ~$0 })
            isEmpty = logBuffer.rxBytes.isEmpty
        }
        // Update UI-affecting state on main thread
        DispatchQueue.main.async {
            self.isNewCommandAvailable = !isEmpty
            self.bufferVersion += 1
        }
    }

    /// Parses the buffer status ("BS" + 2 bytes) from the end of the buffer.
    /// Removes the status message if found.
    /// - Returns: The status number, or -1 if not found.
    func getStatusNumber() -> Int {
        let header = Data("BS".utf8)
        let headerSize = header.count
        let statusSize = 2 // 2 bytes for the status number
        let totalSize = headerSize + statusSize

        guard logBuffer.rxBytes.count >= totalSize else { return -1 }

        // Check from the end of the buffer
        for i in stride(from: logBuffer.rxBytes.count, to: totalSize - 1, by: -1) {
            let potentialHeaderIndex = i - totalSize
            let potentialHeader = logBuffer.rxBytes.subdata(in: potentialHeaderIndex..<(potentialHeaderIndex + headerSize))
            
            if potentialHeader == header {
                let statusData = logBuffer.rxBytes.subdata(in: (potentialHeaderIndex + headerSize)..<i)
                let status = UInt16(statusData[0]) << 8 | UInt16(statusData[1])
                
                // Remove the parsed status message from the buffer
                logBuffer.rxBytes.removeSubrange((potentialHeaderIndex)..<i)
                
                return Int(status)
            }
        }
        return -1
    }

    /// Compresses the buffer data bits for chart display using min/max sampling.
    /// - Parameters:
    ///   - rangeStart: The starting bit index (inclusive).
    ///   - rangeEnd: The ending bit index (exclusive).
    ///   - numberBins: The number of bins for compression.
    /// - Returns: A tuple containing arrays of time values (Float) and corresponding data values (Float).
    func compressDataBits(rangeStart: Int, rangeEnd: Int, numberBins: Int) -> ([Float], [Float]) {
        // EXACTLY match Android implementation
        let timePerSample: Float = 1.0
        var timeValues: [Float] = []
        var dataValues: [Float] = []
        
        // Get a thread-safe copy of the buffer
        let bufferCopy = bufferQueue.sync { return logBuffer.rxBytes }
        
        // Empty buffer check
        if bufferCopy.isEmpty || rangeStart >= rangeEnd || numberBins <= 0 {
            return ([], [])
        }
        
        let totalPointsInRange = Float(rangeEnd - rangeStart) / timePerSample
        
        // IMPROVED: Enhanced handling of zoomed-in views - show raw points at higher zoom levels
        // Original condition: totalPointsInRange <= Float(numberBins * 2)
        // Enhanced condition: check if range is small enough for high-quality display
        let isZoomedIn = totalPointsInRange <= 3000
        let shouldShowRawPoints = isZoomedIn || totalPointsInRange <= Float(numberBins * 2)
        
        if shouldShowRawPoints {
            // When zoomed in enough, show individual samples
            for i in rangeStart..<rangeEnd {
                let byteIndex = i / 8
                let bitIndex = i % 8
                
                if byteIndex < bufferCopy.count {
                    let bit = (bufferCopy[byteIndex] >> bitIndex) & 1
                    timeValues.append(Float(i) * timePerSample)
                    dataValues.append(bit == 1 ? 255.0 : 0.0)
                }
            }
        } else {
            // Perform min/max compression - EXACTLY like Android
            let binWidth = totalPointsInRange / Float(numberBins)
            
            for bin in 0..<numberBins {
                let binStart = Int(Float(rangeStart) + Float(bin) * binWidth)
                let binEnd = min(rangeEnd, Int(Float(binStart) + binWidth))
                
                var foundData = false
                var minVal: Float = 255.0
                var maxVal: Float = 0.0
                
                for i in binStart..<binEnd {
                    let byteIndex = i / 8
                    let bitIndex = i % 8
                    
                    if byteIndex < bufferCopy.count {
                        let bit = (bufferCopy[byteIndex] >> bitIndex) & 1
                        let value: Float = bit == 1 ? 255.0 : 0.0
                        minVal = min(minVal, value)
                        maxVal = max(maxVal, value)
                        foundData = true
                    }
                }
                
                if foundData {
                    // Add min point
                    timeValues.append(Float(binStart) * timePerSample)
                    dataValues.append(minVal)
                    
                    // Add max point
                    timeValues.append(Float(binEnd - 1) * timePerSample)
                    dataValues.append(maxVal)
                }
            }
        }
        
        return (timeValues, dataValues)
    }
    
    /// Transmits the current buffer content to the connected peripheral.
    /// Implements flow control based on status feedback from the device.
    @objc func transmitBuffer() {
        guard isConnected, let peripheral = peripheralDevice, let characteristic = cmdCharacteristic else {
            print("Cannot transmit buffer: Not connected or characteristic not ready.")
            return
        }

        let bufferToSend = getBuffer() // Get a copy of the buffer
        guard !bufferToSend.isEmpty else {
            print("Buffer is empty, nothing to transmit.")
            return
        }

        // Desktop parity: swap out RX buffer while transmitting so status/response packets
        // don't contaminate sampler data stored in the same buffer.
        bufferQueue.sync {
            logBuffer.rxBytes.removeAll(keepingCapacity: true)
            logBuffer.rxCounter = 0
            logBuffer.rxTsMs.removeAll(keepingCapacity: true)
            isNewCommandAvailable = false
        }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }

        let totalBytesToSend = bufferToSend.count
        let maxPacketSize = 200 // Corresponds to peripheral's capability or MTU-3
        let minPacketSize = 128
        let initialPacketSize = 188
        var currentPacketSize = maxPacketSize // Start with max for initial fill
        
        let fixedDelayMs: Double = 15.0 // Milliseconds, match Android's 15ms

        // Flow control thresholds (match Android)
        let targetBufferLevel = 2048
        let bufferHighThreshold = 3000
        let bufferLowThreshold = 1000
        let initialFillBytes = 2048

        print("Starting buffer transmission: \(totalBytesToSend) bytes, Fixed Delay: \(fixedDelayMs)ms")
        print("Flow control: Decrease if buffer > \(bufferHighThreshold), Increase if buffer < \(bufferLowThreshold)")

        var bytesSent = 0
        while bytesSent < totalBytesToSend {
            // --- Get ESP32 Buffer Status ---
            let bufferStatus = bufferQueue.sync { getStatusNumber() } // Check for status in RX scratch buffer
            
            // For simulation/testing, if no status received, assume target level
            let effectiveBufferStatus = (bufferStatus != -1) ? bufferStatus : targetBufferLevel
            
            print("Buffer Status: \(effectiveBufferStatus) | Pkt Size: \(currentPacketSize)")

            // --- Calculate Packet ---
            let remainingBytes = totalBytesToSend - bytesSent
            let packetSize = min(currentPacketSize, remainingBytes)
            let endRange = bytesSent + packetSize
            let packet = bufferToSend.subdata(in: bytesSent..<endRange)

            // --- Send Packet ---
            // Use .withoutResponse to match Android's behavior
            bufferQueue.sync {
                logBuffer.appendTxBytesAsPackets(packet, tsMs: Self.nowMs())
            }
            DispatchQueue.main.async {
                self.bufferVersion += 1
            }
            peripheral.writeValue(packet, for: characteristic, type: .withoutResponse)
            
            // --- Apply Flow Control (after initial fill) ---
            if bytesSent >= initialFillBytes {
                if effectiveBufferStatus > bufferHighThreshold {
                    // Buffer too full, slow down
                    let newSize = max(minPacketSize, currentPacketSize - 32)
                    if newSize != currentPacketSize { currentPacketSize = newSize }
                } else if effectiveBufferStatus < bufferLowThreshold {
                    // Buffer too empty, speed up
                    let newSize = min(maxPacketSize, currentPacketSize + 32)
                    if newSize != currentPacketSize { currentPacketSize = newSize }
                } else {
                    // In target range, nudge towards initialPacketSize if close
                    if currentPacketSize != initialPacketSize && abs(effectiveBufferStatus - targetBufferLevel) < 100 {
                        if currentPacketSize < initialPacketSize {
                            currentPacketSize = min(initialPacketSize, currentPacketSize + 16)
                        } else if currentPacketSize > initialPacketSize {
                            currentPacketSize = max(initialPacketSize, currentPacketSize - 16)
                        }
                    }
                }
            } else {
                // During initial fill, keep max packet size
                currentPacketSize = maxPacketSize
            }
            
            // --- Fixed Delay - MATCH ANDROID BEHAVIOR ---
            // Use Thread.sleep for consistent timing (blocks thread but ensures timing precision)
            Thread.sleep(forTimeInterval: fixedDelayMs / 1000.0)

            bytesSent = endRange
        }
        
        print("BEFORE_RELOAD: Total bytes sent: \(bytesSent)")

        // Add delay for in-flight notifications (100ms - match Android exactly)
        Thread.sleep(forTimeInterval: 0.1) // 100ms delay
        
        // Discard RX scratch packets accumulated during transmit and restore the sampler buffer.
        bufferQueue.sync {
            logBuffer.rxSetBytes(bufferToSend)
            isNewCommandAvailable = !bufferToSend.isEmpty
        }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
        print("AFTER_RELOAD: Buffer now contains \(self.getBuffer().count) bytes")
        print("Buffer transmission complete: \(totalBytesToSend) bytes sent")
    }

    // MARK: - Public Accessors
    /// Expose the connected peripheral for read-only access (for debugging/logging only)
    var connectedPeripheral: CBPeripheral? {
        peripheralDevice
    }

    // Send a command and wait for response
    @objc func sendCommand(_ command: Data, timeout: Int) -> Data? {
        guard isConnected, let peripheral = peripheralDevice, let characteristic = cmdCharacteristic else {
            print("Cannot send command: Not connected to device")
            return nil
        }
        
        // Start timing
        let startTime = Date().timeIntervalSince1970
        print("BLE: Sending command: \(command.map { String(format: "%02X", $0) }.joined(separator: " "))")

        let startPacketIndex = bufferQueue.sync { logBuffer.rxPacketCount() }

        bufferQueue.sync {
            logBuffer.appendTxBytesAsPackets(command, tsMs: Self.nowMs())
        }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
        
        // Write the command to the characteristic
        peripheral.writeValue(command, for: characteristic, type: .withResponse)
        print("BLE: Command written, waiting for response (timeout: \(timeout)ms)")
        
        var firstResponseAt: TimeInterval? = nil
        var lastPacketCount = startPacketIndex

        while (Date().timeIntervalSince1970 - startTime) * 1000 < Double(timeout) {
            let packetCount = bufferQueue.sync { logBuffer.rxPacketCount() }
            if packetCount > lastPacketCount {
                lastPacketCount = packetCount
                if firstResponseAt == nil {
                    firstResponseAt = Date().timeIntervalSince1970
                }
            }

            if packetCount > startPacketIndex, let firstAt = firstResponseAt {
                // Small idle window to accumulate multi-packet responses.
                let elapsedSinceFirstMs = (Date().timeIntervalSince1970 - firstAt) * 1000
                if elapsedSinceFirstMs >= 30 {
                    break
                }
            }

            Thread.sleep(forTimeInterval: 0.01)
        }

        let endPacketCount = bufferQueue.sync { logBuffer.rxPacketCount() }
        guard endPacketCount > startPacketIndex else {
            let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
            print("BLE: Command timed out after \(Int(elapsedMs))ms or received empty response")
            return nil
        }

        let resp = bufferQueue.sync {
            logBuffer.readRxSince(packetIndex: startPacketIndex, maxPackets: Int(endPacketCount - startPacketIndex))
        }
        let response = Data(resp.data)
        let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
        print("BLE: Response received after \(Int(elapsedMs))ms: \(response.map { String(format: "%02X", $0) }.joined(separator: " "))")
        return response
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
