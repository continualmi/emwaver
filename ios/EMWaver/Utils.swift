/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import Foundation
import JavaScriptCore

@objc protocol UtilsConversionExport: JSExport {
    func convertTimingsToBinary(_ timings: [Double]) -> Data
    static func logTimings(_ timings: [Double])
    func sleep(_ milliseconds: Int)
}

class Utils: NSObject, UtilsConversionExport {
    
    // Convert timings array to binary signal
    // Each timing represents a duration in microseconds for which the signal is high or low
    func convertTimingsToBinary(_ timings: [Double]) -> Data {
        var binaryData = [UInt8]()
        var currentByte: UInt8 = 0
        var bitPosition = 0
        
        // Alternate starting with high (1) for the first timing
        var state = true
        
        for timing in timings {
            let length = Int(round(timing / 10.0)) // Convert from 1μs to 10μs intervals
            
            for _ in 0..<length {
                if state {
                    currentByte |= (1 << (bitPosition % 8)) // Set bits from LSB to MSB
                }
                bitPosition += 1
                
                if bitPosition % 8 == 0 {
                    binaryData.append(currentByte)
                    currentByte = 0
                }
            }
            state = !state // Toggle state for each timing
        }
        
        // Add the last byte if it's not empty
        if bitPosition % 8 != 0 {
            binaryData.append(currentByte)
        }
        
        return Data(binaryData)
    }
    
    // Log timing values for debugging
    static func logTimings(_ timings: [Double]) {
        if timings.isEmpty {
            print("IR Timings: [empty]")
            return
        }
        
        var logString = "IR Timings: ["
        for (index, timing) in timings.enumerated() {
            logString += String(format: "%.2f", timing)
            if index < timings.count - 1 {
                logString += ", "
            }
            // Break the line every 10 elements for readability
            if (index + 1) % 10 == 0 {
                logString += "\n"
            }
        }
        logString += "]"
        
        print(logString)
    }
    
    // Sleep function for JavaScript
    func sleep(_ milliseconds: Int) {
        Thread.sleep(forTimeInterval: Double(milliseconds) / 1000.0)
    }
    
    // Convert hex string to byte array
    static func convertHexStringToByteArray(_ hexString: String) -> Data? {
        // Remove any non-hex characters (like spaces) if present
        let cleanedHexString = hexString.replacingOccurrences(of: "[^0-9A-Fa-f]", with: "", options: .regularExpression)
        
        // Check if the string has an even number of characters
        guard cleanedHexString.count % 2 == 0 else {
            print("Invalid hex string")
            return nil
        }
        
        var bytes = [UInt8]()
        var hexStringLog = ""
        
        for i in stride(from: 0, to: cleanedHexString.count, by: 2) {
            let startIndex = cleanedHexString.index(cleanedHexString.startIndex, offsetBy: i)
            let endIndex = cleanedHexString.index(startIndex, offsetBy: 2)
            let hexSubstring = cleanedHexString[startIndex..<endIndex]
            
            if let value = UInt8(hexSubstring, radix: 16) {
                bytes.append(value)
                hexStringLog += String(format: "%02X ", value)
            }
        }
        
        print("Payload bytes: \(hexStringLog)")
        
        return Data(bytes)
    }
    
    // Convert byte array to hex string
    static func bytesToHexString(_ bytes: [UInt8]) -> String {
        var hexString = ""
        for byte in bytes {
            hexString += String(format: "%02x", byte)
        }
        return hexString
    }
    
    // Convert byte array to hex string with "0x" prefix
    static func toHexStringWithHexPrefix(_ array: [UInt8]) -> String {
        if array.isEmpty {
            return "[]"
        }
        
        var hexString = "["
        for (index, byte) in array.enumerated() {
            hexString += "0x" + String(format: "%02X", byte)
            
            // Append comma and space if this is not the last byte
            if index < array.count - 1 {
                hexString += ", "
            }
        }
        hexString += "]"
        return hexString
    }
}
