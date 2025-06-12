import SwiftUI
import JavaScriptCore
import UniformTypeIdentifiers
import Combine

// MARK: - Extension for UTType
extension UTType {
    static var javascript: UTType {
        UTType(filenameExtension: "js") ?? .plainText
    }
}

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
    func delay(_ milliseconds: Int)
}

class JSUtils: NSObject, UtilsJSExport {
    func sleep(_ milliseconds: Int) {
        Thread.sleep(forTimeInterval: Double(milliseconds) / 1000.0)
    }
    
    func delay(_ milliseconds: Int) {
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
    func transmitBuffer()
}

// Extension to make BLEManager JavaScript-compatible
extension BLEManager: BLEManagerJSExport {}

// MARK: - TextEditor with keyboard toolbar
struct KeyboardToolbarTextEditor: View {
    @Binding var text: String
    @State private var showKeyboard = false
    @FocusState private var isFocused: Bool
    var font: Font
    
    var body: some View {
        ZStack(alignment: .bottom) {
            TextEditor(text: $text)
                .font(font)
                .disableAutocorrection(true)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .focused($isFocused)
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") {
                            isFocused = false
                        }
                    }
                }
                .onChange(of: isFocused) { focused in
                    showKeyboard = focused
                }
            
            // Optional background tap gesture to dismiss keyboard
            if showKeyboard {
                Color.clear
                    .contentShape(Rectangle())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onTapGesture {
                        isFocused = false
                    }
                    .ignoresSafeArea()
            }
        }
    }
}

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
    @State private var dynamicScriptEditorTitle: String = "Script Editor [No script open]"
    @State private var showingScriptOptions: Bool = false
    @State private var selectedScript: String?
    @State private var showingNewScriptAlert: Bool = false
    @State private var showingCopyScriptAlert: Bool = false
    @State private var showingDeleteConfirmation: Bool = false
    @State private var newScriptName: String = ""
    
    // Auto-save timer
    @State private var autoSaveTimer: Timer?
    private let autoSaveDelay: TimeInterval = 3.0
    
    // State for collapsible sections
    @State private var isScriptsListExpanded: Bool = true
    @State private var isScriptEditorExpanded: Bool = true
    @State private var isConsoleOutputExpanded: Bool = true
    
    // MARK: - External Storage & Network Operations
    
    @State private var showingFileImporter = false
    @State private var showingFileExporter = false
    @State private var showingURLPrompt = false
    @State private var downloadURL = ""
    
    var body: some View {
        VStack(spacing: 8) {
            scriptsListSection
            scriptEditorSection
            consoleOutputSection
            
            Spacer()
        }
        .padding()
        .navigationTitle("Console")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarItems(
            leading: EmptyView(),
            trailing: HStack {
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
                
                menuButton
            }
        )
        .toolbar {
            ToolbarItem(placement: .principal) {
                EmptyView()
            }
        }
        .onAppear {
            let appearance = UINavigationBarAppearance()
            appearance.configureWithOpaqueBackground()
            UINavigationBar.appearance().standardAppearance = appearance
            UINavigationBar.appearance().compactAppearance = appearance
            UINavigationBar.appearance().scrollEdgeAppearance = appearance
            
            loadRecentScripts()
            createDefaultScriptsIfNeeded()
            updateDynamicScriptEditorTitle()
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                refreshUIAfterLoading()
            }
            
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
        .animation(.easeInOut, value: isScriptsListExpanded)
        .animation(.easeInOut, value: isScriptEditorExpanded)
        .animation(.easeInOut, value: isConsoleOutputExpanded)
        .applyAlerts(
            showingNewScriptAlert: $showingNewScriptAlert,
            newScriptName: $newScriptName,
            createNewScript: createNewScript,
            showingCopyScriptAlert: $showingCopyScriptAlert,
            copyCurrentScript: copyCurrentScript,
            showingScriptOptions: $showingScriptOptions,
            selectedScript: selectedScript,
            showingDeleteConfirmation: $showingDeleteConfirmation,
            deleteScript: deleteScript,
            showingFileImporter: $showingFileImporter,
            importScriptFromExternalStorage: importScriptFromExternalStorage,
            showingFileExporter: $showingFileExporter,
            scriptDocument: ScriptDocument(scriptContent),
            currentScriptName: currentScriptName,
            showingURLPrompt: $showingURLPrompt, 
            downloadURL: $downloadURL,
            downloadScriptFromURL: downloadScriptFromURL
        )
    }
    
    // MARK: - View Components
    
    private var scriptsListSection: some View {
        DisclosureGroup(
            isExpanded: $isScriptsListExpanded,
            content: {
                if recentScripts.isEmpty {
                    Text("No scripts available")
                        .italic()
                        .foregroundColor(.gray)
                        .padding()
                } else {
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
                                withAnimation {
                                    isScriptEditorExpanded = true
                                }
                            }
                            .onLongPressGesture {
                                selectedScript = script
                                showingScriptOptions = true
                            }
                        }
                    }
                    .listStyle(PlainListStyle())
                    .frame(minHeight: 100, maxHeight: 200)
                }
            },
            label: {
                HStack {
                    Text("Available Scripts")
                        .font(.headline)
                    if !recentScripts.isEmpty {
                        Text("(\(recentScripts.count))")
                            .foregroundColor(.secondary)
                    }
                }
            }
        )
        .padding(.horizontal)
    }
    
    private var scriptEditorSection: some View {
        DisclosureGroup(
            isExpanded: $isScriptEditorExpanded,
            content: {
                KeyboardToolbarTextEditor(text: $scriptContent, font: .system(.body, design: .monospaced))
                    .padding(4)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    .frame(minHeight: 100, maxHeight: 250)
                    .onChange(of: scriptContent) { _ in
                        hasUnsavedChanges = true
                        updateDynamicScriptEditorTitle()
                        setupAutoSave()
                    }
            },
            label: {
                Text(dynamicScriptEditorTitle)
                    .font(.headline)
            }
        )
        .padding(.horizontal)
    }
    
    private var consoleOutputSection: some View {
        DisclosureGroup(
            isExpanded: $isConsoleOutputExpanded,
            content: {
                ScrollView {
                    Text(consoleOutput)
                        .font(.system(.body, design: .monospaced))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color.black)
                .foregroundColor(Color.green)
                .cornerRadius(8)
                .frame(minHeight: 100, maxHeight: 200)
            },
            label: {
                Text("Output Console")
                    .font(.headline)
            }
        )
        .padding(.horizontal)
    }
    
    private var menuButton: some View {
        Menu {
            Button("New Script") {
                showingNewScriptAlert = true
            }
            
            Button("Make Copy") {
                showingCopyScriptAlert = true
            }
            
            Divider()
            
            Button("Import from Files") {
                showingFileImporter = true
            }
            
            Button("Export to Files") {
                if currentScriptName != nil {
                    showingFileExporter = true
                } else {
                    print("No script open to export")
                }
            }
            
            Divider()
            
            Button("Download from URL") {
                showingURLPrompt = true
            }
        } label: {
            Image(systemName: "ellipsis.circle")
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
        updateDynamicScriptEditorTitle()
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
        updateDynamicScriptEditorTitle()
    }
    
    private func loadScript(_ name: String) {
        let scriptFile = getDocumentsDirectory().appendingPathComponent(name)
        do {
            scriptContent = try String(contentsOf: scriptFile, encoding: .utf8)
            currentScriptName = name
            hasUnsavedChanges = false
            statusMessage = name
            updateDynamicScriptEditorTitle()
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
            updateDynamicScriptEditorTitle()
        } catch {
            print("Error deleting script: \(error.localizedDescription)")
        }
    }
    
    private func createNewScript(_ name: String) {
        guard !name.isEmpty else { return }
        
        // Create a new script with default content
        let filename = getExportFilename(name)
        saveScript(filename, content: "// New script")
        loadScript(filename)
    }
    
    private func copyCurrentScript(_ name: String) {
        guard !name.isEmpty, currentScriptName != nil else { return }
        
        // Copy current script content to a new script
        let filename = getExportFilename(name)
        saveScript(filename, content: scriptContent)
        loadScript(filename)
    }
    
    private func setupAutoSave() {
        // Cancel existing timer
        autoSaveTimer?.invalidate()
        
        // Start new timer
        autoSaveTimer = Timer.scheduledTimer(withTimeInterval: autoSaveDelay, repeats: false) { _ in
            if let scriptName = currentScriptName, hasUnsavedChanges {
                saveScript(scriptName, content: scriptContent)
                hasUnsavedChanges = false
                updateDynamicScriptEditorTitle()
            }
        }
    }
    
    // MARK: - Dynamic Title Update
    private func updateDynamicScriptEditorTitle() {
        if let name = currentScriptName {
            dynamicScriptEditorTitle = "\(name)\(hasUnsavedChanges ? " *" : "")"
        } else {
            dynamicScriptEditorTitle = "Script Editor [No script open]"
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
        
        // Set up CC1101 if available (create instance if connected and not already created)
        if bleManager.isConnected && cc1101 == nil {
            cc1101 = CC1101(bleManager: bleManager)
        }
        
        if let cc1101 = cc1101 {
            jsEngine?.setupCC1101(cc1101)
        }
        
        // Set up IR encoder
        jsEngine?.setupIR()
        
        // Register script loading function
        jsEngine?.registerLoadFunction(scriptDirectoryURL: getDocumentsDirectory())
    }
    
    private func executeScript() {
        // Initialize JS engine if not already done (allows script execution even when disconnected)
        if jsEngine == nil {
            setupJSEngine()
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
            print("Created default RX script")
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
            print("Created default TX script")
        }
        
        // IR Test Script
        let irTestScriptName = "ir_test.js"
        let irTestScriptPath = getDocumentsDirectory().appendingPathComponent(irTestScriptName)
        
        if !FileManager.default.fileExists(atPath: irTestScriptPath.path) {
            let irTestContent = """
                // Simple IR Test Script
                // Tests encoding common IR protocols

                print("Starting IR Encoding Test");
                print("-----------------------");

                // Test NEC protocol (common for many TVs and devices)
                var protocol = "nec1";
                var device = 0;   // Device address
                var subdevice = -1; // -1 means no subdevice/use default
                var funcCode = 16;  // Function code (e.g., power button)

                print("Encoding " + protocol + " signal: device=" + device + ", function=" + funcCode);
                var timings = IRService.encodeIR(protocol, device, subdevice, funcCode);

                if (timings && timings.length > 0) {
                    print("Success! Generated " + timings.length + " timing values");
                    
                    // Show the first few timings
                    var output = "First 10 timings (µs): ";
                    var count = Math.min(timings.length, 10);
                    
                    for (var i = 0; i < count; i++) {
                        output += timings[i].toFixed(1);
                        if (i < count - 1) output += ", ";
                    }
                    
                    print(output);
                    print("Total sequence length: " + timings.length);
                    
                    // Convert timings to binary signal
                    print("Converting timings to binary signal...");
                    var signal = Utils.convertTimingsToBinary(timings);
                    print("Binary signal size: " + signal.length + " bytes");
                    
                    // Apply IR carrier modulation
                    print("Applying 38kHz IR carrier modulation...");
                    var irSignal = Utils.convertToIRBuffer(signal);
                    print("IR signal size: " + irSignal.length + " bytes");
                    
                    // Define the transmit command for IR - use pin 4 (IR TX) in binary format
                    var transmitCommand = new Uint8Array([
                        0x74, 0x72, 0x61, 0x6E, 0x73, 0x6D, 0x69, 0x74, 0x20, 0x04 // "transmit " + raw pin 4 (IR TX)
                    ]);
                    
                    print("To send this signal:");
                    print("1. BLEService.loadBuffer(irSignal);");
                    print("2. BLEService.sendPacket(transmitCommand);");
                    
                    // Actually send the signal - following SamplerView pattern
                    print("\\nSending IR signal now...");
                    
                    // Load the buffer with the IR signal
                    BLEService.loadBuffer(irSignal);
                    
                    // Send the transmit command (type 4 = IR)
                    BLEService.sendPacket(transmitCommand);
                    
                    // Transmit the buffer
                    BLEService.transmitBuffer();
                    print("Transmission complete");
                } else {
                    print("Error: Failed to encode " + protocol + " signal");
                }

                print("\\nTesting Samsung protocol");
                var samsung = IRService.encodeIR(IRService.PROTOCOL_SAMSUNG, 7, -1, 11);
                if (samsung) {
                    print("Success! Generated " + samsung.length + " timing values for Samsung");
                    
                    // Convert and show payload size
                    var samsungSignal = Utils.convertTimingsToBinary(samsung);
                    print("Samsung binary signal size: " + samsungSignal.length + " bytes");
                } else {
                    print("Error: Failed to encode Samsung signal");
                }

                print("\\nIR Test Complete");
                """
            
            saveScript(irTestScriptName, content: irTestContent)
            print("Created default IR test script")
        }
        
        loadRecentScripts()
    }
    
    // MARK: - Lifecycle methods

    // Add an explicit method to be called at the end of onAppear
    private func refreshUIAfterLoading() {
        // Force update the recent scripts list
        loadRecentScripts()
        
        // Ensure the UI reflects the current state
        updateDynamicScriptEditorTitle()
    }
    
    // MARK: - External Storage & Network Operations
    
    private func importScriptFromExternalStorage(url: URL) {
        do {
            // Start accessing security-scoped resource
            guard url.startAccessingSecurityScopedResource() else {
                print("Failed to access security-scoped resource")
                return
            }
            
            defer {
                // Make sure to release the security-scoped resource when done
                url.stopAccessingSecurityScopedResource()
            }
            
            // Use file coordination for safer file access
            var error: NSError?
            var content = ""
            
            NSFileCoordinator().coordinate(readingItemAt: url, error: &error) { coordinatedURL in
                do {
                    content = try String(contentsOf: coordinatedURL)
                } catch {
                    print("Error reading file contents: \(error.localizedDescription)")
                }
            }
            
            if let fileError = error {
                print("File coordination error: \(fileError.localizedDescription)")
                return
            }
            
            if content.isEmpty {
                print("Failed to read file content")
                return
            }
            
            let filename = url.lastPathComponent
            
            // Save to internal storage
            saveScript(filename, content: content)
            
            // Load the script
            loadScript(filename)
            
            print("Imported script: \(filename)")
        } catch {
            print("Error importing script: \(error.localizedDescription)")
        }
    }
    
    private func downloadScriptFromURL(_ urlString: String) {
        guard let url = URL(string: urlString) else {
            print("Invalid URL")
            return
        }
        
        let task = URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                DispatchQueue.main.async {
                    print("Download error: \(error.localizedDescription)")
                }
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                DispatchQueue.main.async {
                    print("Server error: \(response.debugDescription)")
                }
                return
            }
            
            if let data = data, let content = String(data: data, encoding: .utf8) {
                DispatchQueue.main.async {
                    // Use the URL's last path component as the filename
                    let filename = url.lastPathComponent
                    
                    // Save to internal storage
                    saveScript(filename, content: content)
                    
                    // Load the script
                    loadScript(filename)
                    
                    print("Downloaded and imported script: \(filename)")
                }
            }
        }
        
        task.resume()
    }
}

