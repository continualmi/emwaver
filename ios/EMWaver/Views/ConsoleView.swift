import SwiftUI
import JavaScriptCore

// MARK: - JavaScript Export Protocols

@objc protocol CC1101JSExport: JSExport {
    // Command strobes
    @objc func spiStrobe(_ commandStrobe: UInt8)
    
    // This isn't a direct method on CC1101, but we implement it in the wrapper
    // to provide a JavaScript-facing initialize() method
    @objc func initialize()
    
    // Register operations
    @objc func writeReg(_ addr: UInt8, _ value: UInt8)
    @objc func readReg(_ addr: UInt8) -> UInt8
    @objc func writeBurstReg(_ addr: UInt8, _ data: [UInt8], _ len: UInt8)
    @objc func readBurstReg(_ addr: UInt8, _ len: Int) -> [UInt8]
    
    // Configuration
    @objc func setFrequencyMHz(_ frequencyMHz: Double) -> Bool
    @objc func getFrequency() -> Double
    @objc func setDataRate(_ bitRate: Int) -> Bool
    @objc func getDataRate() -> Int
    @objc func setBandwidth(_ bandwidth: Double) -> Bool
    @objc func getBandwidth() -> Double
    @objc func setDeviation(_ deviation: Int) -> Bool
    @objc func getDeviation() -> Int
    @objc func setModulation(_ modulation: UInt8) -> Bool
    @objc func getModulation() -> Int
    @objc func setPowerLevel(_ powerLevel: Int) -> Bool
    @objc func getPowerLevel() -> Int
    
    // GDO configuration
    @objc func setGDOMode(_ gdo2: UInt8, _ gdo1: UInt8, _ gdo0: UInt8)
    
    // Calibration and reset
    @objc func calibrate()
    @objc func select315MHzAntenna()
    @objc func select433MHzAntenna()
    
    // Convenience methods
    @objc func setModulationAndPower(_ modulation: UInt8, _ dbm: Int) -> Bool
}

@objc class CC1101Wrapper: NSObject, CC1101JSExport {
    private let cc1101: CC1101
    
    init(cc1101: CC1101) {
        self.cc1101 = cc1101
        super.init()
    }
    
    @objc func spiStrobe(_ commandStrobe: UInt8) {
        cc1101.spiStrobe(commandStrobe: commandStrobe)
    }
    
    @objc func initialize() {
        // Call init() in JavaScript, but we map it to a reset and setup sequence
        spiStrobe(0x30) // SRES - Reset chip
        Thread.sleep(forTimeInterval: 0.1) // Wait for reset to complete
    }
    
    @objc func writeReg(_ addr: UInt8, _ value: UInt8) {
        cc1101.writeReg(addr: addr, value: value)
    }
    
    @objc func readReg(_ addr: UInt8) -> UInt8 {
        return cc1101.readReg(addr: addr)
    }
    
    @objc func writeBurstReg(_ addr: UInt8, _ data: [UInt8], _ len: UInt8) {
        cc1101.writeBurstReg(addr: addr, data: data, len: len)
    }
    
    @objc func readBurstReg(_ addr: UInt8, _ len: Int) -> [UInt8] {
        return cc1101.readBurstReg(addr: addr, len: len)
    }
    
    @objc func setFrequencyMHz(_ frequencyMHz: Double) -> Bool {
        return cc1101.setFrequencyMHz(frequencyMHz: frequencyMHz)
    }
    
    @objc func getFrequency() -> Double {
        return cc1101.getFrequency()
    }
    
    @objc func setDataRate(_ bitRate: Int) -> Bool {
        return cc1101.setDataRate(bitRate: bitRate)
    }
    
    @objc func getDataRate() -> Int {
        return cc1101.getDataRate()
    }
    
    @objc func setBandwidth(_ bandwidth: Double) -> Bool {
        return cc1101.setBandwidth(bandwidth: bandwidth)
    }
    
    @objc func getBandwidth() -> Double {
        return cc1101.getBandwidth()
    }
    
    @objc func setDeviation(_ deviation: Int) -> Bool {
        return cc1101.setDeviation(deviation: deviation)
    }
    
    @objc func getDeviation() -> Int {
        return cc1101.getDeviation()
    }
    
    @objc func setModulation(_ modulation: UInt8) -> Bool {
        return cc1101.setModulation(modulation: modulation)
    }
    
    @objc func getModulation() -> Int {
        return cc1101.getModulation()
    }
    
