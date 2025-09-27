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
    @objc func getBuffer() -> Data
    @objc func clearBuffer()
    @objc func loadBuffer(data: Data)
    @objc func sendPacket(_ data: Data)
    @objc func sendCommand(_ command: Data, timeout: Int) -> Data?
    @objc func transmitBuffer()
}

// BLE Service Wrapper for JavaScript compatibility
@objc class BLEServiceWrapper: NSObject, BLEManagerJSExport {
    private let bleManager: BLEManager
    
    init(bleManager: BLEManager) {
        self.bleManager = bleManager
        super.init()
    }
    
    @objc func getBuffer() -> Data {
        return bleManager.getBuffer()
    }
    
    @objc func clearBuffer() {
        bleManager.clearBuffer()
    }
    
    @objc func loadBuffer(data: Data) {
        bleManager.loadBuffer(data: data)
    }
    
    @objc func sendPacket(_ data: Data) {
        bleManager.sendPacket(data)
    }
    
    @objc func sendCommand(_ command: Data, timeout: Int) -> Data? {
        print("[BLEServiceWrapper] sendCommand called with \(command.count) bytes, timeout: \(timeout)")
        let result = bleManager.sendCommand(command, timeout: timeout)
        print("[BLEServiceWrapper] sendCommand returned \(result?.count ?? 0) bytes")
        return result
    }
    
    @objc func transmitBuffer() {
        bleManager.transmitBuffer()
    }
}