// Create a ViewModifier instead of an extension method
private extension View {
    func applyAlerts(
        showingNewScriptAlert: Binding<Bool>,
        newScriptName: Binding<String>,
        createNewScript: @escaping (String) -> Void,
        showingCopyScriptAlert: Binding<Bool>,
        copyCurrentScript: @escaping (String) -> Void,
        showingScriptOptions: Binding<Bool>,
        selectedScript: String?,
        showingDeleteConfirmation: Binding<Bool>,
        deleteScript: @escaping (String) -> Void,
        showingFileImporter: Binding<Bool>,
        importScriptFromExternalStorage: @escaping (URL) -> Void,
        showingFileExporter: Binding<Bool>,
        scriptDocument: ScriptDocument,
        currentScriptName: String?,
        showingURLPrompt: Binding<Bool>,
        downloadURL: Binding<String>,
        downloadScriptFromURL: @escaping (String) -> Void
    ) -> some View {
        self
            .alert("New Script", isPresented: showingNewScriptAlert) {
                TextField("Script Name", text: newScriptName)
                Button("Cancel", role: .cancel) {
                    newScriptName.wrappedValue = ""
                }
                Button("Create") {
                    createNewScript(newScriptName.wrappedValue)
                    newScriptName.wrappedValue = ""
                }
            } message: {
                Text("Enter a name for the new script")
            }
            .alert("Copy Script", isPresented: showingCopyScriptAlert) {
                TextField("Script Name", text: newScriptName)
                Button("Cancel", role: .cancel) {
                    newScriptName.wrappedValue = ""
                }
                Button("Copy") {
                    copyCurrentScript(newScriptName.wrappedValue)
                    newScriptName.wrappedValue = ""
                }
            } message: {
                Text("Enter a name for the copy")
            }
            .confirmationDialog(selectedScript != nil ? "Options for \"\(selectedScript!)\"" : "Script Options", isPresented: showingScriptOptions, titleVisibility: .visible) {
                Button("Rename") {
                    if let scriptName = selectedScript {
                        newScriptName.wrappedValue = scriptName
                        print("Rename action for \(selectedScript ?? "nil")")
                    }
                }
                
                Button("Delete", role: .destructive) {
                    showingDeleteConfirmation.wrappedValue = true
                }
                
                Button("Cancel", role: .cancel) {}
            }
            .alert("Delete Script", isPresented: showingDeleteConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    if let script = selectedScript {
                        deleteScript(script)
                    }
                }
            } message: {
                Text("Are you sure you want to delete \(selectedScript ?? "this script")?")
            }
            .fileImporter(
                isPresented: showingFileImporter,
                allowedContentTypes: [.plainText, .javascript],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first {
                        // Try to get persistent access to the file URL
                        do {
                            let secureURL = url.startAccessingSecurityScopedResource()
                            if !secureURL {
                                print("Failed to get secure access to URL")
                            }
                            
                            // Use the secured URL for import
                            importScriptFromExternalStorage(url)
                            
                            // Always release when done
                            url.stopAccessingSecurityScopedResource()
                        } catch {
                            print("Error securing file access: \(error.localizedDescription)")
                        }
                    }
                case .failure(let error):
                    print("Error importing file: \(error.localizedDescription)")
                }
            }
            .fileExporter(
                isPresented: showingFileExporter,
                document: scriptDocument,
                contentType: .plainText,
                defaultFilename: getExportFilename(currentScriptName)
            ) { result in
                switch result {
                case .success(let url):
                    print("Script exported to: \(url.path)")
                case .failure(let error):
                    print("Error exporting script: \(error.localizedDescription)")
                }
            }
            .alert("Download Script", isPresented: showingURLPrompt) {
                TextField("URL", text: downloadURL)
                Button("Cancel", role: .cancel) {
                    downloadURL.wrappedValue = ""
                }
                Button("Download") {
                    downloadScriptFromURL(downloadURL.wrappedValue)
                    downloadURL.wrappedValue = ""
                }
            } message: {
                Text("Enter the URL of the script to download")
            }
    }
}

// Add this helper function in the View extension
func getExportFilename(_ filename: String?) -> String {
    let name = filename ?? "script"
    return name.lowercased().hasSuffix(".js") ? name : name + ".js"
}

// MARK: - Script Document
struct ScriptDocument: FileDocument {
    var text: String
    
    init(_ text: String) {
        self.text = text
    }
    
    static var readableContentTypes: [UTType] { [.plainText] }
    
    init(configuration: ReadConfiguration) throws {
        if let data = configuration.file.regularFileContents {
            text = String(decoding: data, as: UTF8.self)
        } else {
            text = ""
        }
    }
    
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let data = Data(text.utf8)
        return FileWrapper(regularFileWithContents: data)
    }
}

#Preview {
    NavigationView {
        ConsoleView()
            .environmentObject(BLEManager())
    }
} 