    @objc func setPowerLevel(_ powerLevel: Int) -> Bool {
        return cc1101.setPowerLevel(powerLevel: powerLevel)
    }
    
    @objc func getPowerLevel() -> Int {
        return cc1101.getPowerLevel()
    }
    
    @objc func setGDOMode(_ gdo2: UInt8, _ gdo1: UInt8, _ gdo0: UInt8) {
        cc1101.setGDOMode(gdo2: gdo2, gdo1: gdo1, gdo0: gdo0)
    }
    
    @objc func calibrate() {
        cc1101.calibrate()
    }
    
    @objc func select315MHzAntenna() {
        cc1101.select315MHzAntenna()
    }
    
    @objc func select433MHzAntenna() {
        cc1101.select433MHzAntenna()
    }
    
    @objc func setModulationAndPower(_ modulation: UInt8, _ dbm: Int) -> Bool {
        return cc1101.setModulationAndPower(modulation: modulation, dbm: dbm)
    }
}

// MARK: - JavaScript Utils Export

@objc protocol UtilsJSExport: JSExport {
    func sleep(_ milliseconds: Int)
}

class JSUtils: NSObject, UtilsJSExport {
    func sleep(_ milliseconds: Int) {
        Thread.sleep(forTimeInterval: Double(milliseconds) / 1000.0)
    }
}

// MARK: - BLE Manager Export

@objc protocol BLEManagerJSExport: JSExport {
    func getBuffer() -> Data
    func clearBuffer()
    func loadBuffer(data: Data)
    func sendPacket(_ data: Data)
    func sendCommand(_ command: Data, timeout: Int) -> Data?
}

// Extension to make BLEManager JavaScript-compatible
extension BLEManager: BLEManagerJSExport {}

