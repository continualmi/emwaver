import Foundation
import CoreBluetooth
import SwiftUI
import Combine

class BLEManager: NSObject, ObservableObject {
    // MARK: - Published Properties
    @Published var isConnected = false
    @Published var isScanning = false
    @Published var bufferVersion: Int = 0
    
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
    
    // MARK: - Private Properties
    private var centralManager: CBCentralManager!
    private var peripheralDevice: CBPeripheral?
    private var cmdCharacteristic: CBCharacteristic?
    private var notifCharacteristic: CBCharacteristic?
    
    private var buffer = Data()
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
    
    func sendPacket(_ data: Data) {
        guard isConnected, let peripheral = peripheralDevice, let characteristic = cmdCharacteristic else {
            print("Cannot send packet: Not connected to device")
            return
        }
        
        // Write the data to the characteristic
        peripheral.writeValue(data, for: characteristic, type: .withResponse)
    }
    
    // MARK: - Buffer Operations
    func clearBuffer() {
        bufferQueue.sync {
            buffer.removeAll()
        }
        // Update UI-affecting state on main thread 
        DispatchQueue.main.async {
            self.isNewCommandAvailable = false
            self.bufferVersion += 1
        }
    }
    
    func storeBulkPkt(_ data: Data) {
        bufferQueue.sync {
            buffer.append(data)
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
                result = buffer
                buffer.removeAll()
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
    func loadBuffer(data: Data) {
        bufferQueue.sync {
            buffer = data
        }
        // Update UI-affecting state on main thread
        DispatchQueue.main.async {
            self.isNewCommandAvailable = !data.isEmpty // Use data parameter instead of buffer
            self.bufferVersion += 1
        }
        
        // Reset stats when loading new data
        totalBytesReceived = data.count 
        firstPacketTimeMillis = Date().timeIntervalSince1970
        lastPacketReceivedTime = firstPacketTimeMillis
    }

    /// Returns the entire content of the buffer.
    /// - Returns: The buffer data.
    func getBuffer() -> Data {
        var bufferCopy = Data()
        bufferQueue.sync {
            bufferCopy = buffer
        }
        return bufferCopy
    }

    /// Inverts all the bits in the buffer.
    func invertBuffer() {
        var isEmpty = false
        bufferQueue.sync {
            buffer = Data(buffer.map { ~$0 })
            isEmpty = buffer.isEmpty
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

        guard buffer.count >= totalSize else { return -1 }

        // Check from the end of the buffer
        for i in stride(from: buffer.count, to: totalSize - 1, by: -1) {
            let potentialHeaderIndex = i - totalSize
            let potentialHeader = buffer.subdata(in: potentialHeaderIndex..<(potentialHeaderIndex + headerSize))
            
            if potentialHeader == header {
                let statusData = buffer.subdata(in: (potentialHeaderIndex + headerSize)..<i)
                let status = UInt16(statusData[0]) << 8 | UInt16(statusData[1])
                
                // Remove the parsed status message from the buffer
                buffer.removeSubrange((potentialHeaderIndex)..<i)
                
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
        let bufferCopy = bufferQueue.sync { return buffer }
        
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
    func transmitBuffer() {
        guard isConnected, let peripheral = peripheralDevice, let characteristic = cmdCharacteristic else {
            print("Cannot transmit buffer: Not connected or characteristic not ready.")
            return
        }

        let bufferToSend = getBuffer() // Get a copy of the buffer
        guard !bufferToSend.isEmpty else {
            print("Buffer is empty, nothing to transmit.")
            return
        }
        
        clearBuffer() // Clear the main buffer after copying

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
            let bufferStatus = getStatusNumber() // Check for status in buffer
            
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
        
        // Clear buffer again to remove status packets received during transmission
        self.clearBuffer()
        print("SECOND_CLEAR: Buffer cleared again before reload")
        
        // Reload the original buffer content
        self.loadBuffer(data: bufferToSend)
        print("AFTER_RELOAD: Buffer now contains \(self.getBuffer().count) bytes")
        print("Buffer transmission complete: \(totalBytesToSend) bytes sent")
    }

    // MARK: - Public Accessors
    /// Expose the connected peripheral for read-only access (for debugging/logging only)
    var connectedPeripheral: CBPeripheral? {
        peripheralDevice
    }

    // Send a command and wait for response
    func sendCommand(_ command: Data, timeout: Int) -> Data? {
        guard isConnected, let peripheral = peripheralDevice, let characteristic = cmdCharacteristic else {
            print("Cannot send command: Not connected to device")
            return nil
        }
        
        // Start timing
        let startTime = Date().timeIntervalSince1970
        print("BLE: Sending command: \(command.map { String(format: "%02X", $0) }.joined(separator: " "))")
        
        // Clear any existing data
        bufferQueue.sync {
            buffer.removeAll()
            isNewCommandAvailable = false
        }
        
        // Write the command to the characteristic
        peripheral.writeValue(command, for: characteristic, type: .withResponse)
        print("BLE: Command written, waiting for response (timeout: \(timeout)ms)")
        
        // Wait for response
        var response: Data? = nil
        
        while (Date().timeIntervalSince1970 - startTime) * 1000 < Double(timeout) {
            response = getCommand()
            if let response = response, !response.isEmpty {
                let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
                print("BLE: Response received after \(Int(elapsedMs))ms: \(response.map { String(format: "%02X", $0) }.joined(separator: " "))")
                break
            }
            Thread.sleep(forTimeInterval: 0.01) // 10ms sleep to prevent busy waiting
        }
        
        // If we timed out waiting for a response
        if response == nil || response!.isEmpty {
            let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
            print("BLE: Command timed out after \(Int(elapsedMs))ms or received empty response")
        }
        
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
        peripheral.discoverServices([serviceUUID])
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
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error = error {
            print("Write failed: \(error.localizedDescription)")
        } else {
            print("Write successful")
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
}