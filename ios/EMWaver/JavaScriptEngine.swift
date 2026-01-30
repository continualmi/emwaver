/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import SwiftUI
import JavaScriptCore

@objc protocol JSUtilsExport: JSExport {
    func sleep(_ milliseconds: Int)
    func delay(_ milliseconds: Int)
}

final class JSUtils: NSObject, JSUtilsExport {
    func sleep(_ milliseconds: Int) {
        Thread.sleep(forTimeInterval: TimeInterval(milliseconds) / 1000.0)
    }

    func delay(_ milliseconds: Int) {
        Thread.sleep(forTimeInterval: TimeInterval(milliseconds) / 1000.0)
    }
}

// MARK: - JavaScript Engine

typealias JSPrintCallback = (String) -> Void

class JavaScriptEngine {
    private var context: JSContext?
    private var bleManager: USBManager
    private var printCallback: JSPrintCallback?
    
    init(bleManager: USBManager) {
        self.bleManager = bleManager
    }
    
    func setupContext(printCallback: @escaping JSPrintCallback) {
        self.printCallback = printCallback
        
        // Create JavaScript context
        context = JSContext()
        
        guard let context = context else { return }
        
        // Handle JavaScript exceptions
        context.exceptionHandler = { _, exception in
            if let exception = exception {
                self.printCallback?("Error: \(exception.toString() ?? "Unknown error")")
            }
        }
        
        // Add print function
        let printFunc: @convention(block) (String) -> Void = { message in
            self.printCallback?(message)
        }
        context.setObject(printFunc, forKeyedSubscript: "print" as NSString)
        
        // Create simple utilities for JavaScript
        let jsUtils = JSUtils()
        context.setObject(jsUtils, forKeyedSubscript: "Utils" as NSString)

        let utils = Utils()

        // Register convertTimingsToBinary function
        let convertTimingsToBinaryFunc: @convention(block) ([Double]) -> JSValue = { timings in
            self.printCallback?("Converting \(timings.count) timings to binary")
            let binaryData = utils.convertTimingsToBinary(timings)
            
            // Use the same improved approach as other methods
            if let arrayBuffer = context.globalObject.forProperty("ArrayBuffer")?.construct(withArguments: [binaryData.count]) {
                let uint8Array = context.globalObject.forProperty("Uint8Array")?.construct(withArguments: [arrayBuffer])
                
                // Copy the data into the Uint8Array
                for i in 0..<binaryData.count {
                    uint8Array?.setObject(Int(binaryData[i]), atIndexedSubscript: i)
                }
                
                self.printCallback?("Created Uint8Array with \(binaryData.count) bytes for binary data")
                return uint8Array!
            } else {
                self.printCallback?("Error: Failed to create Uint8Array for binary data")
                return JSValue(nullIn: context)
            }
        }
        
        // Register with JavaScript Utils object
        if let jsUtilsObject = context.globalObject.forProperty("Utils") {
            jsUtilsObject.setObject(convertTimingsToBinaryFunc, forKeyedSubscript: "convertTimingsToBinary" as NSString)
        } else {
            self.printCallback?("Error: Unable to access Utils object in JavaScript context")
        }
        
        // Create simple array wrapper for sending packets
        let sendPacket: @convention(block) (JSValue) -> Void = { jsValue in
            var byteArray = [UInt8]()
            
            // Debug what type we're getting
            self.printCallback?("jsValue type: \(jsValue.isArray ? "Array" : "Non-Array")")
            
            // Try accessing each byte directly from the array
            if let length = jsValue.forProperty("length").toNumber()?.intValue {
                self.printCallback?("Array length: \(length)")
                
                for i in 0..<length {
                    if let byteValue = jsValue.atIndex(i)?.toNumber()?.uint8Value {
                        byteArray.append(byteValue)
                    }
                }
                
                self.printCallback?("Extracted \(byteArray.count) bytes")
            }
            
            // Check if we have data before sending
            if !byteArray.isEmpty {
                let data = Data(byteArray)
                self.printCallback?("Sending packet: \(USBManager.dataToHexString(data))")
                self.bleManager.sendPacket(data)
            } else {
                self.printCallback?("Error: Could not convert to byte array")
            }
        }
        
        // Create a simpler BLE service wrapper
        let bleService = JSValue(newObjectIn: context)
        bleService?.setValue(sendPacket, forProperty: "sendPacket")
        
        // Add loadBuffer method
        let loadBuffer: @convention(block) (JSValue) -> Void = { jsValue in
            // More detailed logging for debugging
            self.printCallback?("loadBuffer called with type: \(jsValue.isArray ? "Array" : jsValue.isObject ? "Object" : "Other")")
            
            if jsValue.isUndefined || jsValue.isNull {
                self.printCallback?("Error: loadBuffer received null or undefined")
                return
            }
            
            var byteArray = [UInt8]()
            
            // Try getting array properties even if not detected as array
            if let length = jsValue.forProperty("length").toNumber()?.intValue {
                self.printCallback?("Object has length property: \(length)")
                
                for i in 0..<length {
                    if let byteValue = jsValue.atIndex(i)?.toNumber()?.uint8Value {
                        byteArray.append(byteValue)
                    }
                }
                
                self.printCallback?("Extracted \(byteArray.count) bytes from object")
            }
            
            // If conversion failed, try alternate approaches
            if byteArray.isEmpty && jsValue.isObject {
                self.printCallback?("Trying alternative conversion for JavaScript object")
                
                // If it's a JavaScript ArrayBuffer, try direct conversion
                if let objectData = jsValue.toObject() as? NSData {
                    let data = Data(referencing: objectData)
                    self.printCallback?("Converted object directly to Data with size: \(data.count)")
                    self.bleManager.loadBuffer(data: data)
                    return
                } else {
                    // Dump some properties to understand what we're working with
                    self.printCallback?("Object properties: \(String(describing: jsValue.toDictionary()))")
                }
            }
            
            if !byteArray.isEmpty {
                let data = Data(byteArray)
                self.printCallback?("Loading buffer with \(byteArray.count) bytes")
                self.bleManager.loadBuffer(data: data)
            } else {
                self.printCallback?("Error: Could not convert to byte array for loadBuffer")
            }
        }
        
        // Add getBuffer method
        let getBuffer: @convention(block) () -> JSValue = {
            let bufferData = self.bleManager.getBuffer()
            self.printCallback?("Getting buffer with \(bufferData.count) bytes")
            
            if let arrayBuffer = context.globalObject.forProperty("ArrayBuffer")?.construct(withArguments: [bufferData.count]) {
                let uint8Array = context.globalObject.forProperty("Uint8Array")?.construct(withArguments: [arrayBuffer])
                
                // Copy the data into the Uint8Array
                for i in 0..<bufferData.count {
                    uint8Array?.setObject(Int(bufferData[i]), atIndexedSubscript: i)
                }
                
                self.printCallback?("Created Uint8Array with \(bufferData.count) bytes for buffer")
                return uint8Array!
            } else {
                self.printCallback?("Error: Failed to create Uint8Array for buffer data")
                return JSValue(nullIn: context)
            }
        }
        
        // Add clearBuffer method
        let clearBuffer: @convention(block) () -> Void = {
            self.bleManager.clearBuffer()
            self.printCallback?("Buffer cleared")
        }
        
        // Add transmitBuffer method
        let transmitBuffer: @convention(block) () -> Void = {
            self.printCallback?("Transmitting buffer...")
            self.bleManager.transmitBuffer()
        }
        
        // Add all methods to the BLEService object
        bleService?.setValue(loadBuffer, forProperty: "loadBuffer")
        bleService?.setValue(getBuffer, forProperty: "getBuffer")
        bleService?.setValue(clearBuffer, forProperty: "clearBuffer")
        bleService?.setValue(transmitBuffer, forProperty: "transmitBuffer")
        
        // Expose the BLE service to JavaScript
        context.setObject(bleService, forKeyedSubscript: "BLEService" as NSString)
    }
    
    func registerLoadFunction(scriptDirectoryURL: URL) {
        guard let context = context else { return }
        
        // Add load function to load other scripts
        let loadFunc: @convention(block) (String) -> Bool = { scriptName in
            let scriptFile = scriptDirectoryURL.appendingPathComponent(scriptName)
            do {
                let scriptContent = try String(contentsOf: scriptFile, encoding: .utf8)
                context.evaluateScript(scriptContent)
                return true
            } catch {
                self.printCallback?("Error loading script \(scriptName): \(error.localizedDescription)")
                return false
            }
        }
        context.setObject(loadFunc, forKeyedSubscript: "load" as NSString)
    }
    
    func evaluateScript(_ script: String, completion: (() -> Void)? = nil) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.context?.evaluateScript(script)
            
            if let completion = completion {
                DispatchQueue.main.async {
                    completion()
                }
            }
        }
    }
} 
