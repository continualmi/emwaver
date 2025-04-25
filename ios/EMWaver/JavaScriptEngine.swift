import SwiftUI
import JavaScriptCore

// MARK: - JavaScript Engine

typealias JSPrintCallback = (String) -> Void

class JavaScriptEngine {
    private var context: JSContext?
    private var cc1101Wrapper: CC1101Wrapper?
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
        
        // Create utilities
        let utils = JSUtils()
        context.setObject(utils, forKeyedSubscript: "Utils" as NSString)
        
        // Expose the BLEManager to JavaScript
        context.setObject(bleManager, forKeyedSubscript: "BLEService" as NSString)
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