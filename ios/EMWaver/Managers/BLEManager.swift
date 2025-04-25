import Foundation
import CoreBluetooth
import SwiftUI
import Combine

class BLEManager: NSObject, ObservableObject {
    // MARK: - Published Properties
    @Published var isConnected = false
    @Published var isScanning = false
    
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
        centralManager = CBCentralManager(delegate: self, queue: nil)
    }
    
    // MARK: - Public Methods
    func startScan() {
        guard centralManager.state == .poweredOn else {
            print("Bluetooth is not powered on")
            return
        }
        
        isScanning = true
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
        isScanning = false
        print("Stopped scanning")
    }
    
    func disconnect() {
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
        buffer.removeAll()
        isNewCommandAvailable = false
    }
    
    func storeBulkPkt(_ data: Data) {
        buffer.append(data)
        isNewCommandAvailable = true
        
        // Update statistics
        let currentTime = Date().timeIntervalSince1970
        lastPacketReceivedTime = currentTime
        
        if totalBytesReceived == 0 {
            firstPacketTimeMillis = currentTime
        }
        
        totalBytesReceived += data.count
    }
    
    func getCommand() -> Data? {
        guard isNewCommandAvailable else { return nil }
        
        let result = buffer
        buffer.removeAll()
        isNewCommandAvailable = false
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
}

// MARK: - CBCentralManagerDelegate
extension BLEManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            print("Bluetooth is powered on")
        case .poweredOff:
            print("Bluetooth is powered off")
            isConnected = false
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
        isConnected = true
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
        isConnected = false
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
            return
        }
        
        // Process received data
        if characteristic.uuid == notifCharUUID {
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