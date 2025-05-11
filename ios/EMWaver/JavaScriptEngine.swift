import SwiftUI
import JavaScriptCore

// MARK: - JavaScript Engine

typealias JSPrintCallback = (String) -> Void

class JavaScriptEngine {
    private var context: JSContext?
    private var cc1101Wrapper: CC1101Wrapper?
    private var irEncoderWrapper: IrEncoderWrapper?
    private var bleManager: BLEManager
    private var printCallback: JSPrintCallback?
    
    init(bleManager: BLEManager) {
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
        
        // Create more advanced Utils for IR conversion
        let utils = Utils()
        
        // Register convertTimingsToBinary function
        let convertTimingsToBinaryFunc: @convention(block) ([Double]) -> JSValue = { timings in
            let binaryData = utils.convertTimingsToBinary(timings)
            
            // Convert to Uint8Array for JavaScript
            let jsArrayBuffer = JSValue(object: (binaryData as NSData), in: context)
            
            if let uint8ArrayConstructor = context.globalObject.forProperty("Uint8Array"),
               let jsArrayBuffer = jsArrayBuffer {
                return uint8ArrayConstructor.construct(withArguments: [jsArrayBuffer])
            } else {
                self.printCallback?("Error: Unable to create Uint8Array from binary data")
                return JSValue(nullIn: context)
            }
        }
        
        // Register convertToIRBuffer function
        let convertToIRBufferFunc: @convention(block) (JSValue) -> JSValue = { jsValue in
            // Convert the JavaScript Uint8Array to Swift Data
            var byteArray = [UInt8]()
            
            if let length = jsValue.forProperty("length").toNumber()?.intValue {
                for i in 0..<length {
                    if let byteValue = jsValue.atIndex(i)?.toNumber()?.uint8Value {
                        byteArray.append(byteValue)
                    }
                }
            }
            
            let inputData = Data(byteArray)
            let irData = utils.convertToIRBuffer(inputData)
            
            // Convert back to JavaScript Uint8Array
            let jsArrayBuffer = JSValue(object: (irData as NSData), in: context)
            
            if let uint8ArrayConstructor = context.globalObject.forProperty("Uint8Array"),
               let jsArrayBuffer = jsArrayBuffer {
                return uint8ArrayConstructor.construct(withArguments: [jsArrayBuffer])
            } else {
                self.printCallback?("Error: Unable to create Uint8Array from IR data")
                return JSValue(nullIn: context)
            }
        }
        
        // Register with JavaScript Utils object
        if let jsUtilsObject = context.globalObject.forProperty("Utils") {
            jsUtilsObject.setObject(convertTimingsToBinaryFunc, forKeyedSubscript: "convertTimingsToBinary" as NSString)
            jsUtilsObject.setObject(convertToIRBufferFunc, forKeyedSubscript: "convertToIRBuffer" as NSString)
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
                self.printCallback?("Sending packet: \(BLEManager.dataToHexString(data))")
                self.bleManager.sendPacket(data)
            } else {
                self.printCallback?("Error: Could not convert to byte array")
            }
        }
        
        // Create a simpler BLE service wrapper
        let bleService = JSValue(newObjectIn: context)
        bleService?.setValue(sendPacket, forProperty: "sendPacket")
        
        // Expose the BLE service to JavaScript
        context.setObject(bleService, forKeyedSubscript: "BLEService" as NSString)
    }
    
    func setupCC1101(_ cc1101: CC1101) {
        guard let context = context else { return }
        
        // Create the CC1101 wrapper for JavaScript
        cc1101Wrapper = CC1101Wrapper(cc1101: cc1101)
        
        // Expose the CC1101 instance directly to JavaScript
        if let cc1101Wrapper = cc1101Wrapper {
            context.setObject(cc1101Wrapper, forKeyedSubscript: "CC1101" as NSString)
        }
        
        // Add CC1101 constants directly to the JS context
        context.evaluateScript("""
            // Command strobes
            CC1101.SRES = 0x30;
            CC1101.SFSTXON = 0x31;
            CC1101.SXOFF = 0x32;
            CC1101.SCAL = 0x33;
            CC1101.SRX = 0x34;
            CC1101.STX = 0x35;
            CC1101.SIDLE = 0x36;
            
            // Modulation formats
            CC1101.MOD_2FSK = 0;
            CC1101.MOD_GFSK = 1;
            CC1101.MOD_ASK = 3;
            CC1101.MOD_4FSK = 4;
            CC1101.MOD_MSK = 7;
            
            // Power levels
            CC1101.POWER_MINUS_30_DBM = -30;
            CC1101.POWER_MINUS_20_DBM = -20;
            CC1101.POWER_MINUS_15_DBM = -15;
            CC1101.POWER_MINUS_10_DBM = -10;
            CC1101.POWER_0_DBM = 0;
            CC1101.POWER_5_DBM = 5;
            CC1101.POWER_7_DBM = 7;
            CC1101.POWER_10_DBM = 10;
            
            // Registers
            CC1101.IOCFG2 = 0x00;
            CC1101.IOCFG1 = 0x01;
            CC1101.IOCFG0 = 0x02;
            CC1101.FIFOTHR = 0x03;
            CC1101.PKTCTRL0 = 0x08;
            CC1101.FREQ2 = 0x0D;
            CC1101.FREQ1 = 0x0E;
            CC1101.FREQ0 = 0x0F;
            CC1101.MDMCFG4 = 0x10;
            CC1101.MDMCFG3 = 0x11;
            CC1101.MDMCFG2 = 0x12;
            CC1101.DEVIATN = 0x15;
            CC1101.PATABLE = 0x3E;
        """)
    }
    
    func setupIR() {
        guard let context = context else { return }
        
        // Create the IR encoder wrapper
        irEncoderWrapper = IrEncoderWrapper()
        
        // Create the IR encoding function for JavaScript
        let encodeIRFunc: @convention(block) (String, Int, Int, Int) -> JSValue? = { protocolName, deviceId, subdeviceId, functionCode in
            guard let irEncoderWrapper = self.irEncoderWrapper,
                  let sequence = irEncoderWrapper.encodeIR(protocol: protocolName, device: deviceId, subdevice: subdeviceId, function: functionCode) else {
                return JSValue(nullIn: context)
            }
            
            // Convert the Double array to a JavaScript array
            let jsArray = JSValue(newArrayIn: context)
            for (index, value) in sequence.enumerated() {
                jsArray?.setObject(value, atIndexedSubscript: Int(index))
            }
            return jsArray
        }
        
        // Create an IR service object for JavaScript
        let irService = JSValue(newObjectIn: context)
        irService?.setValue(encodeIRFunc, forProperty: "encodeIR")
        
        // Expose the IR service to JavaScript
        context.setObject(irService, forKeyedSubscript: "IRService" as NSString)
        
        // Add some common protocol definitions directly to the JS context
        context.evaluateScript("""
            // Common IR protocols
            IRService.PROTOCOL_NEC = "nec1";
            IRService.PROTOCOL_RC5 = "rc5";
            IRService.PROTOCOL_RC6 = "rc6";
            IRService.PROTOCOL_SONY = "sony";
            IRService.PROTOCOL_SAMSUNG = "Samsung20";
            IRService.PROTOCOL_JVC = "jvc";
            IRService.PROTOCOL_DENON = "denon";
        """)
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