struct ConsoleView: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var cc1101: CC1101?
    @State private var jsEngine: JavaScriptEngine?
    @State private var scriptContent: String = ""
    @State private var consoleOutput: String = "<Console>\n"
    @State private var currentScriptName: String?
    @State private var recentScripts: [String] = []
    @State private var hasUnsavedChanges: Bool = false
    @State private var isScriptRunning: Bool = false
    @State private var statusMessage: String = "Open a script"
    @State private var showingScriptOptions: Bool = false
    @State private var selectedScript: String?
    @State private var showingNewScriptAlert: Bool = false
    @State private var showingCopyScriptAlert: Bool = false
    @State private var showingDeleteConfirmation: Bool = false
    @State private var newScriptName: String = ""
    
    // Auto-save timer
    @State private var autoSaveTimer: Timer?
    private let autoSaveDelay: TimeInterval = 3.0
    
    var body: some View {
        VStack(spacing: 0) {
            // Top: Script Editor
            TextEditor(text: $scriptContent)
                .font(.system(.body, design: .monospaced))
                .disableAutocorrection(true)
                .padding(4)
                .background(Color(.systemGray6))
                .cornerRadius(8)
                .onChange(of: scriptContent) { _ in
                    hasUnsavedChanges = true
                    setupAutoSave()
                }
            
            Divider().padding(.vertical, 4)
            
            // Middle: Console Output
            ScrollView {
                Text(consoleOutput)
                    .font(.system(.body, design: .monospaced))
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black)
                    .foregroundColor(Color.green)
            }
            .frame(height: 150)
            .background(Color.black)
            .cornerRadius(8)
            
            Divider().padding(.vertical, 4)
            
            // Bottom: Script List
            VStack(alignment: .leading) {
                Text("Saved Scripts")
                    .font(.headline)
                    .padding(.horizontal)
                
                List {
                    ForEach(recentScripts, id: \.self) { script in
                        HStack {
                            Text(script)
                            Spacer()
                            if currentScriptName == script && hasUnsavedChanges {
                                Circle()
                                    .fill(Color.red)
                                    .frame(width: 8, height: 8)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            loadScript(script)
                        }
                        .onLongPressGesture {
                            selectedScript = script
                            showingScriptOptions = true
                        }
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
        .padding()
        .navigationTitle("Console")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarItems(
            leading: Text(statusMessage)
                .font(.subheadline)
                .foregroundColor(.secondary),
            trailing: HStack {
                Button(action: {
                    showingNewScriptAlert = true
                }) {
                    Image(systemName: "doc.badge.plus")
                }
                
                Button(action: {
                    if isScriptRunning {
                        stopScript()
                    } else {
                        executeScript()
                    }
                }) {
                    Image(systemName: isScriptRunning ? "stop.fill" : "play.fill")
                        .foregroundColor(isScriptRunning ? .red : .green)
                }
                
                Button(action: {
                    clearConsole()
                }) {
                    Image(systemName: "trash")
                }
                
                Menu {
                    Button("New Script") {
                        showingNewScriptAlert = true
                    }
                    
                    Button("Make Copy") {
                        showingCopyScriptAlert = true
                    }
                    
                    Divider()
                    
                    Button("Clear Console") {
                        clearConsole()
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        )
        .onAppear {
            loadRecentScripts()
            createDefaultScriptsIfNeeded()
            
            if bleManager.isConnected {
                cc1101 = CC1101(bleManager: bleManager)
                setupJSEngine()
            }
        }
        .onChange(of: bleManager.isConnected) { connected in
            if connected {
                cc1101 = CC1101(bleManager: bleManager)
                setupJSEngine()
            }
        }
        .alert("New Script", isPresented: $showingNewScriptAlert) {
            TextField("Script Name", text: $newScriptName)
            Button("Cancel", role: .cancel) {
                newScriptName = ""
            }
            Button("Create") {
                createNewScript(newScriptName)
                newScriptName = ""
            }
        } message: {
            Text("Enter a name for the new script")
        }
        .alert("Copy Script", isPresented: $showingCopyScriptAlert) {
            TextField("Script Name", text: $newScriptName)
            Button("Cancel", role: .cancel) {
                newScriptName = ""
            }
            Button("Copy") {
                copyCurrentScript(newScriptName)
                newScriptName = ""
            }
        } message: {
            Text("Enter a name for the copy")
        }
        .confirmationDialog("Script Options", isPresented: $showingScriptOptions, titleVisibility: .visible) {
            Button("Rename") {
                // Show rename dialog
                newScriptName = selectedScript ?? ""
                showingNewScriptAlert = true
            }
            
            Button("Delete", role: .destructive) {
                showingDeleteConfirmation = true
            }
            
            Button("Cancel", role: .cancel) {}
        }
        .alert("Delete Script", isPresented: $showingDeleteConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                if let script = selectedScript {
                    deleteScript(script)
                }
            }
        } message: {
            Text("Are you sure you want to delete \(selectedScript ?? "this script")?")
        }
    }
    
    // MARK: - Script Management
    
    private func getDocumentsDirectory() -> URL {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        return paths[0].appendingPathComponent("scripts", isDirectory: true)
    }
    
    private func ensureScriptDirectoryExists() {
        let scriptsDir = getDocumentsDirectory()
        if !FileManager.default.fileExists(atPath: scriptsDir.path) {
            try? FileManager.default.createDirectory(at: scriptsDir, withIntermediateDirectories: true)
        }
    }
    
    private func loadRecentScripts() {
        ensureScriptDirectoryExists()
        
        let scriptsDir = getDocumentsDirectory()
        do {
            let scriptFiles = try FileManager.default.contentsOfDirectory(at: scriptsDir, includingPropertiesForKeys: nil)
            let scriptNames = scriptFiles.map { $0.lastPathComponent }
            recentScripts = scriptNames.sorted()
        } catch {
            print("Error loading scripts: \(error.localizedDescription)")
        }
    }
    
    private func saveScript(_ name: String, content: String) {
        ensureScriptDirectoryExists()
        
        let scriptFile = getDocumentsDirectory().appendingPathComponent(name)
        do {
            try content.write(to: scriptFile, atomically: true, encoding: .utf8)
            
            // Update recent scripts list
            if !recentScripts.contains(name) {
                recentScripts.append(name)
                recentScripts.sort()
            }
        } catch {
            print("Error saving script: \(error.localizedDescription)")
        }
    }
    
    private func loadScript(_ name: String) {
        let scriptFile = getDocumentsDirectory().appendingPathComponent(name)
        do {
            scriptContent = try String(contentsOf: scriptFile, encoding: .utf8)
            currentScriptName = name
            hasUnsavedChanges = false
            statusMessage = name
        } catch {
            print("Error loading script: \(error.localizedDescription)")
        }
    }
    
    private func deleteScript(_ name: String) {
        let scriptFile = getDocumentsDirectory().appendingPathComponent(name)
        do {
            try FileManager.default.removeItem(at: scriptFile)
            
            // Update recent scripts list
            if let index = recentScripts.firstIndex(of: name) {
                recentScripts.remove(at: index)
            }
            
            // Clear editor if this script was loaded
            if currentScriptName == name {
                scriptContent = ""
                currentScriptName = nil
                statusMessage = "Open a script"
            }
        } catch {
            print("Error deleting script: \(error.localizedDescription)")
        }
    }
    
    private func createNewScript(_ name: String) {
        guard !name.isEmpty else { return }
        
        // Create a new script with default content
        saveScript(name, content: "// New script")
        loadScript(name)
    }
    
    private func copyCurrentScript(_ name: String) {
        guard !name.isEmpty, currentScriptName != nil else { return }
        
        // Copy current script content to a new script
        saveScript(name, content: scriptContent)
        loadScript(name)
    }
    
    private func setupAutoSave() {
        // Cancel existing timer
        autoSaveTimer?.invalidate()
        
        // Start new timer
        autoSaveTimer = Timer.scheduledTimer(withTimeInterval: autoSaveDelay, repeats: false) { _ in
            if let scriptName = currentScriptName, hasUnsavedChanges {
                saveScript(scriptName, content: scriptContent)
                hasUnsavedChanges = false
            }
        }
    }
    
    // MARK: - Console & Script Execution
    
    private func print(_ message: String) {
        DispatchQueue.main.async {
            self.consoleOutput.append(message + "\n")
        }
    }
    
    private func clearConsole() {
        consoleOutput = "<Console>\n"
    }
    
    private func setupJSEngine() {
        // Initialize JavaScript engine with BLEManager
        jsEngine = JavaScriptEngine(bleManager: bleManager)
        jsEngine?.setupContext(printCallback: { message in
            self.print(message)
        })
        
        // Set up CC1101 if available
        if let cc1101 = cc1101 {
            jsEngine?.setupCC1101(cc1101)
        }
        
        // Register script loading function
        jsEngine?.registerLoadFunction(scriptDirectoryURL: getDocumentsDirectory())
    }
    
    private func executeScript() {
        guard bleManager.isConnected else {
            print("Not connected to device. Please connect first.")
            return
        }
        
        guard jsEngine != nil else {
            print("JavaScript engine not initialized.")
            return
        }
        
        isScriptRunning = true
        
        // Execute the script
        jsEngine?.evaluateScript(scriptContent) {
            DispatchQueue.main.async {
                self.isScriptRunning = false
            }
        }
    }
    
    private func stopScript() {
        // Currently we can't easily interrupt the script execution in JSContext
        // Just update UI state
        isScriptRunning = false
        print("Script execution stopping...")
    }
    
    // MARK: - Default Scripts
    
    private func createDefaultScriptsIfNeeded() {
        ensureScriptDirectoryExists()
        
        // RX Continuous Script
        let rxScriptName = "cc1101_rx_continuous.js"
        let rxScriptPath = getDocumentsDirectory().appendingPathComponent(rxScriptName)
        
        if !FileManager.default.fileExists(atPath: rxScriptPath.path) {
            let rxContent = """
                // Reset the chip
                CC1101.spiStrobe(CC1101.SRES);
                CC1101.initialize();
                
                // Configure for continuous mode
                CC1101.writeReg(CC1101.PKTCTRL0, 0x32);
                CC1101.setGDOMode(0x2E, 0x2E, 0x0D);
                
                // Set frequency and data rate
                CC1101.setFrequencyMHz(433.92);
                CC1101.setDataRate(100000);
                
                // Set modulation and power
                CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);
                
                // Enter RX mode
                CC1101.spiStrobe(CC1101.SRX);
                print("init rx continuous successful!");
                """
            
            saveScript(rxScriptName, content: rxContent)
        }
        
        // TX Continuous Script
        let txScriptName = "cc1101_tx_continuous.js"
        let txScriptPath = getDocumentsDirectory().appendingPathComponent(txScriptName)
        
        if !FileManager.default.fileExists(atPath: txScriptPath.path) {
            let txContent = """
                // Reset the chip
                CC1101.spiStrobe(CC1101.SRES);
                CC1101.initialize();
                
                // Configure for continuous mode
                CC1101.writeReg(CC1101.PKTCTRL0, 0x32);
                CC1101.setGDOMode(0x2E, 0x2E, 0x0D);
                
                // Set frequency and data rate
                CC1101.setFrequencyMHz(433.92);
                CC1101.setDataRate(100000);
                
                // Set modulation and power
                CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);
                
                // Enter TX mode
                CC1101.spiStrobe(CC1101.STX);
                print("init tx continuous successful!");
                """
            
            saveScript(txScriptName, content: txContent)
        }
        
        loadRecentScripts()
    }
}

#Preview {
    NavigationView {
        ConsoleView()
            .environmentObject(BLEManager())
    }
} 