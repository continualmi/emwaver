import SwiftUI
import Combine // Added for Timer

struct EMWaverView: View {
    @EnvironmentObject var bleManager: BLEManager // Use shared BLEManager from environment
    @State private var commandInput = ""
    @State private var showHex = false // Default to false to match Android
    @State private var serialMonitorText = "" // Local state for serial monitor
    @State private var jsEngine: JavaScriptEngine? // Add reference to JavaScriptEngine
    @State private var firmwareVersion = "Unknown" // Add firmware version state
    @FocusState private var isCommandFieldFocused: Bool
    
    // Add auto-connect state variables
    @State private var autoConnectEnabled = true
    @State private var isPerformingAutoConnect = false

    // Use a timer publisher without autoconnect
    private let timerPublisher = Timer.publish(every: 0.1, on: .main, in: .common)
    // Store the subscription to cancel it later
    @State private var timerSubscription: AnyCancellable? = nil
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Connection Section
                GroupBox(label: Label("Connection", systemImage: "antenna.radiowaves.left.and.right").font(.headline)) {
                    VStack(spacing: 10) {
                        HStack {
                            Button(action: {
                                if bleManager.isConnected {
                                    bleManager.disconnect()
                                } else {
                                    isPerformingAutoConnect = false // Disable auto-connect when manual connect is used
                                    bleManager.startScan()
                                }
                            }) {
                                HStack {
                                    Image(systemName: bleManager.isConnected ? "antenna.radiowaves.left.and.right.slash" : "antenna.radiowaves.left.and.right")
                                    Text(bleManager.isConnected ? "Disconnect" : "Connect to EMWaver")
                                }
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(bleManager.isConnected ? Color.red.opacity(0.8) : Color.blue.opacity(0.8))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                            }
                        }
                        
                        HStack {
                            HStack {
                                Circle()
                                    .fill(getConnectionStatusColor())
                                    .frame(width: 12, height: 12)
                                Text(getConnectionStatusText())
                                    .font(.subheadline)
                                    .foregroundColor(getConnectionStatusColor())
                            }
                            
                            Spacer()
                            
                            // Add firmware version display
                            HStack {
                                Text("Firmware: ")
                                    .font(.subheadline)
                                Text(firmwareVersion)
                                    .font(.subheadline)
                                    .foregroundColor(firmwareVersion == "Unknown" ? .gray : .blue)
                                
                                Button(action: {
                                    requestFirmwareVersion()
                                }) {
                                    Image(systemName: "arrow.clockwise")
                                        .foregroundColor(.blue)
                                }
                                .disabled(!bleManager.isConnected)
                            }
                        }
                        
                        // Add auto-connect toggle
                        Toggle("Auto Connect", isOn: $autoConnectEnabled)
                            .toggleStyle(SwitchToggleStyle(tint: .blue))
                            .padding(.top, 4)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Command Input Section
                GroupBox(label: Label("Command Input", systemImage: "terminal").font(.headline)) {
                    VStack(spacing: 12) {
                        HStack {
                            TextField("e.g., version[0x00][255][0xFF]", text: $commandInput)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .padding(.trailing, 8)
                                .focused($isCommandFieldFocused)
                                .submitLabel(.send)
                                .onSubmit {
                                    if bleManager.isConnected {
                                        sendPacket()
                                    }
                                    isCommandFieldFocused = false
                                }
                            
                            Button(action: {
                                sendPacket()
                                isCommandFieldFocused = false
                            }) {
                                HStack {
                                    Image(systemName: "paperplane.fill")
                                    Text("Send")
                                }
                                .padding(10)
                                .background(Color.blue.opacity(0.8))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                            }
                            .disabled(!bleManager.isConnected)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") {
                            isCommandFieldFocused = false
                        }
                    }
                }
                
                // Serial Monitor Section
                GroupBox(label: Label("Serial Monitor", systemImage: "doc.text").font(.headline)) {
                    VStack {
                        ScrollViewReader { scrollViewProxy in // Added ScrollViewReader for auto-scroll
                            ScrollView {
                                // Use the local serialMonitorText state
                                if serialMonitorText.isEmpty {
                                    Text("Serial monitor output will appear here.")
                                        .font(.system(.body, design: .monospaced))
                                        .foregroundColor(Color.green.opacity(0.7))
                                        .padding(8)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                } else {
                                    // Display the text with different colors for TX/RX entries
                                    MonitorTextView(text: serialMonitorText)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.bottom, 1) // Ensure last line is visible
                                        .id("bottom") // ID for scrolling
                                }
                            }
                            .background(Color.black)
                            .cornerRadius(8)
                            .frame(minHeight: 200, maxHeight: 200)
                            .onChange(of: serialMonitorText) { _ in // Auto-scroll on change
                                withAnimation {
                                    scrollViewProxy.scrollTo("bottom", anchor: .bottom)
                                }
                            }
                        }

                        HStack {
                            // Single checkbox for HEX display to match Android
                            Toggle("HEX", isOn: $showHex)
                                .toggleStyle(SwitchToggleStyle(tint: .blue))
                            
                            Spacer()
                            
                            Button(action: {
                                clearSerialMonitor()
                            }) {
                                HStack {
                                    Image(systemName: "trash")
                                    Text("Clear")
                                }
                                .padding(10)
                                .background(Color.red.opacity(0.7))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                            }
                        }
                        .padding(.top, 8)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .navigationTitle("EMWaver")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            // Start the timer when view appears
            timerSubscription = timerPublisher
                .autoconnect()
                .sink { _ in
                    self.fetchAndDisplayBufferedData()
                }
                
            // Initialize the JavaScript engine when the view appears
            if bleManager.isConnected && jsEngine == nil {
                setupJSEngine()
            }

            // Add this code for opaque navigation bar
            let appearance = UINavigationBarAppearance()
            appearance.configureWithOpaqueBackground()
            UINavigationBar.appearance().standardAppearance = appearance
            UINavigationBar.appearance().compactAppearance = appearance
            UINavigationBar.appearance().scrollEdgeAppearance = appearance
            // End of added code
            
            // Auto-connect functionality
            startAutoConnect()
            
            // Check firmware version after a short delay when view appears
            if bleManager.isConnected {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    requestFirmwareVersion()
                }
            }
        }
        .onChange(of: bleManager.isConnected) { connected in
            if connected && jsEngine == nil {
                setupJSEngine()
            }
            
            // Check firmware version after connection
            if connected {
                print("EMWaverView detected new connection")
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    requestFirmwareVersion()
                }
                isPerformingAutoConnect = false // Reset auto-connect flag once connected
            } else {
                // Reset firmware version when disconnected
                firmwareVersion = "Unknown"
                
                // If disconnected and auto-connect is enabled, try to reconnect
                if autoConnectEnabled && !isPerformingAutoConnect {
                    startAutoConnect()
                }
            }
        }
        .onDisappear {
            // Cancel the timer when view disappears
            print("EMWaverView disappearing, canceling timer")
            timerSubscription?.cancel()
            timerSubscription = nil
            
            // --- Add Logging Here ---
            print("!!! BLEView disappearing.")
            // Check state immediately
            if let peripheral = bleManager.connectedPeripheral { // Use the public accessor
                print("!!! BLEView onDisappear: Peripheral state is \(peripheral.state.rawValue)") // Raw value for more detail maybe
            } else {
                print("!!! BLEView onDisappear: Peripheral device is nil.")
            }

            // Check state after a small delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let peripheral = bleManager.connectedPeripheral {
                     print("!!! BLEView 0.1s after disappear: Peripheral state is \(peripheral.state.rawValue)")
                     // If disconnected here without delegate call, it's confirmation
                     if peripheral.state == .disconnected || peripheral.state == .disconnecting {
                         print("!!! Peripheral disconnected shortly after view disappear, but didDisconnect delegate likely wasn't called.")
                         // Potentially trigger a manual reconnect attempt here if needed
                         // bleManager.attemptReconnect() // You'd need to implement this
                     }
                }
            }
        }
    }
    
    // Add function to handle auto-connect
    private func startAutoConnect() {
        // Only start auto-connect if enabled and not already connecting/connected
        guard autoConnectEnabled && 
              !bleManager.isConnected && 
              !bleManager.isScanning && 
              !isPerformingAutoConnect else {
            return
        }
        
        print("Starting auto-connect process...")
        isPerformingAutoConnect = true
        
        // Start scanning for devices
        bleManager.startScan()
        
        // Add timeout for auto-connect attempt
        DispatchQueue.main.asyncAfter(deadline: .now() + 10.0) {
            if isPerformingAutoConnect && !bleManager.isConnected {
                print("Auto-connect timeout - resetting state")
                isPerformingAutoConnect = false
                
                // If still scanning, stop the scan
                if bleManager.isScanning {
                    bleManager.stopScan()
                }
            }
        }
    }
    
    // Helper functions
    private func getConnectionStatusText() -> String {
        if bleManager.isScanning {
            return "Scanning..."
        } else if bleManager.isConnected {
            return "Connected"
        } else {
            return "Not connected"
        }
    }
    
    private func getConnectionStatusColor() -> Color {
        if bleManager.isScanning {
            return .orange
        } else if bleManager.isConnected {
            return .green
        } else {
            return .red
        }
    }
    
    private func sendPacket() {
        guard !commandInput.isEmpty else { return }

        if let data = BLEManager.parseCommand(commandInput) {
            // Log the packet being sent to the local serial monitor with gold color
            logToSerialMonitor(data: data, direction: .transmit)
            bleManager.sendPacket(data)
            commandInput = "" // Clear input after sending
        } else {
            // Add error feedback to the local serial monitor
            let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
            let errorMessage = "[\(timestamp)] Error: Invalid packet format for input: \(commandInput)"

            DispatchQueue.main.async {
                self.serialMonitorText += errorMessage + "\n"
            }
        }
    }
    
    private func clearSerialMonitor() {
        DispatchQueue.main.async {
            // Clear the local state
            self.serialMonitorText = ""
        }
    }

    // New function to fetch data from BLEManager buffer and update local state
    private func fetchAndDisplayBufferedData() {
        guard bleManager.isConnected else { return } // Only fetch if connected
        
        if let data = bleManager.getCommand(), !data.isEmpty {
            logToSerialMonitor(data: data, direction: .receive)
            
            // Check if this might be a response to the version command
            checkForVersionResponse(data)
        }
    }
    
    // Check incoming data for possible version response
    private func checkForVersionResponse(_ data: Data) {
        // If current firmware version is Unknown, check if this might be the version response
        if firmwareVersion == "Unknown" {
            let asciiString = BLEManager.dataToAsciiString(data)
            if asciiString.contains("-") && asciiString.contains("Welcome") {
                let version = extractVersion(from: asciiString)
                DispatchQueue.main.async {
                    self.firmwareVersion = version
                }
            }
        }
    }

    // Helper to format and log data to the local serial monitor state
    private func logToSerialMonitor(data: Data, direction: BLEManager.DataDirection) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        let dirSymbol = direction == .transmit ? "TX" : "RX"
        var logEntry = "[\(timestamp)] \(dirSymbol): "
        
        // Changed from HTML formatting to plain text
        // The original code used HTML-like color tags which don't work with Text(LocalizedStringKey)
        if showHex {
            logEntry += "\(BLEManager.dataToHexString(data))"
        } else {
            // If showHex is false, show ASCII
            logEntry += "\"\(BLEManager.dataToAsciiString(data))\""
        }

        DispatchQueue.main.async {
            self.serialMonitorText += logEntry + "\n"
        }
    }
    
    // Setup JavaScript engine for this view
    private func setupJSEngine() {
        jsEngine = JavaScriptEngine(bleManager: bleManager)
        jsEngine?.setupContext(printCallback: { message in
            DispatchQueue.main.async {
                self.serialMonitorText += "JS: \(message)\n"
            }
        })
        
        // Set up CC1101 if needed later
        let cc1101 = CC1101(bleManager: bleManager)
        jsEngine?.setupCC1101(cc1101)
        
        // Set up IR encoder
        jsEngine?.setupIR()
    }
    
    // Request firmware version method to match Android implementation
    private func requestFirmwareVersion() {
        guard bleManager.isConnected else { return }
        
        // Create version command as byte array (exactly as in Android)
        let versionCommand = "version".data(using: .ascii)!
        
        // Log the command to serial monitor as transmitted
        logToSerialMonitor(data: versionCommand, direction: .transmit)
        
        // Send the command
        bleManager.sendPacket(versionCommand)
        
        // Response will be handled by the fetchAndDisplayBufferedData function 
        // which checks all incoming data
    }
    
    // Extract version from the welcome message to match Android implementation
    private func extractVersion(from message: String) -> String {
        guard !message.isEmpty else { return "Unknown" }
        
        // The version is at the beginning up to the first dash
        if let dashIndex = message.firstIndex(of: "-") {
            let versionPart = message[..<dashIndex].trimmingCharacters(in: .whitespacesAndNewlines)
            return String(versionPart)
        }
        
        // If parsing fails (no dash found), just return the original message
        return message
    }
}

// Enum for direction - needed locally now
enum DataDirection {
    case transmit
    case receive
}

#Preview {
    EMWaverView()
        .environmentObject(BLEManager())
}

// Add BLEManager extension for DataDirection if it's not defined elsewhere
// If DataDirection is intended to be shared, define it outside both classes.
extension BLEManager { // Added extension for DataDirection
    enum DataDirection {
        case transmit
        case receive
    }
}

// Custom view to display monitor text with colored lines
struct MonitorTextView: View {
    let text: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(text.split(separator: "\n", omittingEmptySubsequences: false), id: \.self) { line in
                Text(String(line))
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(getColorForLine(String(line)))
            }
        }
    }
    
    private func getColorForLine(_ line: String) -> Color {
        if line.contains("] TX:") {
            return Color.yellow // Gold color for TX
        } else if line.contains("] RX:") {
            return Color.green // Green color for RX
        } else {
            return Color.green.opacity(0.7) // Default color
        }
    }
} 