// Extension to make BLEManager JavaScript-compatible (kept for backward compatibility)
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
                .onChangeCompat(of: isFocused) { focused in
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
    private enum ConsoleTab: String, CaseIterable, Identifiable {
        case scripts
        case wavelets

        var id: String { rawValue }
        var title: String {
            switch self {
            case .scripts: return "Scripts"
            case .wavelets: return "Wavelets"
            }
        }
    }

    @EnvironmentObject var bleManager: BLEManager
    @State private var cc1101: CC1101?
    @State private var jsEngine: JavaScriptEngine?
    @State private var waveletEngine: WaveletEngine?
    @State private var scriptContent: String = ""
    @State private var consoleOutput: String = "<Console>\n"
    @State private var currentScriptName: String?
    @State private var recentScripts: [String] = []
    @State private var hasUnsavedChanges: Bool = false
    @State private var isScriptRunning: Bool = false
    @State private var isRenderingWavelet: Bool = false
    @State private var statusMessage: String = "Open a script"
    @State private var dynamicScriptEditorTitle: String = "Script Editor [No script open]"
    @State private var showingScriptOptions: Bool = false
    @State private var selectedScript: String?
    @State private var showingNewScriptAlert: Bool = false
    @State private var showingCopyScriptAlert: Bool = false
    @State private var showingDeleteConfirmation: Bool = false
    @State private var newScriptName: String = ""
    @State private var selectedTab: ConsoleTab = .scripts
    @State private var activeWaveletTree: WaveletTree?

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
    @State private var showingSettingsSheet = false
    
    var body: some View {
        VStack(spacing: 12) {
            Picker("Mode", selection: $selectedTab) {
                ForEach(ConsoleTab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)

            if selectedTab == .scripts {
                scriptsListSection
                scriptEditorSection
                consoleOutputSection
                Spacer(minLength: 0)
            } else {
                waveletPreview
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding()
        .navigationTitle("Console")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarItems(
            leading: EmptyView(),
            trailing: HStack {
                if selectedTab == .scripts {
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
                        renderWavelet()
                    }) {
                        Image(systemName: "square.grid.2x2")
                            .overlay {
                                if isRenderingWavelet {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                        .frame(width: 16, height: 16)
                                }
                            }
                    }
                    .disabled(isRenderingWavelet || scriptContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Render Wavelet Preview")

                    Button(action: {
                        clearConsole()
                    }) {
                        Image(systemName: "trash")
                    }
                    
                    Button(action: {
                        UIPasteboard.general.string = consoleOutput
                        print("Console output copied to clipboard (\(consoleOutput.count) chars)")
                    }) {
                        Image(systemName: "doc.on.clipboard")
                    }

                    menuButton
                }
            }
        )
        .toolbar {
            ToolbarItem(placement: .principal) {
                EmptyView()
            }
        }
        .sheet(isPresented: $showingSettingsSheet) {
            SettingsSheet()
        }
        .onAppear {
            let appearance = UINavigationBarAppearance()
            appearance.configureWithOpaqueBackground()
            UINavigationBar.appearance().standardAppearance = appearance
            UINavigationBar.appearance().compactAppearance = appearance
            UINavigationBar.appearance().scrollEdgeAppearance = appearance
            
            createDefaultScriptsIfNeeded()
            updateDynamicScriptEditorTitle()
            setupWaveletEngineIfNeeded()
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                refreshUIAfterLoading()
            }
            
            if bleManager.isConnected {
                cc1101 = CC1101(bleManager: bleManager)
                setupJSEngine()
            }
        }
        .onChangeCompat(of: selectedTab) { newValue in
            if newValue == .wavelets, !isRenderingWavelet, activeWaveletTree == nil {
                Swift.print("[Wavelet] Wavelets tab selected; triggering preview refresh")
                renderWavelet()
            }
        }
        .onChangeCompat(of: bleManager.isConnected) { connected in
            if connected {
                cc1101 = CC1101(bleManager: bleManager)
                setupJSEngine()
                setupWaveletEngineIfNeeded()
            } else {
                cc1101 = nil
                ensureWaveletEngineBindings()
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
                    .onChangeCompat(of: scriptContent) { _ in
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

    private var waveletPreview: some View {
        ZStack(alignment: .topLeading) {
            WaveletRenderView(tree: activeWaveletTree, invokeHandler: handleWaveletCallback)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            if activeWaveletTree == nil && !isRenderingWavelet {
                VStack {
                    Text("Render a wavelet from the Scripts tab to see it here.")
                        .foregroundColor(.secondary)
                        .italic()
                        .multilineTextAlignment(.center)
                        .padding()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemGroupedBackground))
            }

            if isRenderingWavelet {
                VStack {
                    ProgressView("Rendering wavelet…")
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(.ultraThinMaterial)
                        .cornerRadius(12)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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

            Divider()

            Button("Settings") {
                showingSettingsSheet = true
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

        let trimmed = scriptContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            self.print("No script to execute.")
            return
        }

        if isWaveletScript(trimmed) {
            let infoMessage = "[Wavelet] Detected wavelet DSL, rendering preview instead of running in standard engine"
            self.print(infoMessage)
            Swift.print(infoMessage)
            renderWavelet()
            return
        }

        guard jsEngine != nil else {
            self.print("JavaScript engine not initialized.")
            return
        }

        isScriptRunning = true

        // Execute the script
        jsEngine?.evaluateScript(trimmed) {
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
        
        // Create all 5 scripts that match Android exactly
        let waveletDemoName = "wavelet_demo.js"
        let waveletDemoPath = getDocumentsDirectory().appendingPathComponent(waveletDemoName)

        if !FileManager.default.fileExists(atPath: waveletDemoPath.path) {
            saveScript(waveletDemoName, content: waveletDemoScript())
            print("Created default wavelet demo script")
        }

        let rfidWaveletName = "wavelet_rfid.js"
        let rfidWaveletPath = getDocumentsDirectory().appendingPathComponent(rfidWaveletName)

        if !FileManager.default.fileExists(atPath: rfidWaveletPath.path) {
            saveScript(rfidWaveletName, content: waveletRFIDScript())
            print("Created default RFID wavelet script")
        }

        let waveletGPIOName = "wavelet_gpio.js"
        let waveletGPIOPath = getDocumentsDirectory().appendingPathComponent(waveletGPIOName)

        if !FileManager.default.fileExists(atPath: waveletGPIOPath.path) {
            saveScript(waveletGPIOName, content: waveletGPIOScript())
            print("Created default GPIO wavelet script")
        }

        let cc1101RadioName = "cc1101_radio_console.js"
        let cc1101RadioPath = getDocumentsDirectory().appendingPathComponent(cc1101RadioName)

        if !FileManager.default.fileExists(atPath: cc1101RadioPath.path) {
            saveScript(cc1101RadioName, content: cc1101RadioConsoleScript())
            print("Created default CC1101 radio console script")
        }

        let helloWorldUsbName = "hello_world_usb.js"
        let helloWorldUsbPath = getDocumentsDirectory().appendingPathComponent(helloWorldUsbName)

        if !FileManager.default.fileExists(atPath: helloWorldUsbPath.path) {
            saveScript(helloWorldUsbName, content: helloWorldUsbScript())
            print("Created default Hello World USB script")
        }

        loadRecentScripts()
    }

    private func cc1101RadioConsoleScript() -> String {
        return """
        let message = 'Ready';

        function initRx() {
            try {
                CC1101.spiStrobe(CC1101.SRES);
                CC1101.init();
                CC1101.writeReg(CC1101.PKTCTRL0, 0x32);
                CC1101.setGDOMode(0x2E, 0x2E, 0x0D);
                CC1101.setFrequencyMHz(433.92);
                CC1101.setDataRate(100000);
                CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);
                CC1101.spiStrobe(CC1101.SRX);
                message = 'RX init complete!';
                render();
            } catch (error) {
                message = 'RX init failed: ' + error;
                render();
            }
        }

        function initTx() {
            try {
                CC1101.spiStrobe(CC1101.SRES);
                CC1101.init();
                CC1101.writeReg(CC1101.PKTCTRL0, 0x32);
                CC1101.setGDOMode(0x2E, 0x2E, 0x0D);
                CC1101.setFrequencyMHz(433.92);
                CC1101.setDataRate(100000);
                CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);
                CC1101.spiStrobe(CC1101.STX);
                message = 'TX init complete!';
                render();
            } catch (error) {
                message = 'TX init failed: ' + error;
                render();
            }
        }

        function render() {
            UI.render(UI.column({
                padding: 16,
                spacing: 16,
                children: [
                    UI.text({ text: 'CC1101 Radio', font: 'title2', fontWeight: 'semibold' }),
                    UI.row({
                        spacing: 12,
                        children: [
                            UI.button({ label: 'Init RX', backgroundColor: '#2563EB', foregroundColor: '#FFFFFF', onTap: initRx }),
                            UI.button({ label: 'Init TX', backgroundColor: '#DC2626', foregroundColor: '#FFFFFF', onTap: initTx })
                        ]
                    }),
                    UI.text({ text: message, fontWeight: 'medium', foregroundColor: '#374151' })
                ]
            }));
        }

        render();
        """
    }

    private func helloWorldUsbScript() -> String {
        return """
        WaveletConsole.subscribe(render);
        render();

        function render() {
            UI.render(UI.column({
                padding: 16,
                spacing: 12,
                children: [
                    UI.text({ text: 'BadUSB Hello World', font: 'title2', fontWeight: 'semibold' }),
                    UI.text({ text: 'Send a simple HID payload to the connected host.', foregroundColor: '#6B7280' }),
                    UI.button({ label: 'Execute Payload', backgroundColor: '#1D4ED8', foregroundColor: '#FFFFFF', onTap: runDemo }),
                    WaveletConsole.view({
                        minHeight: 160,
                        backgroundColor: '#111827',
                        foregroundColor: '#F9FAFB',
                        padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                        cornerRadius: 8
                    })
                ]
            }));
        }

        function runDemo() {
            print('[BadUSB] Setting up HID attack mode...');
            BLEService.sendString('usb ATTACKMODE HID');
            Utils.delay(2000);
            BLEService.sendString('usb STRING_DELAY 10');
            Utils.delay(500);
            BLEService.sendString('usb STRING Hello, World!');
            Utils.delay(500);
            BLEService.sendString('usb ENTER');
            Utils.delay(500);
            print('[BadUSB] Payload complete.');
        }
        """
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
        guard url.startAccessingSecurityScopedResource() else {
            print("Failed to access security-scoped resource")
            return
        }

        defer {
            url.stopAccessingSecurityScopedResource()
        }

        var coordinationError: NSError?
        var content = ""

        NSFileCoordinator().coordinate(readingItemAt: url, error: &coordinationError) { coordinatedURL in
            do {
                content = try String(contentsOf: coordinatedURL, encoding: .utf8)
            } catch {
                print("Error reading file contents: \(error.localizedDescription)")
            }
        }

        if let fileError = coordinationError {
            print("File coordination error: \(fileError.localizedDescription)")
            return
        }

        if content.isEmpty {
            print("Failed to read file content")
            return
        }

        let filename = url.lastPathComponent
        saveScript(filename, content: content)
        loadScript(filename)
        print("Imported script: \(filename)")
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


    // MARK: - Wavelet Support

    private func setupWaveletEngineIfNeeded() {
        guard waveletEngine == nil else {
            Swift.print("[Wavelet] WaveletEngine already initialized")
            ensureWaveletEngineBindings()
            return
        }
        Swift.print("[Wavelet] Initializing WaveletEngine")
        let engine = WaveletEngine()
        engine.setup(printHandler: { message in
            let tagged = "[Wavelet] \(message)"
            self.print(tagged)
            Swift.print(tagged)
        }, renderHandler: { tree in
            self.activeWaveletTree = tree
            self.isRenderingWavelet = false
            if self.selectedTab != .wavelets {
                self.selectedTab = .wavelets
            }
        }, bindings: buildBindings())
        waveletEngine = engine
        Swift.print("[Wavelet] WaveletEngine initialized successfully")
    }

    private func ensureWaveletEngineBindings() {
        waveletEngine?.registerGlobalBindings(buildBindings())
    }

    private func buildBindings() -> [String: Any] {
        var bindings: [String: Any] = [:]
        
        if let cc1101 = cc1101 {
            bindings["CC1101"] = CC1101Wrapper(cc1101: cc1101)
            Swift.print("[Wavelet] CC1101 binding added with wrapper")
        }
        
        if bleManager.isConnected {
            bindings["BLEService"] = BLEServiceWrapper(bleManager: bleManager)
            Swift.print("[Wavelet] BLEService binding added with wrapper - isConnected: \(bleManager.isConnected)")
        } else {
            Swift.print("[Wavelet] BLEService NOT added - isConnected: \(bleManager.isConnected)")
        }
        
        Swift.print("[Wavelet] Built bindings: \(bindings.keys)")
        return bindings
    }

    private func renderWavelet() {
        let trimmed = scriptContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            Swift.print("[Wavelet] Script is empty; nothing to render")
            return
        }

        Swift.print("[Wavelet] renderWavelet invoked with script length \(scriptContent.count)")
        setupWaveletEngineIfNeeded()
        guard let engine = waveletEngine else {
            Swift.print("[Wavelet] Aborting render: waveletEngine not initialized")
            return
        }

        if selectedTab != .wavelets {
            selectedTab = .wavelets
        }

        isRenderingWavelet = true
        activeWaveletTree = nil
        Swift.print("[Wavelet] Rendering preview...")

        engine.execute(script: trimmed) {
            Swift.print("[Wavelet] Render completion callback")
            self.isRenderingWavelet = false
        }
    }

    private func isWaveletScript(_ script: String) -> Bool {
        let lowered = script.lowercased()
        return lowered.contains("ui.render(") || lowered.contains("ui.column(") || lowered.contains("ui.row(")
    }

    private func handleWaveletCallback(_ token: String, arguments: [Any]) {
        print("[Wavelet] Invoking handler \(token) with arguments: \(arguments)")
        waveletEngine?.invoke(handler: token, arguments: arguments)
    }

    private func waveletDemoScript() -> String {
        return """
        const root = UI.column({
            spacing: 12,
            padding: 8,
            children: [
                UI.text({ text: "Wavelet Demo" }),
                UI.text({ text: "Use UI.button, UI.row, and UI.column to compose layouts." }),
                UI.row({
                    spacing: 8,
                    children: [
                        UI.button({
                            label: "Pulse LED",
                            onTap: () => {
                                print('Pulse LED requested');
                            }
                        }),
                        UI.button({
                            label: "Log Message",
                            onTap: () => {
                                print('Wavelet button pressed');
                            }
                        })
                    ]
                }),
                UI.logViewer({ text: "Console messages will appear below." })
            ]
        });

        UI.render(root);
        """
    }

    private func waveletRFIDScript() -> String {
        return """
        // State matching the original RFID fragment exactly
        let blockAddress = "00";
        let authMode = 0; // 0 = Key A, 1 = Key B
        let keyInputs = ["FF", "FF", "FF", "FF", "FF", "FF"];
        let combinedData = "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00";
        let resultText = "";

        function isKeyComplete() {
            for (let i = 0; i < 6; i++) {
                if (!keyInputs[i] || keyInputs[i].trim().length === 0) {
                    return false;
                }
            }
            return true;
        }

        function isCombinedDataComplete() {
            if (!combinedData || combinedData.trim().length === 0) {
                return false;
            }
            let dataBytes = combinedData.trim().split(/\\s+/).filter(Boolean);
            return dataBytes.length === 16;
        }

        function processReadResponse(response) {
            if (!response || response.length === 0) {
                showError("No response received.");
                return;
            }
            
            // Check for text error messages first
            let responseString = "";
            try {
                for (let i = 0; i < response.length; i++) {
                    responseString += String.fromCharCode(response[i]);
                }
            } catch (e) {
                responseString = "";
            }
            
            if (responseString.includes("No card detected")) {
                showError("Error: No card detected");
                return;
            }
            if (responseString.includes("RFID module not connected")) {
                showError("Error: RFID module not connected");
                return;
            }
            
            if (response.length >= 2) {
                let cardType = getTagType(response[0], response[1]);
                let result = "Card Type: " + cardType + "\\n";
                
                // Extract UID if present
                if (response.length > 6) {
                    let uid = "";
                    for (let i = 2; i < 6; i++) {
                        uid += ((response[i] & 0xFF).toString(16).toUpperCase().padStart(2, '0')) + " ";
                    }
                    result += "UID: " + uid.trim() + "\\n";
                }
                
                if (response.length > 6) {
                    if ((response[6] & 0xFF) === 0xFF) {
                        // Error occurred
                        let errorMsg = "";
                        for (let i = 7; i < response.length; i++) {
                            errorMsg += String.fromCharCode(response[i]);
                        }
                        result += "Error: " + errorMsg;
                        showError(result);
                    } else if ((response[6] & 0xFF) === 0x00 && response.length >= 23) {
                        // Successful read
                        let data = "";
                        for (let i = 7; i < 23; i++) {
                            data += ((response[i] & 0xFF).toString(16).toUpperCase().padStart(2, '0')) + " ";
                        }
                        result += "Data: " + data.trim();
                        showResultDialog(result, data.trim());
                    } else {
                        showError("Unexpected response format. See logs for details.");
                    }
                } else {
                    showError("Incomplete response received (length: " + response.length + ")");
                }
            } else {
                showError("Invalid response format (length: " + response.length + ")");
            }
        }

        function getTagType(byte0, byte1) {
            // Exact tag type detection from original fragment
            let tagType = ((byte0 & 0xFF) << 8) | (byte1 & 0xFF);
            switch (tagType) {
                case 0x4400:
                    return "Mifare_UltraLight";
                case 0x0400:
                    return "Mifare_One(S50)";
                case 0x0200:
                    return "Mifare_One(S70)";
                case 0x0800:
                    return "Mifare_Pro(X)";
                case 0x4403:
                    return "Mifare_DESFire";
                default:
                    return "Unknown";
            }
        }

        function showError(errorMessage) {
            resultText = errorMessage;
            render();
        }

        function showResultDialog(result, data) {
            resultText = ""; // Clear result text since we're showing dialog
            render();
            
            // Show dialog with "COPY to write" option for reads
            if (data && data.trim().length > 0) {
                // For reads with data - show dialog with copy option
                // Note: This is a simplified version - real implementation would need custom dialog with two buttons
                dialog("Result", result + "\\n\\nData has been copied to write field.");
                
                // Copy data to write field
                let dataBytes = data.trim().split(' ');
                while (dataBytes.length < 16) {
                    dataBytes.push("00");
                }
                combinedData = dataBytes.slice(0, 16).join(" ");
                render();
            } else {
                // For writes or reads without data
                dialog("Result", result);
            }
        }

        function sendReadCommand() {
            if (!BLEService) {
                showError("BLE Service not bound. Please reconnect.");
                return;
            }
            
            if (blockAddress.trim().length === 0 || !isKeyComplete()) {
                showError("Please enter block address and complete key.");
                return;
            }
            
            try {
                // Create command exactly like the original fragment
                let command = new Array(21);
                let cmdPrefix = "mfrc522 read ";
                
                // Copy prefix
                for (let i = 0; i < cmdPrefix.length; i++) {
                    command[i] = cmdPrefix.charCodeAt(i);
                }
                
                // Add block address
                command[cmdPrefix.length] = parseInt(blockAddress, 16);
                
                // Add auth mode byte (0x60 for Key A, 0x61 for Key B)
                command[cmdPrefix.length + 1] = authMode === 0 ? 0x60 : 0x61;
                
                // Add 6-byte key
                for (let i = 0; i < 6; i++) {
                    command[cmdPrefix.length + 2 + i] = parseInt(keyInputs[i], 16);
                }
                
                // Convert to Java byte array
                let byteArray = createByteArray(command);
                let response = BLEService.sendCommand(byteArray, 2000);
                
                processReadResponse(response);
                
            } catch (error) {
                showError("Read error: " + error);
            }
        }

        function processWriteResponse(response) {
            if (!response || response.length === 0) {
                showError("No response received.");
                return;
            }
            
            // Check for text error messages first
            let responseString = "";
            try {
                for (let i = 0; i < response.length; i++) {
                    responseString += String.fromCharCode(response[i]);
                }
            } catch (e) {
                responseString = "";
            }
            
            if (responseString.includes("No card detected")) {
                showError("Error: No card detected");
                return;
            }
            if (responseString.includes("RFID module not connected")) {
                showError("Error: RFID module not connected");
                return;
            }
            
            if (responseString.includes("Success")) {
                showResultDialog("Write successful", "");
                resultText = ""; // Clear any previous error message
                render();
            } else {
                // More detailed error reporting
                let errorDetails = "Error: " + responseString + "\\nRaw response size: " + response.length + " bytes";
                showError(errorDetails);
            }
        }

        function sendWriteCommand() {
            if (!BLEService) {
                showError("BLE Service not bound. Please reconnect.");
                return;
            }
            
            if (blockAddress.trim().length === 0 || !isKeyComplete() || !isCombinedDataComplete()) {
                showError("Please enter block address, complete key, and data.");
                return;
            }
            
            try {
                // Parse combined data - remove spaces and validate length
                let cleanData = combinedData.replace(/\\s/g, "");
                if (cleanData.length !== 32) {
                    showError("Data must be exactly 16 bytes (32 hex characters)");
                    return;
                }
                
                // Create command exactly like the original fragment
                let command = new Array(38);
                let cmdPrefix = "mfrc522 write ";
                
                // Copy prefix  
                for (let i = 0; i < cmdPrefix.length; i++) {
                    command[i] = cmdPrefix.charCodeAt(i);
                }
                
                // Add block address
                command[cmdPrefix.length] = parseInt(blockAddress, 16);
                
                // Add auth mode byte
                command[cmdPrefix.length + 1] = authMode === 0 ? 0x60 : 0x61;
                
                // Add 6-byte key
                for (let i = 0; i < 6; i++) {
                    command[cmdPrefix.length + 2 + i] = parseInt(keyInputs[i], 16);
                }
                
                // Add 16-byte data (parse from hex string)
                for (let i = 0; i < 16; i++) {
                    let hexByte = cleanData.substring(i * 2, i * 2 + 2);
                    command[cmdPrefix.length + 8 + i] = parseInt(hexByte, 16);
                }
                
                // Convert to Java byte array
                let byteArray = createByteArray(command);
                let response = BLEService.sendCommand(byteArray, 2000);
                
                processWriteResponse(response);
                
            } catch (error) {
                showError("Write error: " + error);
            }
        }

        function render() {
            UI.render(UI.scroll({
                padding: 16,
                spacing: 16,
                children: [
                    UI.column({
                        spacing: 16,
                        children: [
                            UI.text({ text: "RFID Tools", font: "title2", fontWeight: "semibold" }),
                            
                            // Block Address
                            UI.text({ text: "Block Address", fontWeight: "medium" }),
                            UI.textField({
                                placeholder: "00",
                                value: blockAddress,
                                onChange: function(value) { 
                                    blockAddress = value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 2);
                                }
                            }),
                            
                            // Authentication Mode
                            UI.text({ text: "Authentication Mode", fontWeight: "medium" }),
                            UI.picker({
                                style: "segmented",
                                selected: authMode,
                                options: [
                                    { label: "Key A", value: 0 },
                                    { label: "Key B", value: 1 }
                                ],
                                onChange: function(value) {
                                    authMode = value;
                                }
                            }),
                            
                            // Key inputs (6 fields)
                            UI.column({
                                spacing: 8,
                                children: [
                                    UI.text({ text: "Key (6 bytes)", fontWeight: "medium" }),
                                    UI.grid({
                                        columns: 3,
                                        spacing: 8,
                                        children: keyInputs.map(function(keyValue, index) {
                                            return UI.textField({
                                                placeholder: "FF",
                                                value: keyValue,
                                                onChange: function(value) {
                                                    keyInputs[index] = value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 2);
                                                }
                                            });
                                        })
                                    })
                                ]
                            }),
                            
                            // Combined data input
                            UI.text({ text: "Data (16 bytes)", fontWeight: "medium" }),
                            UI.textEditor({
                                placeholder: "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
                                value: combinedData,
                                onChange: function(value) {
                                    combinedData = value.toUpperCase().replace(/[^0-9A-F ]/g, "");
                                }
                            }),
                            
                            // Read and Write buttons
                            UI.row({
                                spacing: 12,
                                children: [
                                    UI.button({
                                        label: "Read",
                                        backgroundColor: "#2563EB",
                                        foregroundColor: "#FFFFFF",
                                        onTap: sendReadCommand
                                    }),
                                    UI.button({
                                        label: "Write", 
                                        backgroundColor: "#DC2626",
                                        foregroundColor: "#FFFFFF",
                                        onTap: sendWriteCommand
                                    })
                                ]
                            }),
                            
                            // Result display
                            resultText ? UI.text({
                                text: resultText,
                                backgroundColor: resultText.includes("successful") ? "#DCFCE7" : "#FEE2E2",
                                foregroundColor: resultText.includes("successful") ? "#166534" : "#DC2626",
                                padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                                cornerRadius: 8
                            }) : null
                        ]
                    })
                ]
            }));
        }

        render();
        """
    }

    private func waveletGPIOScript() -> String {
        return """
        // Simple GPIO control wavelet
        let selectedPin = 0;
        let resultText = "";

        const PINS = [
            { label: "GPIO0 (IO0)", value: "0" },
            { label: "CC1101 GDO0 (IO1)", value: "1" },
            { label: "CC1101 GDO2 (IO2)", value: "2" },
            { label: "IR TX (IO4)", value: "4" },
            { label: "IR RX (IO5)", value: "5" },
            { label: "GPIO6 (IO6)", value: "6" },
            { label: "GPIO7 (IO7)", value: "7" },
            { label: "GPIO9 (IO9)", value: "9" },
            { label: "CC1101 NSS (IO10)", value: "10" },
            { label: "CC1101 MOSI (IO11)", value: "11" },
            { label: "CC1101 SCK (IO12)", value: "12" },
            { label: "CC1101 MISO (IO13)", value: "13" },
            { label: "GPIO14 (IO14)", value: "14" },
            { label: "GPIO15 (IO15)", value: "15" },
            { label: "GPIO16 (IO16)", value: "16" }
        ];

        // Initialize selectedPin to first pin's value  
        selectedPin = PINS[0].value;

        function gpioRead() {
            console.log("gpioRead called with selectedPin: " + selectedPin);
            
            if (!BLEService) {
                resultText = "BLE Service not connected";
                render();
                return;
            }
            
            try {
                // Create GPIO read command: "gpio" + null + pin + 'R' + 0
                let pinNumber = parseInt(selectedPin);
                let command = createByteArray([0x67, 0x70, 0x69, 0x6F, 0x00, pinNumber, 0x52, 0x00]); // 'g','p','i','o',0,pin,'R',0
                let response = BLEService.sendCommand(command, 2000);
                
                if (response && response.length > 0) {
                    let state = response[0] !== 0;
                    let pinInfo = PINS.find(p => p.value === selectedPin);
                    let pinName = pinInfo ? pinInfo.label : "IO" + selectedPin;
                    resultText = "Read " + pinName + ": " + (state ? "HIGH" : "LOW");
                } else {
                    resultText = "GPIO read failed or timed out";
                }
                
            } catch (error) {
                resultText = "GPIO read error: " + error;
            }
            
            render();
        }

        function gpioWriteHigh() {
            gpioWrite(1);
        }

        function gpioWriteLow() {
            gpioWrite(0);
        }

        function gpioWrite(value) {
            console.log("gpioWrite called with value: " + value + " selectedPin: " + selectedPin);
            
            if (!BLEService) {
                resultText = "BLE Service not connected";
                render();
                return;
            }
            
            try {
                // Create GPIO write command: "gpio" + null + pin + 'W' + value
                let pinNumber = parseInt(selectedPin);
                let command = createByteArray([0x67, 0x70, 0x69, 0x6F, 0x00, pinNumber, 0x57, value]); // 'g','p','i','o',0,pin,'W',value
                let response = BLEService.sendCommand(command, 2000);
                
                if (response && response.length > 0) {
                    let state = response[0] !== 0;
                    let writeAction = value ? "HIGH" : "LOW";
                    let pinInfo = PINS.find(p => p.value === selectedPin);
                    let pinName = pinInfo ? pinInfo.label : "IO" + selectedPin;
                    let success = (state === (value !== 0));
                    resultText = "Write " + writeAction + " to " + pinName + (success ? " successful" : " failed");
                } else {
                    resultText = "GPIO write failed or timed out";
                }
                
            } catch (error) {
                resultText = "GPIO write error: " + error;
            }
            
            render();
        }

        function render() {
            UI.render(UI.column({
                padding: 16,
                spacing: 16,
                children: [
                    UI.text({ text: "GPIO Control", font: "title2", fontWeight: "semibold" }),
                    
                    // Pin selection
                    UI.text({ text: "Select Pin", fontWeight: "medium" }),
                    UI.picker({
                        style: "menu",
                        selected: String(selectedPin),
                        options: PINS,
                        onChange: function(value) {
                            selectedPin = value;
                            console.log("Pin changed to value: " + selectedPin + " (type: " + typeof value + ")");
                        }
                    }),
                    
                    // GPIO operations
                    UI.row({
                        spacing: 12,
                        children: [
                            UI.button({ label: "Read", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: gpioRead }),
                            UI.button({ label: "Write HIGH", backgroundColor: "#059669", foregroundColor: "#FFFFFF", onTap: gpioWriteHigh }),
                            UI.button({ label: "Write LOW", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: gpioWriteLow })
                        ]
                    }),
                    
                    // Result display
                    resultText ? UI.text({
                        text: resultText,
                        backgroundColor: resultText.includes("successful") || resultText.includes("HIGH") || resultText.includes("LOW") ? "#DCFCE7" : "#FEE2E2",
                        foregroundColor: resultText.includes("successful") || resultText.includes("HIGH") || resultText.includes("LOW") ? "#166534" : "#DC2626",
                        padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
                        cornerRadius: 8
                    }) : null
                ]
            }));
        }

        render();
        """
    }

    private func waveletISMScript() -> String {
        return """
        const modulationOptions = [
            { label: "2-FSK", value: "0" },
            { label: "GFSK", value: "1" },
            { label: "ASK/OOK", value: "3" },
            { label: "4-FSK", value: "4" },
            { label: "MSK", value: "7" }
        ];

        const powerOptions = [
            { label: "-30 dBm", value: "-30" },
            { label: "-20 dBm", value: "-20" },
            { label: "-15 dBm", value: "-15" },
            { label: "-10 dBm", value: "-10" },
            { label: "0 dBm", value: "0" },
            { label: "5 dBm", value: "5" },
            { label: "7 dBm", value: "7" },
            { label: "10 dBm", value: "10" }
        ];

        const configRegisters = [
            { key: "00", name: "IOCFG2" }, { key: "01", name: "IOCFG1" }, { key: "02", name: "IOCFG0" },
            { key: "03", name: "FIFOTHR" }, { key: "04", name: "SYNC1" }, { key: "05", name: "SYNC0" },
            { key: "06", name: "PKTLEN" }, { key: "07", name: "PKTCTRL1" }, { key: "08", name: "PKTCTRL0" },
            { key: "09", name: "ADDR" }, { key: "0A", name: "CHANNR" }, { key: "0B", name: "FSCTRL1" },
            { key: "0C", name: "FSCTRL0" }, { key: "0D", name: "FREQ2" }, { key: "0E", name: "FREQ1" },
            { key: "0F", name: "FREQ0" }, { key: "10", name: "MDMCFG4" }, { key: "11", name: "MDMCFG3" },
            { key: "12", name: "MDMCFG2" }, { key: "13", name: "MDMCFG1" }, { key: "14", name: "MDMCFG0" },
            { key: "15", name: "DEVIATN" }, { key: "16", name: "MCSM2" }, { key: "17", name: "MCSM1" },
            { key: "18", name: "MCSM0" }, { key: "19", name: "FOCCFG" }, { key: "1A", name: "BSCFG" },
            { key: "1B", name: "AGCCTRL2" }, { key: "1C", name: "AGCCTRL1" }, { key: "1D", name: "AGCCTRL0" },
            { key: "1E", name: "WOREVT1" }, { key: "1F", name: "WOREVT0" }, { key: "20", name: "WORCTRL" },
            { key: "21", name: "FREND1" }, { key: "22", name: "FREND0" }, { key: "23", name: "FSCAL3" },
            { key: "24", name: "FSCAL2" }, { key: "25", name: "FSCAL1" }, { key: "26", name: "FSCAL0" },
            { key: "27", name: "RCCTRL1" }, { key: "28", name: "RCCTRL0" }, { key: "29", name: "FSTEST" },
            { key: "2A", name: "PTEST" }, { key: "2B", name: "AGCTEST" }, { key: "2C", name: "TEST2" },
            { key: "2D", name: "TEST1" }, { key: "2E", name: "TEST0" }
        ];

        const statusRegisters = [
            { key: "30", name: "PARTNUM" }, { key: "31", name: "VERSION" }, { key: "32", name: "FREQEST" },
            { key: "33", name: "LQI" }, { key: "34", name: "RSSI" }, { key: "35", name: "MARCSTATE" },
            { key: "36", name: "WORTIME1" }, { key: "37", name: "WORTIME0" }, { key: "38", name: "PKTSTATUS" },
            { key: "39", name: "VCO_VC_DAC" }, { key: "3A", name: "TXBYTES" }, { key: "3B", name: "RXBYTES" }
        ];

        const paTable = Array.from({ length: 8 }, (_, index) => ({ key: `PA${index}`, name: `PA[${index}]` }));

        const layout = {
            gap: 10,
            rowHeight: 30,
            labelWidth: 150,
            controlMinWidth: 120,
            controlMaxWidth: 180,
            actionWidth: 60
        };

        function labelCell(text) {
            return UI.text({
                text,
                fontWeight: "medium",
                width: layout.labelWidth,
                alignment: "leading",
                fillsWidth: false
            });
        }

        function emptyCell(width) {
            return UI.text({ text: "", width, fillsWidth: false });
        }

        const registerDefaults = [...configRegisters, ...statusRegisters, ...paTable].reduce((map, reg) => {
            map[reg.key] = "??";
            return map;
        }, {});

        const state = {
            frequency: "",
            dataRate: "",
            bandwidth: "",
            deviation: "",
            modulation: modulationOptions[0].value,
            power: powerOptions[4].value,
            isLoading: false,
            status: "Idle",
            registerValues: registerDefaults
        };

        function setState(patch) {
            Object.assign(state, patch);
            render();
        }

        function updateField(key, rawValue) {
            const trimmed = String(rawValue || "").trim();
            setState({ [key]: trimmed });
        }

        function handleSet(key, label) {
            const value = state[key];
            if (!value) {
                print(`[Wavelet/ISM] ${label} was left empty.`);
                return;
            }
            print(`[Wavelet/ISM] Set ${label} to ${value}`);
        }

        function toggleLoading() {
            const next = !state.isLoading;
            setState({
                isLoading: next,
                status: next ? "Polling CC1101 registers…" : "Idle"
            });
            print(next ? "[Wavelet/ISM] Refreshing register snapshot" : "[Wavelet/ISM] Cancelled refresh" );
        }

        function resetRadio() {
            print("[Wavelet/ISM] Reset radio to defaults");
        }

        function registerRow(register) {
            const value = state.registerValues[register.key] || "??";
            return UI.row({
                spacing: 8,
                children: [
                    UI.text({ text: register.name, fontWeight: "medium" }),
                    UI.spacer(),
                    UI.text({ text: `0x${register.key}`, foregroundColor: "#6B7280" }),
                    UI.spacer(),
                    UI.text({ text: `0x${value}`, fontDesign: "monospaced" })
                ]
            });
        }

        function sectionHeading(text) {
            return UI.text({ text, font: "subheadline", fontWeight: "semibold" });
        }

        function parameterRow(label, key, placeholder, keyboard) {
            return UI.row({
                spacing: layout.gap,
                alignment: "center",
                children: [
                    labelCell(label),
                    UI.row({
                        spacing: layout.gap,
                        alignment: "center",
                        flex: 1,
                        children: [
                            UI.textField({
                                placeholder,
                                value: state[key],
                                keyboard,
                                minWidth: layout.controlMinWidth,
                                maxWidth: layout.controlMaxWidth,
                                height: layout.rowHeight,
                                flex: 1,
                                fillsWidth: true,
                                onChange: function(value) {
                                    updateField(key, value);
                                }
                            }),
                            UI.button({
                                label: "Set",
                                buttonStyle: "bordered",
                                controlSize: "small",
                                minWidth: layout.actionWidth,
                                maxWidth: layout.actionWidth,
                                fillsWidth: false,
                                onTap: function() {
                                    handleSet(key, label);
                                }
                            })
                        ]
                    })
                ]
            });
        }

        function pickerRow(label, key, options) {
            return UI.row({
                spacing: layout.gap,
                alignment: "center",
                children: [
                    labelCell(label),
                    UI.row({
                        spacing: layout.gap,
                        alignment: "center",
                        flex: 1,
                        children: [
                            UI.picker({
                                selected: state[key],
                                options,
                                style: "menu",
                                minWidth: layout.controlMinWidth,
                                maxWidth: layout.controlMaxWidth,
                                height: layout.rowHeight,
                                fillsWidth: false,
                                onChange: function(value) {
                                    setState({ [key]: value });
                                    print(`[Wavelet/ISM] ${label} -> ${value}`);
                                }
                            }),
                            emptyCell(layout.actionWidth)
                        ]
                    })
                ]
            });
        }

        function render() {
            UI.render(
                UI.scroll({
                    padding: 16,
                    spacing: 24,
                    children: [
                        UI.column({
                            spacing: layout.gap,
                            children: [
                                UI.text({
                                    text: "ISM Toolkit",
                                    font: "title2",
                                    fontWeight: "semibold"
                                }),
                                UI.text({
                                    text: "Configure CC1101 parameters and inspect live register snapshots.",
                                    foregroundColor: "#6B7280"
                                })
                            ]
                        }),
                        UI.column({
                            spacing: layout.gap,
                            children: [
                                parameterRow("Frequency (MHz):", "frequency", "2400", "decimal"),
                                parameterRow("Data Rate (bps):", "dataRate", "38400", "number"),
                                parameterRow("Bandwidth (kHz):", "bandwidth", "250", "decimal"),
                                parameterRow("Deviation (Hz):", "deviation", "5000", "number"),
                                pickerRow("Modulation Format:", "modulation", modulationOptions),
                                pickerRow("TX Power:", "power", powerOptions),
                                UI.row({
                                    spacing: layout.gap,
                                    alignment: "center",
                                    children: [
                                        emptyCell(layout.labelWidth),
                                        UI.row({
                                            spacing: layout.gap,
                                            alignment: "center",
                                            flex: 1,
                                            children: [
                                                emptyCell(layout.controlMinWidth),
                                                UI.button({
                                                    label: "Reset",
                                                    buttonStyle: "bordered",
                                                    controlSize: "small",
                                                    minWidth: layout.actionWidth,
                                                    maxWidth: layout.actionWidth,
                                                    fillsWidth: false,
                                                    icon: "arrow.counterclockwise",
                                                    onTap: resetRadio
                                                })
                                            ]
                                        })
                                    ]
                                })
                            ]
                        }),
                        UI.column({
                            spacing: 12,
                            children: [
                                UI.row({
                                    spacing: 12,
                                    children: [
                                        UI.text({ text: "CC1101 Registers", font: "headline" }),
                                        UI.spacer(),
                                        UI.button({
                                            label: state.isLoading ? "Cancel" : "Refresh",
                                            buttonStyle: "bordered",
                                            controlSize: "small",
                                            fillsWidth: false,
                                            icon: state.isLoading ? "xmark" : "arrow.clockwise",
                                            onTap: toggleLoading
                                        })
                                    ]
                                }),
                                state.isLoading ? UI.progress({
                                    label: "Loading registers…",
                                    detail: state.status
                                }) : null,
                                UI.column({
                                    spacing: 8,
                                    children: [
                                        sectionHeading("Configuration Registers"),
                                        ...configRegisters.map(registerRow)
                                    ]
                                }),
                                UI.divider(),
                                UI.column({
                                    spacing: 8,
                                    children: [
                                        sectionHeading("Status Registers"),
                                        ...statusRegisters.map(registerRow)
                                    ]
                                }),
                                UI.divider(),
                                UI.column({
                                    spacing: 8,
                                    children: [
                                        sectionHeading("PA Table"),
                                        ...paTable.map(registerRow)
                                    ]
                                }),
                                UI.text({
                                    text: state.status,
                                    font: "footnote",
                                    foregroundColor: "#6B7280"
                                })
                            ]
                        })
                    ]
                })
            );
        }

        render();
        """
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
                        importScriptFromExternalStorage(url)
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

private extension View {
    func onChangeCompat<Value: Equatable>(of value: Value, perform action: @escaping (Value) -> Void) -> some View {
        if #available(iOS 17.0, *) {
            return onChange(of: value) { _, newValue in
                action(newValue)
            }
        } else {
            return onChange(of: value, perform: action)
        }
    }
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
